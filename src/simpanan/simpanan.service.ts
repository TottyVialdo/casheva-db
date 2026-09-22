import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JenisSimpanan,
  JenisTransaksiSimpanan,
  KategoriPangkat,
  Role,
} from '@prisma/client';
import {
  SIMPANAN_POKOK,
  SIMPANAN_WAJIB,
  SUKARELA_BY_KATEGORI,
} from '../common/constants/simpanan.constants';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { decimal, toNumber } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { SimpananMassalDto } from './dto/simpanan-massal.dto';
import { BatchSimpananGolonganDto } from './dto/batch-simpanan.dto';

@Injectable()
export class SimpananService {
  constructor(private readonly prisma: PrismaService) {}

  async listByAnggota(user: JwtUser, anggotaId: string) {
    await this.assertAnggotaScope(user, anggotaId);
    return this.prisma.simpanan.findMany({
      where: { anggotaId },
      orderBy: [{ periode: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private resolveSatminkalScope(user: JwtUser, satminkalIdParam?: string) {
    if (user.role === Role.SUPER_ADMIN) {
      if (satminkalIdParam && satminkalIdParam !== 'ALL') {
        return { satminkalId: satminkalIdParam };
      }
      return {};
    }
    if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      if (satminkalIdParam && satminkalIdParam !== 'ALL') {
        return { satminkalId: satminkalIdParam, satminkal: { kotamaId: user.kotamaId } };
      }
      return { satminkal: { kotamaId: user.kotamaId } };
    }
    if (user.satminkalId) {
      return { satminkalId: user.satminkalId };
    }
    return {};
  }

  async rekapSatminkal(user: JwtUser, satminkalIdParam?: string) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const satminkalScope = this.resolveSatminkalScope(user, satminkalIdParam);

    const anggota = await this.prisma.anggota.findMany({
      where: {
        ...satminkalScope,
        isAktif: true,
        ...(isAnggota ? { nrpNip: user.username } : {}),
      },
      include: {
        pangkat: true,
        korps: true,
        satminkal: true,
      },
      orderBy: [
        { satminkal: { kode: 'asc' } },
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });
    const ids = anggota.map((a) => a.id);

    const simpananList = await this.prisma.simpanan.findMany({
      where: { anggotaId: { in: ids } },
      select: { anggotaId: true, jenis: true, tipe: true, nominal: true },
    });

    return anggota.map((a) => {
      const userRows = simpananList.filter((s) => s.anggotaId === a.id);

      const calculateTotal = (jenis: JenisSimpanan) => {
        return userRows
          .filter((r) => r.jenis === jenis)
          .reduce((acc, curr) => {
            const val = toNumber(curr.nominal);
            return curr.tipe === JenisTransaksiSimpanan.SETOR
              ? acc + val
              : acc - val;
          }, 0);
      };

      const totalPokok = calculateTotal(JenisSimpanan.POKOK);
      const totalWajib = calculateTotal(JenisSimpanan.WAJIB);
      const totalSukarela = calculateTotal(JenisSimpanan.SUKARELA);
      const totalKhusus = calculateTotal(JenisSimpanan.KHUSUS);

      return {
        id: a.id,
        anggotaId: a.id,
        nama: a.nama,
        nrpNip: a.nrpNip,
        pangkat: a.pangkat?.nama ?? '-',
        kategoriPangkat: a.pangkat?.kategori ?? '-',
        korps: a.korps?.nama ?? a.korps?.kode ?? '-',
        satminkal: a.satminkal?.nama ?? 'INFOLAHTADAM IV/DIPONEGORO',
        totalPokok,
        totalWajib,
        totalSukarela,
        totalKhusus,
        simpananPokok: totalPokok,
        simpananWajib: totalWajib,
        simpananSukarela: totalSukarela + totalKhusus,
        totalSimpanan: totalPokok + totalWajib + totalSukarela + totalKhusus,
      };
    });
  }

  async setPokokWajib(user: JwtUser, anggotaId: string) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Pencatatan simpanan pokok/wajib hanya dapat dilakukan oleh Bendahara/Admin');
    }
    const anggota = await this.assertAnggotaScope(user, anggotaId);

    const existing = await this.prisma.simpanan.count({
      where: {
        anggotaId,
        jenis: { in: [JenisSimpanan.POKOK, JenisSimpanan.WAJIB] },
      },
    });
    if (existing > 0) {
      throw new BadRequestException(
        'Simpanan pokok/wajib sudah pernah dicatat untuk anggota ini',
      );
    }

    // Ambil nominal dinamis dari pengaturan koperasi
    const setting = await this.prisma.pengaturanKoperasi.findUnique({
      where: { satminkalId: user.satminkalId },
    });
    const nominalPokok = setting ? toNumber(setting.nominalSimpananPokok) : SIMPANAN_POKOK;
    const nominalWajib = setting ? toNumber(setting.nominalSimpananWajib) : SIMPANAN_WAJIB;

    await this.prisma.simpanan.createMany({
      data: [
        {
          anggotaId,
          jenis: JenisSimpanan.POKOK,
          tipe: JenisTransaksiSimpanan.SETOR,
          nominal: decimal(nominalPokok),
          keterangan: `Simpanan pokok awal (Rp ${nominalPokok.toLocaleString('id-ID')})`,
        },
        {
          anggotaId,
          jenis: JenisSimpanan.WAJIB,
          tipe: JenisTransaksiSimpanan.SETOR,
          nominal: decimal(nominalWajib),
          keterangan: `Simpanan wajib awal (Rp ${nominalWajib.toLocaleString('id-ID')})`,
        },
      ],
    });

    return {
      message: 'Simpanan pokok & wajib berhasil dicatat',
      anggota: anggota.nama,
      pokok: nominalPokok,
      wajib: nominalWajib,
    };
  }

  // ========== PENGATURAN SIMPANAN DINAMIS (Bendahara / Admin) ==========

  async getPengaturanSimpanan(user: JwtUser) {
    const setting = await this.prisma.pengaturanKoperasi.findUnique({
      where: { satminkalId: user.satminkalId },
    });
    return {
      nominalSimpananPokok: setting ? toNumber(setting.nominalSimpananPokok) : SIMPANAN_POKOK,
      nominalSimpananWajib: setting ? toNumber(setting.nominalSimpananWajib) : SIMPANAN_WAJIB,
      nominalSimpananKhusus: setting ? toNumber(setting.nominalSimpananKhusus) : 0,
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  async updatePengaturanSimpanan(
    user: JwtUser,
    dto: { nominalPokok?: number; nominalWajib?: number; nominalKhusus?: number },
  ) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Hanya pengurus koperasi yang berhak mengubah pengaturan nominal');
    }
    const data: any = {};
    if (dto.nominalPokok !== undefined) data.nominalSimpananPokok = decimal(dto.nominalPokok);
    if (dto.nominalWajib !== undefined) data.nominalSimpananWajib = decimal(dto.nominalWajib);
    if (dto.nominalKhusus !== undefined) data.nominalSimpananKhusus = decimal(dto.nominalKhusus);

    const setting = await this.prisma.pengaturanKoperasi.upsert({
      where: { satminkalId: user.satminkalId },
      create: {
        satminkalId: user.satminkalId,
        ...data,
      },
      update: data,
    });

    return {
      message: 'Pengaturan nominal simpanan berhasil diperbarui',
      nominalSimpananPokok: toNumber(setting.nominalSimpananPokok),
      nominalSimpananWajib: toNumber(setting.nominalSimpananWajib),
      nominalSimpananKhusus: toNumber(setting.nominalSimpananKhusus),
      updatedAt: setting.updatedAt,
    };
  }

  // ========== SETOR SIMPANAN (Bendahara / Admin) ==========

  async setorSimpanan(
    user: JwtUser,
    dto: {
      anggotaId: string;
      jenis: JenisSimpanan;
      nominal: number;
      keterangan?: string;
    },
  ) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Setor simpanan tidak dapat dilakukan oleh Anggota');
    }
    if (dto.jenis === JenisSimpanan.KHUSUS && user.role !== Role.ADMIN_KOPERASI && user.role !== Role.BENDAHARA) {
      throw new BadRequestException('Simpanan khusus hanya dapat dicatat oleh Bendahara');
    }
    await this.assertAnggotaScope(user, dto.anggotaId);

    if (dto.nominal <= 0) {
      throw new BadRequestException('Nominal setoran harus lebih dari 0');
    }

    return this.prisma.simpanan.create({
      data: {
        anggotaId: dto.anggotaId,
        jenis: dto.jenis,
        tipe: JenisTransaksiSimpanan.SETOR,
        nominal: decimal(dto.nominal),
        periode: new Date(),
        keterangan: dto.keterangan ?? `Setoran simpanan ${dto.jenis.toLowerCase()}`,
      },
    });
  }

  // ========== REKAP SIMPANAN BULANAN ==========

  async rekapSimpananBulanan(user: JwtUser, bulan: number, tahun: number, satminkalIdParam?: string) {
    const startDate = new Date(Date.UTC(tahun, bulan - 1, 1));
    const endDate = new Date(Date.UTC(tahun, bulan, 1));
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';
    const satminkalScope = this.resolveSatminkalScope(user, satminkalIdParam);

    const simpananList = await this.prisma.simpanan.findMany({
      where: {
        anggota: {
          ...satminkalScope,
          ...(isAnggota ? { nrpNip: user.username } : {}),
        },
        createdAt: { gte: startDate, lt: endDate },
      },
      include: {
        anggota: { include: { pangkat: true, korps: true, satminkal: true } },
      },
      orderBy: [
        { anggota: { satminkal: { kode: 'asc' } } },
        { anggota: { pangkat: { kodePkt: 'desc' } } },
        { anggota: { nama: 'asc' } },
        { createdAt: 'desc' },
      ],
    });

    return simpananList.map((s) => ({
      id: s.id,
      namaAnggota: s.anggota.nama,
      nrpNip: s.anggota.nrpNip,
      pangkat: s.anggota.pangkat?.nama ?? '-',
      kategoriPangkat: s.anggota.pangkat?.kategori ?? '-',
      korps: s.anggota.korps?.nama ?? s.anggota.korps?.kode ?? '-',
      jenis: s.jenis,
      tipe: s.tipe,
      nominal: toNumber(s.nominal),
      tanggal: s.createdAt,
      periode: s.periode,
      keterangan: s.keterangan,
      noInvoice: s.noInvoice,
    }));
  }

  async sukarelaMassal(user: JwtUser, dto?: SimpananMassalDto) {
    const rawDate = dto?.periode || new Date().toISOString().slice(0, 10);
    const periode = this.normalizeTanggal5(rawDate);

    const anggotaList = await this.prisma.anggota.findMany({
      where: { satminkalId: user.satminkalId, isAktif: true },
      include: { pangkat: true },
    });

    if (anggotaList.length === 0) {
      throw new BadRequestException('Tidak ada anggota aktif');
    }

    const anggotaIds = anggotaList.map((a) => a.id);

    // Fetch seluruh transaksi sukarela periode ini dalam 1 query
    const existingSimpanan = await this.prisma.simpanan.findMany({
      where: {
        anggotaId: { in: anggotaIds },
        jenis: JenisSimpanan.SUKARELA,
        periode,
      },
      select: { anggotaId: true },
    });

    const existingAnggotaSet = new Set(
      existingSimpanan.map((s) => s.anggotaId),
    );

    const newEntries = anggotaList
      .filter((anggota) => !existingAnggotaSet.has(anggota.id))
      .map((anggota) => ({
        anggotaId: anggota.id,
        jenis: JenisSimpanan.SUKARELA,
        tipe: JenisTransaksiSimpanan.SETOR,
        nominal: decimal(this.sukarelaNominal(anggota.pangkat.kategori)),
        periode,
        keterangan: `Potong sukarela ${periode.toISOString().slice(0, 7)}`,
      }));

    if (newEntries.length > 0) {
      await this.prisma.simpanan.createMany({
        data: newEntries,
      });
    }

    return {
      periode: periode.toISOString().slice(0, 10),
      created: newEntries.length,
      skipped: anggotaList.length - newEntries.length,
      totalAnggota: anggotaList.length,
    };
  }

  // Penarikan Simpanan Sukarela dengan Validasi Saldo
  async tarikSukarela(
    user: JwtUser,
    anggotaId: string,
    nominal: number,
    keterangan?: string,
  ) {
    await this.assertAnggotaScope(user, anggotaId);

    if (nominal <= 0) {
      throw new BadRequestException('Nominal penarikan harus lebih dari 0');
    }

    const simpananRows = await this.prisma.simpanan.findMany({
      where: { anggotaId, jenis: JenisSimpanan.SUKARELA },
      select: { tipe: true, nominal: true },
    });

    const totalSaldoSukarela = simpananRows.reduce((acc, curr) => {
      const val = toNumber(curr.nominal);
      return curr.tipe === JenisTransaksiSimpanan.SETOR ? acc + val : acc - val;
    }, 0);

    if (totalSaldoSukarela < nominal) {
      throw new BadRequestException(
        `Saldo simpanan sukarela tidak mencukupi. Saldo saat ini: Rp ${totalSaldoSukarela.toLocaleString('id-ID')}`,
      );
    }

    return this.prisma.simpanan.create({
      data: {
        anggotaId,
        jenis: JenisSimpanan.SUKARELA,
        tipe: JenisTransaksiSimpanan.TARIK,
        nominal: decimal(nominal),
        keterangan: keterangan ?? 'Penarikan simpanan sukarela',
      },
    });
  }

  private sukarelaNominal(kategori: KategoriPangkat): number {
    return SUKARELA_BY_KATEGORI[kategori];
  }

  private normalizeTanggal5(isoDate: string): Date {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Format periode tidak valid');
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 5));
  }

  private async assertAnggotaScope(user: JwtUser, anggotaId: string) {
    let where: any = { id: anggotaId };
    if (user.role === Role.SUPER_ADMIN) {
      where = { id: anggotaId };
    } else if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      where = { id: anggotaId, satminkal: { kotamaId: user.kotamaId } };
    } else if (user.satminkalId) {
      where = { id: anggotaId, satminkalId: user.satminkalId };
    }

    const anggota = await this.prisma.anggota.findFirst({
      where,
      include: { satminkal: true },
    });
    if (!anggota) {
      throw new NotFoundException('Anggota tidak ditemukan di Satminkal / Kotama Anda');
    }
    if ((user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') && anggota.nrpNip !== user.username) {
      throw new BadRequestException('Anda hanya diizinkan mengakses data akun Anda sendiri');
    }
    return anggota;
  }

  // ========== BATCH SIMPANAN DARI EXCEL GOLONGAN (Bendahara / Admin) ==========

  async batchSimpananGolongan(user: JwtUser, dto: BatchSimpananGolonganDto) {
    if (user.role === Role.ANGGOTA || (user.role as any) === 'Anggota') {
      throw new BadRequestException('Hanya Bendahara yang dapat mengunggah file Excel simpanan massal');
    }
    if (!dto.rates || dto.rates.length === 0) {
      throw new BadRequestException('Data tarif golongan tidak boleh kosong');
    }

    // Normalisasi periode tanggal (default tgl 1 bulan berjalan jika tidak ada)
    let periodeDate = new Date();
    if (dto.periode) {
      const parts = dto.periode.split('-');
      if (parts.length >= 2) {
        periodeDate = new Date(Date.UTC(+parts[0], +parts[1] - 1, 1));
      }
    }

    // Pemetaan Rate per Golongan
    const rateMap = new Map<string, { pokok: number; wajib: number }>();
    for (const r of dto.rates) {
      const key = this.matchGolonganKey(r.golongan);
      rateMap.set(key, {
        pokok: Math.max(0, Number(r.nominalPokok) || 0),
        wajib: Math.max(0, Number(r.nominalWajib) || 0),
      });
    }

    // Ambil seluruh anggota aktif di Satminkal ini
    const anggotaList = await this.prisma.anggota.findMany({
      where: { satminkalId: user.satminkalId, isAktif: true },
      include: {
        pangkat: true,
        korps: true,
      },
    });

    if (anggotaList.length === 0) {
      throw new BadRequestException('Tidak ada data anggota aktif di Satuan ini');
    }

    const newEntries: any[] = [];
    let totalPokok = 0;
    let totalWajib = 0;

    const rincianPerAnggota: any[] = [];

    for (const a of anggotaList) {
      const golongan = this.mapKategoriToGolongan(a.pangkat?.kategori || '');
      const rate = rateMap.get(golongan) || { pokok: 0, wajib: 0 };

      let potongPokok = rate.pokok;
      let potongWajib = rate.wajib;

      if (potongPokok > 0) {
        newEntries.push({
          anggotaId: a.id,
          jenis: JenisSimpanan.POKOK,
          tipe: JenisTransaksiSimpanan.SETOR,
          nominal: decimal(potongPokok),
          periode: periodeDate,
          keterangan: dto.keterangan ? `${dto.keterangan} - Pokok (${golongan})` : `Simpanan Pokok via Excel (${golongan})`,
        });
        totalPokok += potongPokok;
      }

      if (potongWajib > 0) {
        newEntries.push({
          anggotaId: a.id,
          jenis: JenisSimpanan.WAJIB,
          tipe: JenisTransaksiSimpanan.SETOR,
          nominal: decimal(potongWajib),
          periode: periodeDate,
          keterangan: dto.keterangan ? `${dto.keterangan} - Wajib (${golongan})` : `Simpanan Wajib via Excel (${golongan})`,
        });
        totalWajib += potongWajib;
      }

      rincianPerAnggota.push({
        id: a.id,
        nama: a.nama,
        nrpNip: a.nrpNip,
        pangkat: a.pangkat?.nama ?? '-',
        kategoriPangkat: a.pangkat?.kategori ?? '-',
        korps: a.korps?.nama ?? a.korps?.kode ?? '-',
        golongan,
        simpananPokok: potongPokok,
        simpananWajib: potongWajib,
        totalPotongan: potongPokok + potongWajib,
      });
    }

    if (newEntries.length > 0) {
      await this.prisma.simpanan.createMany({
        data: newEntries,
      });
    }

    // Urutkan rincian anggota berdasarkan hierarki golongan: Pati -> Pamen -> Pama -> Ba/Ta/Pns
    const HIERARKI_ORDER: Record<string, number> = {
      Pati: 1,
      Pamen: 2,
      Pama: 3,
      'Ba/Ta/Pns': 4,
    };

    rincianPerAnggota.sort((a, b) => {
      const orderA = HIERARKI_ORDER[a.golongan] ?? 99;
      const orderB = HIERARKI_ORDER[b.golongan] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.nama.localeCompare(b.nama);
    });

    return {
      message: 'Simpanan Pokok & Wajib via Excel berhasil diproses ke database',
      periode: periodeDate.toISOString().slice(0, 7),
      totalAnggota: anggotaList.length,
      totalTransaksi: newEntries.length,
      totalPokok,
      totalWajib,
      totalNominal: totalPokok + totalWajib,
      rincian: rincianPerAnggota,
    };
  }

  private mapKategoriToGolongan(kategori: string): 'Pati' | 'Pamen' | 'Pama' | 'Ba/Ta/Pns' {
    const kat = (kategori || '').toUpperCase();
    if (kat.includes('PATI')) return 'Pati';
    if (kat.includes('PAMEN')) return 'Pamen';
    if (kat.includes('PAMA')) return 'Pama';
    return 'Ba/Ta/Pns';
  }

  private matchGolonganKey(golonganInput: string): 'Pati' | 'Pamen' | 'Pama' | 'Ba/Ta/Pns' {
    const g = (golonganInput || '').toLowerCase().trim();
    if (g.includes('pati')) return 'Pati';
    if (g.includes('pamen')) return 'Pamen';
    if (g.includes('pama')) return 'Pama';
    return 'Ba/Ta/Pns';
  }
}
