import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JenisPendapatan, JenisSimpanan, KategoriPangkat, Role, StatusPinjaman } from '@prisma/client';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import {
  hitungJadwalAngsuran,
  validasiPinjaman,
} from '../common/utils/pinjaman-calculator';
import { decimal, toNumber } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  BayarAngsuranDinamisDto,
  CairkanPinjamanDto,
  CreatePinjamanDto,
  PelunasanDipercepatDto,
  UpdateBungaDto,
  UpdateStatusPinjamanDto,
} from './dto/pinjaman.dto';

const pinjamanInclude = {
  anggota: { include: { pangkat: true, korps: true, satminkal: true } },
  angsuran: { orderBy: { bulanKe: 'asc' as const } },
  dokumen: { orderBy: { uploadedAt: 'desc' as const } },
} as const;

const ALLOWED_TRANSITIONS: Partial<Record<StatusPinjaman, StatusPinjaman[]>> = {
  [StatusPinjaman.DIAJUKAN]: [
    StatusPinjaman.VERIFIKASI_PRIMKOP,
    StatusPinjaman.VERIFIKASI_JURU_BAYAR,
    StatusPinjaman.REKOMENDASI_PIMPINAN,
    StatusPinjaman.SETUJU_KEPRIM,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.VERIFIKASI_PRIMKOP]: [
    StatusPinjaman.VERIFIKASI_JURU_BAYAR,
    StatusPinjaman.REKOMENDASI_PIMPINAN,
    StatusPinjaman.SETUJU_KEPRIM,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.VERIFIKASI_JURU_BAYAR]: [
    StatusPinjaman.REKOMENDASI_PIMPINAN,
    StatusPinjaman.SETUJU_KEPRIM,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.REKOMENDASI_PIMPINAN]: [
    StatusPinjaman.SETUJU_KEPRIM,
    StatusPinjaman.MENUNGGU_DOKUMEN,
    StatusPinjaman.DICAIRKAN,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.SETUJU_KEPRIM]: [
    StatusPinjaman.MENUNGGU_DOKUMEN,
    StatusPinjaman.DICAIRKAN,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.MENUNGGU_DOKUMEN]: [
    StatusPinjaman.SETUJU_KEPRIM,
    StatusPinjaman.DICAIRKAN,
    StatusPinjaman.DITOLAK,
  ],
  [StatusPinjaman.DICAIRKAN]: [StatusPinjaman.LUNAS],
};

// Plafond maksimal pinjaman berdasarkan kategori pangkat
const PLAFOND_MAKS: Record<KategoriPangkat, number> = {
  [KategoriPangkat.BINTARA]: 50_000_000,
  [KategoriPangkat.BATA_ASN]: 50_000_000,
  [KategoriPangkat.PNS]: 50_000_000,
  [KategoriPangkat.PAMA]: 100_000_000,
  [KategoriPangkat.PAMEN]: 100_000_000,
  [KategoriPangkat.PATI]: 100_000_000,
};

@Injectable()
export class PinjamanService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveSatminkalScope(user: JwtUser, satminkalIdParam?: string) {
    const targetSatminkal =
      satminkalIdParam && satminkalIdParam !== 'ALL'
        ? satminkalIdParam
        : user.satminkalId;

    if (targetSatminkal) {
      if (user.kotamaId) {
        return {
          satminkalId: targetSatminkal,
          satminkal: { kotamaId: user.kotamaId },
        };
      }
      return { satminkalId: targetSatminkal };
    }

    if (user.kotamaId) {
      return { satminkal: { kotamaId: user.kotamaId } };
    }

    if (user.role === Role.SUPER_ADMIN) {
      return {};
    }

    return {};
  }

  findAll(user: JwtUser, status?: StatusPinjaman, satminkalIdParam?: string) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const satminkalScope = this.resolveSatminkalScope(user, satminkalIdParam);

    return this.prisma.pinjaman.findMany({
      where: {
        anggota: {
          ...satminkalScope,
          ...(isAnggota ? { nrpNip: user.username } : {}),
        },
        ...(status ? { status } : {}),
      },
      include: pinjamanInclude,
      orderBy: [
        { anggota: { satminkal: { kode: 'asc' } } },
        { anggota: { pangkat: { kodePkt: 'desc' } } },
        { anggota: { nama: 'asc' } },
        { tanggalAjuan: 'desc' },
      ],
    });
  }

  // Hitung sisa kuota plafond pinjaman anggota berdasarkan kategori pangkat
  async getPlafondInfo(user: JwtUser, anggotaId: string) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const anggota = await this.prisma.anggota.findFirst({
      where: {
        id: anggotaId,
        satminkalId: user.satminkalId,
        ...(isAnggota ? { nrpNip: user.username } : {}),
      },
      include: { pangkat: true },
    });
    if (!anggota) {
      throw new NotFoundException('Anggota tidak ditemukan');
    }

    const kategori = anggota.pangkat.kategori;
    const maksPlafond = PLAFOND_MAKS[kategori] ?? 50_000_000;

    // Total pinjaman aktif (belum lunas & belum ditolak)
    const activeLoans = await this.prisma.pinjaman.findMany({
      where: {
        anggotaId,
        status: { notIn: [StatusPinjaman.LUNAS, StatusPinjaman.DITOLAK] },
      },
      select: { nominal: true, sisaPokok: true },
    });

    const totalPinjamanAktif = activeLoans.reduce((acc, loan) => {
      return acc + toNumber(loan.sisaPokok ?? loan.nominal);
    }, 0);

    const sisaKuota = Math.max(0, maksPlafond - totalPinjamanAktif);

    // Cek apakah anggota terkena sanksi blacklist (melewati masa toleransi 2 bulan)
    let isBlacklist = false;
    let sanksiKeterangan: string | null = null;
    let sanksiHingga: string | null = null;

    for (const loan of activeLoans) {
      const jInfo = this.evaluateJatuhTempoInfo(loan as any);
      if (jInfo.isBlacklist) {
        isBlacklist = true;
        sanksiKeterangan = jInfo.keterangan;
        sanksiHingga = jInfo.sanksiBlacklistHingga;
        break;
      }
    }

    return {
      anggotaId,
      kategoriPangkat: kategori,
      maksPlafond,
      totalPinjamanAktif,
      sisaKuota,
      isBlacklist,
      sanksiKeterangan,
      sanksiHingga,
      label: kategori === KategoriPangkat.BINTARA || kategori === KategoriPangkat.BATA_ASN || kategori === KategoriPangkat.PNS
        ? 'Bintara / PNS / ASN (Maks. Rp 50.000.000)'
        : 'Perwira (Maks. Rp 100.000.000)',
    };
  }

  // Rekap angsuran bulanan untuk ekspor
  async rekapAngsuranBulanan(user: JwtUser, bulan: number, tahun: number, satminkalIdParam?: string) {
    const startDate = new Date(Date.UTC(tahun, bulan - 1, 1));
    const endDate = new Date(Date.UTC(tahun, bulan, 1));
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const satminkalScope = this.resolveSatminkalScope(user, satminkalIdParam);

    const angsuranList = await this.prisma.angsuran.findMany({
      where: {
        pinjaman: {
          anggota: {
            ...satminkalScope,
            ...(isAnggota ? { nrpNip: user.username } : {}),
          },
        },
        jatuhTempo: { gte: startDate, lt: endDate },
      },
      include: {
        pinjaman: {
          include: {
            anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          },
        },
      },
      orderBy: [
        { pinjaman: { anggota: { satminkal: { kode: 'asc' } } } },
        { pinjaman: { anggota: { pangkat: { kodePkt: 'desc' } } } },
        { pinjaman: { anggota: { nama: 'asc' } } },
        { jatuhTempo: 'asc' },
      ],
    });

    return angsuranList.map((a) => ({
      id: a.id,
      pinjamanId: a.pinjamanId,
      namaAnggota: a.pinjaman.anggota.nama,
      nrpNip: a.pinjaman.anggota.nrpNip,
      pangkat: a.pinjaman.anggota.pangkat?.nama ?? '-',
      kategoriPangkat: a.pinjaman.anggota.pangkat?.kategori ?? '-',
      korps: a.pinjaman.anggota.korps?.nama ?? a.pinjaman.anggota.korps?.kode ?? '-',
      bulanKe: a.bulanKe,
      jatuhTempo: a.jatuhTempo,
      pokok: toNumber(a.pokok),
      bunga: toNumber(a.bunga),
      total: toNumber(a.total),
      dibayar: a.dibayar,
      tanggalBayar: a.tanggalBayar,
      noInvoice: a.noInvoice,
    }));
  }

  async getPengaturanBunga(user: JwtUser) {
    const setting = await this.prisma.pengaturanKoperasi.findUnique({
      where: { satminkalId: user.satminkalId },
    });
    const history = await this.prisma.riwayatBunga.findMany({
      where: { satminkalId: user.satminkalId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      bungaPersenTahun: setting
        ? toNumber(setting.bungaPinjamanPersenTahun)
        : 12,
      updatedAt: setting?.updatedAt ?? null,
      riwayat: history.map((h) => ({
        id: h.id,
        bungaPersenTahun: toNumber(h.bungaPersenTahun),
        keterangan: h.keterangan,
        createdAt: h.createdAt,
      })),
    };
  }

  async updatePengaturanBunga(user: JwtUser, dto: UpdateBungaDto) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Pengaturan suku bunga pinjaman hanya dapat diubah oleh Bendahara/Admin');
    }
    return this.prisma.$transaction(async (tx) => {
      const setting = await tx.pengaturanKoperasi.upsert({
        where: { satminkalId: user.satminkalId },
        create: {
          satminkalId: user.satminkalId!,
          bungaPinjamanPersenTahun: decimal(dto.bungaPersenTahun),
        },
        update: {
          bungaPinjamanPersenTahun: decimal(dto.bungaPersenTahun),
        },
      });

      await tx.riwayatBunga.create({
        data: {
          satminkalId: user.satminkalId!,
          bungaPersenTahun: decimal(dto.bungaPersenTahun),
          keterangan: dto.keterangan ?? 'Perubahan suku bunga pinjaman',
          diubahOlehId: user.userId,
        },
      });

      return {
        message: 'Suku bunga pinjaman berhasil diperbarui',
        bungaPersenTahun: toNumber(setting.bungaPinjamanPersenTahun),
        updatedAt: setting.updatedAt,
      };
    });
  }

  async findOne(user: JwtUser, id: string) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const row = await this.prisma.pinjaman.findFirst({
      where: {
        id,
        anggota: {
          satminkalId: user.satminkalId,
          ...(isAnggota ? { nrpNip: user.username } : {}),
        },
      },
      include: pinjamanInclude,
    });
    if (!row) {
      throw new NotFoundException('Pinjaman tidak ditemukan');
    }
    return row;
  }

  async create(user: JwtUser, dto: CreatePinjamanDto) {
    const err = validasiPinjaman(dto.nominal, dto.tenorBulan);
    if (err) {
      throw new BadRequestException(err);
    }

    const anggota = await this.prisma.anggota.findFirst({
      where: {
        id: dto.anggotaId,
        satminkalId: user.satminkalId,
        isAktif: true,
      },
      include: { pangkat: true },
    });
    if (!anggota) {
      throw new NotFoundException('Anggota aktif tidak ditemukan');
    }

    if ((user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') && anggota.nrpNip !== user.username) {
      throw new BadRequestException('Anggota hanya dapat mengajukan pinjaman untuk dirinya sendiri');
    }

    // ========== VALIDASI SANKSI BLACKLIST PINJAMAN 2 TAHUN ==========
    const activeLoansForBlacklist = await this.prisma.pinjaman.findMany({
      where: {
        anggotaId: dto.anggotaId,
        status: { notIn: [StatusPinjaman.LUNAS, StatusPinjaman.DITOLAK] },
      },
      select: { tanggalCair: true, tenorBulan: true, sisaPokok: true, status: true },
    });

    for (const loan of activeLoansForBlacklist) {
      const jInfo = this.evaluateJatuhTempoInfo(loan as any);
      if (jInfo.isBlacklist) {
        throw new BadRequestException(
          `Pengajuan pinjaman ditolak! Anggota sedang dalam masa sanksi blacklist pinjaman selama 2 tahun akibat tunggakan angsuran melewati masa toleransi 2 bulan. Status: ${jInfo.keterangan}`,
        );
      }
    }

    // ========== VALIDASI PLAFOND BERDASARKAN KATEGORI PANGKAT ==========
    const kategori = anggota.pangkat.kategori;
    const maksPlafond = PLAFOND_MAKS[kategori] ?? 50_000_000;

    // Hitung total pinjaman aktif (belum lunas & belum ditolak)
    const activeLoans = await this.prisma.pinjaman.findMany({
      where: {
        anggotaId: dto.anggotaId,
        status: { notIn: [StatusPinjaman.LUNAS, StatusPinjaman.DITOLAK] },
      },
      select: { nominal: true, sisaPokok: true },
    });

    const totalPinjamanAktif = activeLoans.reduce((acc, loan) => {
      return acc + toNumber(loan.sisaPokok ?? loan.nominal);
    }, 0);

    const totalSetelahPengajuan = totalPinjamanAktif + dto.nominal;

    if (totalSetelahPengajuan > maksPlafond) {
      const sisaKuota = Math.max(0, maksPlafond - totalPinjamanAktif);
      const labelKategori = kategori === KategoriPangkat.BINTARA || kategori === KategoriPangkat.BATA_ASN || kategori === KategoriPangkat.PNS
        ? 'Bintara / PNS / ASN'
        : 'Perwira';
      throw new BadRequestException(
        `Pengajuan melebihi batas plafond! Kategori ${labelKategori} maks. Rp ${maksPlafond.toLocaleString('id-ID')}. ` +
        `Pinjaman aktif: Rp ${totalPinjamanAktif.toLocaleString('id-ID')}, ` +
        `pengajuan baru: Rp ${dto.nominal.toLocaleString('id-ID')}, ` +
        `total: Rp ${totalSetelahPengajuan.toLocaleString('id-ID')}. ` +
        `Sisa kuota tersedia: Rp ${sisaKuota.toLocaleString('id-ID')}.`,
      );
    }

    // Auto-verification Primkop: Cek apakah Simpanan Pokok & Wajib anggota sudah dicatat
    const simpananAwalCount = await this.prisma.simpanan.count({
      where: {
        anggotaId: dto.anggotaId,
        jenis: { in: [JenisSimpanan.POKOK, JenisSimpanan.WAJIB] },
      },
    });

    const initialStatus =
      simpananAwalCount >= 2
        ? StatusPinjaman.VERIFIKASI_JURU_BAYAR
        : StatusPinjaman.DIAJUKAN;

    // Ambil suku bunga aktif Satminkal (default 12% per tahun jika belum di-set)
    const activeSetting = await this.prisma.pengaturanKoperasi.findUnique({
      where: { satminkalId: user.satminkalId },
    });
    const activeBungaPersenTahun = activeSetting
      ? toNumber(activeSetting.bungaPinjamanPersenTahun)
      : 12;

    return this.prisma.pinjaman.create({
      data: {
        anggotaId: dto.anggotaId,
        nominal: decimal(dto.nominal),
        tenorBulan: dto.tenorBulan,
        bungaPersenTahun: decimal(activeBungaPersenTahun),
        status: initialStatus,
        catatan: dto.catatan ?? null,
      },
      include: pinjamanInclude,
    });
  }

  async updateStatus(user: JwtUser, id: string, dto: UpdateStatusPinjamanDto) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Anggota tidak memiliki wewenang untuk mengubah status persetujuan');
    }
    const pinjaman = await this.findOne(user, id);
    const next = dto.status;
    const allowed = ALLOWED_TRANSITIONS[pinjaman.status] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Transisi status dari ${pinjaman.status} ke ${next} tidak diizinkan`,
      );
    }

    return this.prisma.pinjaman.update({
      where: { id },
      data: {
        status: next,
        ...(dto.catatan !== undefined ? { catatan: dto.catatan } : {}),
        ...(dto.alasanPenolakan !== undefined ? { alasanPenolakan: dto.alasanPenolakan } : {}),
      },
      include: pinjamanInclude,
    });
  }

  async cairkan(user: JwtUser, id: string, dto?: CairkanPinjamanDto) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Pencairan pinjaman hanya dapat diproses oleh Bendahara');
    }
    const pinjaman = await this.findOne(user, id);
    const validCairStatuses: StatusPinjaman[] = [
      StatusPinjaman.MENUNGGU_DOKUMEN,
      StatusPinjaman.SETUJU_KEPRIM,
      StatusPinjaman.REKOMENDASI_PIMPINAN,
    ];
    if (!validCairStatuses.includes(pinjaman.status)) {
      throw new BadRequestException('Pinjaman belum siap untuk dicairkan');
    }
    if (pinjaman.angsuran.length > 0) {
      throw new BadRequestException('Jadwal angsuran sudah dibuat');
    }

    const nominal = toNumber(pinjaman.nominal);
    const bungaPersenTahun = toNumber(pinjaman.bungaPersenTahun ?? 12);
    const bungaPersenBulan = bungaPersenTahun / 12;
    const jadwal = hitungJadwalAngsuran(
      nominal,
      pinjaman.tenorBulan,
      bungaPersenBulan,
    );
    const tanggalCair = dto?.tanggalCair
      ? new Date(dto.tanggalCair)
      : new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.angsuran.createMany({
        data: jadwal.map((row) => {
          const jatuh = new Date(
            tanggalCair.getFullYear(),
            tanggalCair.getMonth() + row.bulanKe,
            5,
          );
          return {
            pinjamanId: id,
            bulanKe: row.bulanKe,
            jatuhTempo: jatuh,
            pokok: decimal(row.pokok),
            bunga: decimal(row.bunga),
            total: decimal(row.total),
          };
        }),
      });

      return tx.pinjaman.update({
        where: { id },
        data: {
          status: StatusPinjaman.DICAIRKAN,
          tanggalCair,
          sisaPokok: decimal(nominal),
        },
        include: pinjamanInclude,
      });
    });
  }

  async bayarAngsuran(user: JwtUser, angsuranId: string) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Pembayaran angsuran hanya dapat diproses oleh Juru Bayar / Bendahara');
    }
    const angsuran = await this.prisma.angsuran.findFirst({
      where: {
        id: angsuranId,
        pinjaman: { anggota: { satminkalId: user.satminkalId } },
      },
      include: {
        pinjaman: true,
      },
    });
    if (!angsuran) {
      throw new NotFoundException('Angsuran tidak ditemukan');
    }
    if (angsuran.dibayar) {
      throw new BadRequestException('Angsuran sudah dibayar');
    }

    const satminkal = await this.prisma.satminkal.findUniqueOrThrow({
      where: { id: user.satminkalId },
    });
    const tahun = new Date().getFullYear();
    const noInvoice = await this.generateInvoice(
      user.satminkalId!,
      satminkal.kode,
      tahun,
    );

    return this.prisma.$transaction(async (tx) => {
      const paid = await tx.angsuran.update({
        where: { id: angsuranId },
        data: {
          dibayar: true,
          tanggalBayar: new Date(),
          noInvoice,
        },
      });

      const sisa =
        toNumber(angsuran.pinjaman.sisaPokok ?? angsuran.pinjaman.nominal) -
        toNumber(angsuran.pokok);
      const sisaFinal = Math.max(0, sisa);

      const unpaid = await tx.angsuran.count({
        where: { pinjamanId: angsuran.pinjamanId, dibayar: false },
      });

      await tx.pinjaman.update({
        where: { id: angsuran.pinjamanId },
        data: {
          sisaPokok: decimal(sisaFinal),
          ...(unpaid === 0 ? { status: StatusPinjaman.LUNAS } : {}),
        },
      });

      await tx.pendapatan.create({
        data: {
          satminkalId: user.satminkalId,
          tahun,
          jenis: JenisPendapatan.BUNGA_PINJAMAN,
          nominal: angsuran.bunga,
          keterangan: `Bunga angsuran ke-${angsuran.bulanKe} pinjaman ${angsuran.pinjamanId}`,
        },
      });

      return paid;
    });
  }

  async pelunasanDipercepat(
    user: JwtUser,
    pinjamanId: string,
    dto?: PelunasanDipercepatDto,
  ) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Pelunasan dipercepat hanya dapat diproses oleh Juru Bayar / Bendahara');
    }
    const pinjaman = await this.findOne(user, pinjamanId);

    if (pinjaman.status !== StatusPinjaman.DICAIRKAN) {
      throw new BadRequestException(
        'Hanya pinjaman berstatus DICAIRKAN yang dapat dilunasi secara dipercepat',
      );
    }

    const sisaPokok = toNumber(pinjaman.sisaPokok ?? 0);
    if (sisaPokok <= 0) {
      throw new BadRequestException('Pinjaman sudah tidak memiliki sisa pokok');
    }

    const satminkal = await this.prisma.satminkal.findUniqueOrThrow({
      where: { id: user.satminkalId },
    });
    const tglPelunasan = dto?.tanggalPelunasan
      ? new Date(dto.tanggalPelunasan)
      : new Date();
    const tahun = tglPelunasan.getFullYear();

    const noInvoice = await this.generateInvoice(
      user.satminkalId!,
      satminkal.kode,
      tahun,
    );

    return this.prisma.$transaction(async (tx) => {
      const unpaidAngsuran = await tx.angsuran.findMany({
        where: { pinjamanId, dibayar: false },
      });

      const totalBungaSisa = unpaidAngsuran.reduce(
        (acc, curr) => acc + toNumber(curr.bunga),
        0,
      );

      await tx.angsuran.updateMany({
        where: { pinjamanId, dibayar: false },
        data: {
          dibayar: true,
          tanggalBayar: tglPelunasan,
          noInvoice,
        },
      });

      await tx.pinjaman.update({
        where: { id: pinjamanId },
        data: {
          sisaPokok: decimal(0),
          status: StatusPinjaman.LUNAS,
        },
      });

      if (totalBungaSisa > 0) {
        await tx.pendapatan.create({
          data: {
            satminkalId: user.satminkalId,
            tahun,
            jenis: JenisPendapatan.BUNGA_PINJAMAN,
            nominal: decimal(totalBungaSisa),
            keterangan: `Pelunasan dipercepat pinjaman ${pinjamanId} (${dto?.keterangan ?? 'Pelunasan Awal'})`,
          },
        });
      }

      return this.findOne(user, pinjamanId);
    });
  }

  // =========================================================================
  // LOGIKA ANGSURAN DINAMIS: TOLERANSI 2 BULAN, BLACKLIST, PELUNASAN 2X BUNGA
  // =========================================================================

  evaluateJatuhTempoInfo(pinjaman: {
    tanggalCair: Date | null;
    tenorBulan: number;
    sisaPokok: any;
    status: StatusPinjaman;
  }) {
    const sisaPokokNum = toNumber(pinjaman.sisaPokok ?? 0);
    const isLunas = pinjaman.status === StatusPinjaman.LUNAS || sisaPokokNum <= 0;

    if (!pinjaman.tanggalCair || isLunas) {
      return {
        tanggalJatuhTempo: null,
        isLewatJatuhTempo: false,
        toleransiHingga: null,
        isMasaToleransi: false,
        isLewatToleransi: false,
        isBlacklist: false,
        sanksiBlacklistHingga: null,
        statusPeringatan: 'LUNAS' as const,
        keterangan: 'Pinjaman lunas atau belum dicairkan',
      };
    }

    const tglCair = new Date(pinjaman.tanggalCair);
    // Tanggal Jatuh Tempo Normal = Tanggal Cair + Tenor Bulan
    const jatuhTempo = new Date(tglCair.getFullYear(), tglCair.getMonth() + pinjaman.tenorBulan, tglCair.getDate());
    // Masa Toleransi 2 Bulan = Tanggal Jatuh Tempo + 2 Bulan
    const toleransiHingga = new Date(jatuhTempo.getFullYear(), jatuhTempo.getMonth() + 2, jatuhTempo.getDate());
    // Sanksi Blacklist 2 Tahun = Toleransi Hingga + 2 Tahun
    const sanksiBlacklistHingga = new Date(toleransiHingga.getFullYear() + 2, toleransiHingga.getMonth(), toleransiHingga.getDate());

    const now = new Date();
    const isLewatJatuhTempo = now > jatuhTempo && sisaPokokNum > 0;
    const isMasaToleransi = isLewatJatuhTempo && now <= toleransiHingga;
    const isLewatToleransi = now > toleransiHingga && sisaPokokNum > 0;
    const isBlacklist = isLewatToleransi;

    let statusPeringatan: 'NORMAL' | 'MASA_TOLERANSI_2_BULAN' | 'GAGAL_BAYAR_POTONG_JURU_BAYAR' | 'LUNAS' = 'NORMAL';
    let keterangan = 'Angsuran berjalan normal';

    if (isLewatToleransi) {
      statusPeringatan = 'GAGAL_BAYAR_POTONG_JURU_BAYAR';
      keterangan = `Melewati batas toleransi 2 bulan (${toleransiHingga.toLocaleDateString('id-ID')})! Pemotongan otomatis langsung via Juru Bayar & sanksi blacklist pinjaman 2 tahun aktif.`;
    } else if (isMasaToleransi) {
      statusPeringatan = 'MASA_TOLERANSI_2_BULAN';
      keterangan = `Melewati jatuh tempo normal (${jatuhTempo.toLocaleDateString('id-ID')}). Berada dalam masa toleransi 2 bulan (hingga ${toleransiHingga.toLocaleDateString('id-ID')}).`;
    }

    return {
      tanggalJatuhTempo: jatuhTempo.toISOString(),
      isLewatJatuhTempo,
      toleransiHingga: toleransiHingga.toISOString(),
      isMasaToleransi,
      isLewatToleransi,
      isBlacklist,
      sanksiBlacklistHingga: sanksiBlacklistHingga.toISOString(),
      statusPeringatan,
      keterangan,
    };
  }

  async getKalkulasiDinamis(user: JwtUser, pinjamanId: string) {
    const pinjaman = await this.findOne(user, pinjamanId);
    if (pinjaman.status !== StatusPinjaman.DICAIRKAN && pinjaman.status !== StatusPinjaman.LUNAS) {
      throw new BadRequestException('Pinjaman belum dicairkan');
    }

    const nominalAwal = toNumber(pinjaman.nominal);
    const sisaPokok = toNumber(pinjaman.sisaPokok ?? pinjaman.nominal);
    const tenorBulan = pinjaman.tenorBulan;
    const bungaPersenTahun = toNumber(pinjaman.bungaPersenTahun ?? 12);
    const bungaBulanan = Math.round(nominalAwal * (bungaPersenTahun / 100 / 12));
    const pokokBulanan = Math.round(nominalAwal / tenorBulan);

    const paidAngsuranCount = pinjaman.angsuran.filter((a) => a.dibayar).length;
    const nextBulanKe = Math.min(tenorBulan, paidAngsuranCount + 1);

    // Bunga tunggakan jika ada
    const tunggakanBunga = 0;
    const totalKewajibanBulanIni = pokokBulanan + bungaBulanan + tunggakanBunga;

    // Sesuai koreksi user: Pelunasan dipercepat = Sisa Pokok + (2 * Bunga Bulanan)
    const pelunasanDipercepatPokok = sisaPokok;
    const pelunasanDipercepatBunga = 2 * bungaBulanan;
    const totalPelunasanDipercepat = pelunasanDipercepatPokok + pelunasanDipercepatBunga;

    const jatuhTempoInfo = this.evaluateJatuhTempoInfo(pinjaman);

    return {
      pinjamanId: pinjaman.id,
      anggota: {
        id: pinjaman.anggota.id,
        nama: pinjaman.anggota.nama,
        nrpNip: pinjaman.anggota.nrpNip,
        pangkat: pinjaman.anggota.pangkat?.nama,
        korps: pinjaman.anggota.korps?.nama,
      },
      nominalAwal,
      sisaPokok,
      tenorBulan,
      bungaPersenTahun,
      bungaBulanan,
      pokokBulanan,
      tunggakanBunga,
      nextBulanKe,
      totalKewajibanBulanIni,
      pelunasanDipercepat: {
        sisaPokok: pelunasanDipercepatPokok,
        pinaltiBunga2x: pelunasanDipercepatBunga,
        totalBayar: totalPelunasanDipercepat,
      },
      jatuhTempoInfo,
    };
  }

  async bayarDinamis(
    user: JwtUser,
    pinjamanId: string,
    dto: BayarAngsuranDinamisDto,
  ) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException(
        'Pembayaran angsuran hanya dapat diproses oleh Bendahara / Juru Bayar',
      );
    }

    const pinjaman = await this.findOne(user, pinjamanId);
    if (pinjaman.status !== StatusPinjaman.DICAIRKAN) {
      throw new BadRequestException(
        'Hanya pinjaman berstatus DICAIRKAN yang dapat diproses pembayaran angsurannya',
      );
    }

    const nominalAwal = toNumber(pinjaman.nominal);
    const sisaPokokAwal = toNumber(pinjaman.sisaPokok ?? pinjaman.nominal);
    const bungaPersenTahun = toNumber(pinjaman.bungaPersenTahun ?? 12);
    const bungaBulanan = Math.round(nominalAwal * (bungaPersenTahun / 100 / 12));
    const tglBayar = dto.tanggalBayar ? new Date(dto.tanggalBayar) : new Date();
    const tahun = tglBayar.getFullYear();

    const satminkal = await this.prisma.satminkal.findUniqueOrThrow({
      where: { id: user.satminkalId },
    });
    const noInvoice = await this.generateInvoice(
      user.satminkalId!,
      satminkal.kode,
      tahun,
    );

    return this.prisma.$transaction(async (tx) => {
      let porsiBunga = 0;
      let porsiPokok = 0;
      let sisaPokokBaru = sisaPokokAwal;
      let isLunas = false;

      if (dto.isPelunasanDipercepat) {
        // Pelunasan Dipercepat: Sisa Pokok + (2 * Bunga Bulanan)
        porsiBunga = 2 * bungaBulanan;
        porsiPokok = sisaPokokAwal;
        sisaPokokBaru = 0;
        isLunas = true;

        // Tandai semua angsuran belum dibayar menjadi lunas
        await tx.angsuran.updateMany({
          where: { pinjamanId, dibayar: false },
          data: {
            dibayar: true,
            tanggalBayar: tglBayar,
            noInvoice,
          },
        });
      } else {
        // Pembayaran Parsial / Normal Dinamis:
        // Prioritas utama: Melunasi Bunga dahulu, sisanya memotong Pokok
        const nominalBayar = dto.nominalBayar;
        const totalBungaWajib = bungaBulanan; // Bunga periode berjalan

        if (nominalBayar >= totalBungaWajib) {
          porsiBunga = totalBungaWajib;
          porsiPokok = nominalBayar - totalBungaWajib;
          sisaPokokBaru = Math.max(0, sisaPokokAwal - porsiPokok);
        } else {
          // Bayar kurang dari bunga
          porsiBunga = nominalBayar;
          porsiPokok = 0;
          sisaPokokBaru = sisaPokokAwal;
        }

        if (sisaPokokBaru === 0) {
          isLunas = true;
        }

        // Ambil jadwal angsuran pertama yang belum dibayar
        const nextAngsuran = await tx.angsuran.findFirst({
          where: { pinjamanId, dibayar: false },
          orderBy: { bulanKe: 'asc' },
        });

        if (nextAngsuran) {
          await tx.angsuran.update({
            where: { id: nextAngsuran.id },
            data: {
              dibayar: true,
              tanggalBayar: tglBayar,
              noInvoice,
              pokok: decimal(porsiPokok),
              bunga: decimal(porsiBunga),
              total: decimal(nominalBayar),
            },
          });
        }
      }

      // Update Pinjaman
      await tx.pinjaman.update({
        where: { id: pinjamanId },
        data: {
          sisaPokok: decimal(sisaPokokBaru),
          ...(isLunas ? { status: StatusPinjaman.LUNAS } : {}),
        },
      });

      // Catat pendapatan bunga koperasi
      if (porsiBunga > 0) {
        await tx.pendapatan.create({
          data: {
            satminkalId: user.satminkalId,
            tahun,
            jenis: JenisPendapatan.BUNGA_PINJAMAN,
            nominal: decimal(porsiBunga),
            keterangan: dto.isPelunasanDipercepat
              ? `Bunga pelunasan dipercepat (2x bunga: Rp ${porsiBunga.toLocaleString('id-ID')}) pinjaman ${pinjamanId}`
              : `Bunga angsuran dinamis pinjaman ${pinjamanId} (${dto.catatan ?? 'Pembayaran Angsuran'})`,
          },
        });
      }

      return {
        message: isLunas
          ? 'Pinjaman Berhasil Dilunasi Penuh'
          : 'Pembayaran Angsuran Berhasil Diproses',
        noInvoice,
        tanggalBayar: tglBayar.toISOString(),
        nominalBayar: dto.isPelunasanDipercepat
          ? porsiPokok + porsiBunga
          : dto.nominalBayar,
        alokasi: {
          porsiBunga,
          porsiPokok,
          sisaPokokBaru,
        },
        isLunas,
        pinjamanId,
      };
    });
  }

  private async generateInvoice(
    satminkalId: string,
    kodeSatker: string,
    tahun: number,
  ): Promise<string> {
    const count = await this.prisma.angsuran.count({
      where: {
        noInvoice: { not: null },
        pinjaman: { anggota: { satminkalId } },
        tanggalBayar: {
          gte: new Date(`${tahun}-01-01`),
          lt: new Date(`${tahun + 1}-01-01`),
        },
      },
    });
    const seq = String(count + 1).padStart(6, '0');
    return `KW-${tahun}-${kodeSatker}-${seq}`;
  }
}
