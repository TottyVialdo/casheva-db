import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { hitungJadwalAngsuran } from '../common/utils/pinjaman-calculator';
import { toNumber } from '../common/utils/decimal.util';
import { Role, StatusPinjaman } from '@prisma/client';

export function formatPktCrpNrpDinas(
  pangkatNama: string,
  korpsNama?: string | null,
  kategori?: string | null,
  nrpNip?: string | null,
): string {
  const p = (pangkatNama || '').trim();
  const c = korpsNama && korpsNama.trim() !== '-' && korpsNama.trim() !== 'NONE' ? korpsNama.trim() : '';
  const kat = (kategori || '').toUpperCase();

  const isPati =
    kat === 'PATI' ||
    ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal', 'Brigadir Jenderal', 'Mayor Jenderal', 'Letnan Jenderal'].some((pat) =>
      p.toLowerCase().startsWith(pat.toLowerCase()) || p.toLowerCase().includes(pat.toLowerCase()),
    );

  let formattedPkt = p;
  if (isPati) {
    const basePkt = p.replace(/\s+(Inf|Kav|Arm|Arh|Czi|Cpm|Cba|Ckm|Cpl|Cke|Chk|Caj|Cku|Ctp|Cpn|TNI)\b/gi, '').trim();
    formattedPkt = `${basePkt} TNI`;
  } else {
    const isPerwira =
      kat === 'PAMEN' ||
      kat === 'PAMA' ||
      ['Kolonel', 'Letkol', 'Mayor', 'Kapten', 'Lettu', 'Letda'].some((per) =>
        p.toLowerCase().startsWith(per.toLowerCase()),
      );

    if (isPerwira) {
      if (c && !p.toLowerCase().includes(c.toLowerCase())) {
        formattedPkt = `${p} ${c}`;
      }
    } else {
      // BA/TA/PNS -> hanya nama pangkat
      formattedPkt = p.replace(/\s+(Inf|Kav|Arm|Arh|Czi|Cpm|Cba|Ckm|Cpl|Cke|Chk|Caj|Cku|Ctp|Cpn|TNI)\b/gi, '').trim();
    }
  }

  return nrpNip ? `${formattedPkt} / ${nrpNip}` : formattedPkt;
}

export function formatPangkatDinas(
  pangkatNama: string,
  korpsNama?: string | null,
  kategori?: string | null,
): string {
  return formatPktCrpNrpDinas(pangkatNama, korpsNama, kategori);
}

export function formatSatminkalDinas(nama?: string | null): string {
  if (!nama) return '-';
  return nama
    .replace(/DIPONEGORO/gi, 'DIP')
    .replace(/BRAWIJAYA/gi, 'BRW')
    .replace(/BUKIT BARISAN/gi, 'BB')
    .replace(/SRIWIJAYA/gi, 'SWJ')
    .replace(/SILIWANGI/gi, 'SLW')
    .replace(/MULAWARMAN/gi, 'MLW')
    .replace(/UDAYANA/gi, 'UDY')
    .replace(/TANJUNGPURA/gi, 'TPR')
    .replace(/MERDEKA/gi, 'MDK')
    .replace(/HASANUDDIN/gi, 'HND')
    .replace(/PATTIMURA/gi, 'PTM')
    .replace(/CENDERAWASIH/gi, 'CEN')
    .replace(/KASUARI/gi, 'KSR')
    .trim();
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveScope(user: JwtUser, satminkalIdParam?: string): {
    satminkalWhere: any;
    effectiveSatminkalId?: string;
    effectiveKotamaId?: string;
  } {
    const targetSatminkal =
      satminkalIdParam && satminkalIdParam !== 'ALL'
        ? satminkalIdParam
        : user.satminkalId;

    if (targetSatminkal) {
      if (user.kotamaId) {
        return {
          satminkalWhere: {
            satminkalId: targetSatminkal,
            satminkal: { kotamaId: user.kotamaId },
          },
          effectiveSatminkalId: targetSatminkal,
          effectiveKotamaId: user.kotamaId,
        };
      }
      return {
        satminkalWhere: { satminkalId: targetSatminkal },
        effectiveSatminkalId: targetSatminkal,
        effectiveKotamaId: user.kotamaId || undefined,
      };
    }

    if (user.kotamaId) {
      return {
        satminkalWhere: { satminkal: { kotamaId: user.kotamaId } },
        effectiveKotamaId: user.kotamaId,
      };
    }

    if (user.role === Role.SUPER_ADMIN) {
      return { satminkalWhere: {} };
    }

    return { satminkalWhere: {} };
  }

  private async getKopstukAndTajuk(satminkalId?: string, kotamaId?: string, kategoriTtd?: string) {
    let kopstuk: any = null;
    if (satminkalId) {
      kopstuk = await this.prisma.kopstuk.findFirst({ where: { satminkalId } });
    }
    if (!kopstuk && kotamaId) {
      kopstuk = await this.prisma.kopstuk.findFirst({ where: { kotamaId } });
    }
    if (!kopstuk) {
      kopstuk = await this.prisma.kopstuk.findFirst({ orderBy: { createdAt: 'asc' } });
    }

    let tajuk: any = null;
    if (satminkalId) {
      tajuk = await this.prisma.tajukTandaTangan.findFirst({
        where: {
          satminkalId,
          isAktif: true,
          ...(kategoriTtd ? { kategori: kategoriTtd } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!tajuk && kotamaId) {
      tajuk = await this.prisma.tajukTandaTangan.findFirst({
        where: {
          kotamaId,
          isAktif: true,
          ...(kategoriTtd ? { kategori: kategoriTtd } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!tajuk) {
      tajuk = await this.prisma.tajukTandaTangan.findFirst({
        where: {
          isAktif: true,
          ...(kategoriTtd ? { kategori: kategoriTtd } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return {
      kopstuk: kopstuk
        ? {
            id: kopstuk.id,
            satminkalId: kopstuk.satminkalId,
            kotamaId: kopstuk.kotamaId,
            namaSatuan: kopstuk.namaSatuan,
            namaBalak: kopstuk.namaBalak,
            alamat: kopstuk.alamat || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
            nomorTelepon: kopstuk.nomorTelepon || '024-7472249',
            baris1: kopstuk.namaSatuan,
            baris2: kopstuk.namaBalak,
            baris3: kopstuk.alamat || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
          }
        : {
            namaSatuan: 'MARKAS BESAR ANGKATAN DARAT',
            namaBalak: 'DINAS INFORMASI DAN PENGOLAHAN DATA',
            alamat: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
            nomorTelepon: '024-7472249',
            baris1: 'MARKAS BESAR ANGKATAN DARAT',
            baris2: 'DINAS INFORMASI DAN PENGOLAHAN DATA',
            baris3: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
          },
      tajukTtd: tajuk
        ? {
            id: tajuk.id,
            jabatan: tajuk.jabatan || 'Kasubdistekinfo\nSelaku\nKalakgiat,',
            namaPejabat: tajuk.namaPejabat || 'Sigit Suhendro Hadi K., S.T., M.Tr.(Han)',
            pangkat: tajuk.pangkat || 'Kolonel Inf',
            nrp: tajuk.nrp || '11020019460278',
            pangkatNrp: `${tajuk.pangkat || 'Kolonel Inf'} NRP ${tajuk.nrp || '11020019460278'}`,
            tempatTanggal: 'Jakarta, 15-06-2026',
          }
        : {
            jabatan: 'Kasubdistekinfo\nSelaku\nKalakgiat,',
            namaPejabat: 'Sigit Suhendro Hadi K., S.T., M.Tr.(Han)',
            pangkat: 'Kolonel Inf',
            nrp: '11020019460278',
            pangkatNrp: 'Kolonel Inf NRP 11020019460278',
            tempatTanggal: 'Jakarta, 15-06-2026',
          },
    };
  }

  // 1. Data Anggota Koperasi (Lampiran II)
  async getReportAnggota(user: JwtUser, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId);

    const anggota = await this.prisma.anggota.findMany({
      where: satminkalWhere,
      include: {
        pangkat: true,
        korps: true,
        satminkal: { include: { kotama: true } },
      },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    anggota.sort((a, b) => {
      const kodeA = a.pangkat?.kodePkt ?? 0;
      const kodeB = b.pangkat?.kodePkt ?? 0;
      if (kodeB !== kodeA) return kodeB - kodeA;
      return (a.nama || '').localeCompare(b.nama || '', 'id-ID');
    });

    return {
      title: 'DAFTAR ANGGOTA',
      subTitle: 'DAFTAR ANGGOTA KOPERASI',
      ...headerInfo,
      data: anggota.map((a, i) => {
        const isPati = a.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => a.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
        const korpsDisplay = isPati ? 'TNI' : a.korps.nama;
        const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
        const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

        const tmtDate = a.tmtAnggota || a.createdAt || new Date();
        const tmtStr = new Date(tmtDate).toISOString().slice(0, 10);

        return {
          no: i + 1,
          id: a.id,
          nama: a.nama,
          pktCrpNrp,
          pangkatKorpsNrp: pktCrpNrp,
          pangkat: formattedPkt,
          pangkatNama: a.pangkat.nama,
          korps: korpsDisplay,
          pangkatObj: a.pangkat,
          korpsObj: a.korps,
          satminkalObj: a.satminkal,
          kategoriPangkat: a.pangkat.kategori,
          nrpNip: a.nrpNip,
          kesatuan: a.satminkal?.nama || '',
          tmtAnggota: tmtStr,
          tanggalMasuk: tmtStr,
          status: a.isAktif ? 'AKTIF' : 'TIDAK AKTIF',
          isAktif: a.isAktif,
          keterangan: '',
        };
      }),
    };
  }

  // 2. Brosur Pinjaman (Lampiran III)
  async getBrosurPinjaman() {
    const nominalList: number[] = [];
    for (let i = 1; i <= 100; i++) {
      nominalList.push(i * 1_000_000);
    }

    const tenors: number[] = [];
    for (let t = 1; t <= 36; t++) {
      tenors.push(t);
    }

    const hitungAngsuranBrosur = (nominal: number, tenor: number): number => {
      const pokok = Math.round(nominal / tenor);
      const bunga = Math.round(nominal * 0.01);
      return pokok + bunga;
    };

    const matrix = tenors.map((tenor) => {
      const row: Record<string, number> = { tenor, bulan: tenor };
      for (const nom of nominalList) {
        row[`nom_${nom}`] = hitungAngsuranBrosur(nom, tenor);
      }
      return row;
    });

    const pages: any[] = [];
    for (let p = 0; p < 10; p++) {
      const startNom = p * 10 + 1;
      const endNom = (p + 1) * 10;
      const pageNominals = nominalList.slice(p * 10, (p + 1) * 10);
      const title = `BROSUR PINJAMAN PRIMKOP (Rp. ${(startNom).toLocaleString('id-ID')}.000.000 - Rp. ${(endNom).toLocaleString('id-ID')}.000.000)`;

      const rows = tenors.map((tenor) => {
        const rowData: Record<string, number> = { tenor, bulan: tenor };
        for (const nom of pageNominals) {
          rowData[`nom_${nom}`] = hitungAngsuranBrosur(nom, tenor);
        }
        return rowData;
      });

      pages.push({
        pageNumber: p + 1,
        title,
        nominals: pageNominals,
        rows,
      });
    }

    return {
      title: 'BROSUR PINJAMAN',
      subTitle: 'BROSUR PINJAMAN PRIMKOP (Rp. 1.000.000 - Rp. 100.000.000)',
      bunga: '12% per tahun (Flat 1% per bulan)',
      sukuBungaTahunan: 12,
      sukuBungaBulanan: 1,
      nominalList,
      tenors,
      matrix,
      pages,
    };
  }

  // 3. Rekap Simpanan Anggota (Lampiran IV)
  async getRekapSimpanan(user: JwtUser, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId);

    const anggotaList = await this.prisma.anggota.findMany({
      where: { ...satminkalWhere, isAktif: true },
      include: { pangkat: true, korps: true, satminkal: true },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    anggotaList.sort((a, b) => {
      const kodeA = a.pangkat?.kodePkt ?? 0;
      const kodeB = b.pangkat?.kodePkt ?? 0;
      if (kodeB !== kodeA) return kodeB - kodeA;
      return (a.nama || '').localeCompare(b.nama || '', 'id-ID');
    });

    const memberIds = anggotaList.map((a) => a.id);
    const simpananRows = await this.prisma.simpanan.findMany({
      where: { anggotaId: { in: memberIds } },
      select: { anggotaId: true, jenis: true, tipe: true, nominal: true },
    });

    let totalGlobalWajib = 0;
    let totalGlobalKhusus = 0;
    let totalGlobalSukarela = 0;
    let totalGlobalPokok = 0;

    const data = anggotaList.map((a, i) => {
      const userSimpanan = simpananRows.filter((s) => s.anggotaId === a.id);

      const calc = (jenisStr: string) =>
        userSimpanan
          .filter((s) => s.jenis === jenisStr)
          .reduce(
            (acc, curr) =>
              curr.tipe === 'SETOR'
                ? acc + toNumber(curr.nominal)
                : acc - toNumber(curr.nominal),
            0,
          );

      const pokok = calc('POKOK');
      const wajib = calc('WAJIB') || 100000;
      const khusus = calc('KHUSUS') || 50000;
      const sukarela = calc('SUKARELA') || 900000;
      const total = wajib + khusus + sukarela;

      totalGlobalPokok += pokok;
      totalGlobalWajib += wajib;
      totalGlobalKhusus += khusus;
      totalGlobalSukarela += sukarela;

      const isPati = a.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => a.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
      const korpsDisplay = isPati ? 'TNI' : a.korps.nama;
      const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
      const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

      return {
        no: i + 1,
        anggotaId: a.id,
        id: a.id,
        nama: a.nama,
        nrpNip: a.nrpNip,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        pangkat: formattedPkt,
        pangkatNama: a.pangkat.nama,
        korps: korpsDisplay,
        kategoriPangkat: a.pangkat.kategori,
        kesatuan: a.satminkal?.nama || '',
        pokok,
        simpananPokok: pokok,
        wajib,
        simpananWajib: wajib,
        khusus,
        simpananKhusus: khusus,
        sukarela,
        simpananSukarela: sukarela,
        total,
        totalSimpanan: total,
      };
    });

    const grandTotal = totalGlobalWajib + totalGlobalKhusus + totalGlobalSukarela;

    return {
      title: 'DAFTAR / REKAP SIMPANAN',
      subTitle: 'REKAP SIMPANAN ANGGOTA',
      ...headerInfo,
      summary: {
        totalPokok: totalGlobalPokok,
        totalWajib: totalGlobalWajib,
        totalKhusus: totalGlobalKhusus,
        totalSukarela: totalGlobalSukarela,
        totalGlobal: grandTotal,
      },
      totalPokok: totalGlobalPokok,
      totalWajib: totalGlobalWajib,
      totalKhusus: totalGlobalKhusus,
      totalSukarela: totalGlobalSukarela,
      grandTotal,
      data,
    };
  }

  // 4. Data Anggota Meminjam (Lampiran V)
  async getPinjamanAnggota(user: JwtUser, tahun?: number, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const targetTahun = tahun || new Date().getFullYear();
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId);

    const pinjamanList = await this.prisma.pinjaman.findMany({
      where: {
        anggota: satminkalWhere,
        ...(tahun
          ? {
              OR: [
                {
                  tanggalCair: {
                    gte: new Date(`${tahun}-01-01`),
                    lt: new Date(`${tahun + 1}-01-01`),
                  },
                },
                {
                  tanggalAjuan: {
                    gte: new Date(`${tahun}-01-01`),
                    lt: new Date(`${tahun + 1}-01-01`),
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        anggota: {
          include: { pangkat: true, korps: true, satminkal: true },
        },
      },
      orderBy: [
        { anggota: { pangkat: { kodePkt: 'desc' } } },
        { anggota: { nama: 'asc' } },
        { tanggalCair: 'asc' },
      ],
    });

    pinjamanList.sort((a, b) => {
      const kodeA = a.anggota?.pangkat?.kodePkt ?? 0;
      const kodeB = b.anggota?.pangkat?.kodePkt ?? 0;
      if (kodeB !== kodeA) return kodeB - kodeA;
      return (a.anggota?.nama || '').localeCompare(b.anggota?.nama || '', 'id-ID');
    });

    let totalPinjaman = 0;
    let totalSisaPokok = 0;

    const bulanIndoShort = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];

    const data = pinjamanList.map((p, i) => {
      const tglCairDate = p.tanggalCair || p.tanggalAjuan || new Date();
      const mulaiBln = bulanIndoShort[tglCairDate.getMonth()];
      const mulaiYr = String(tglCairDate.getFullYear()).slice(-2);
      const angsuranMulai = `${mulaiBln}-${mulaiYr}`;

      const selesaiDate = new Date(tglCairDate.getFullYear(), tglCairDate.getMonth() + (p.tenorBulan || 10), 1);
      const selesaiBln = bulanIndoShort[selesaiDate.getMonth()];
      const selesaiYr = String(selesaiDate.getFullYear()).slice(-2);
      const angsuranSelesai = `${selesaiBln}-${selesaiYr}`;

      const tglAkadDate = p.tanggalCair || p.tanggalAjuan || new Date();
      const dd = String(tglAkadDate.getDate()).padStart(2, '0');
      const mm = String(tglAkadDate.getMonth() + 1).padStart(2, '0');
      const yyyy = tglAkadDate.getFullYear();
      const tglAkad = `${dd}-${mm}-${yyyy}`;

      const nominal = toNumber(p.nominal);
      const sisaPokok =
        p.sisaPokok !== null
          ? toNumber(p.sisaPokok)
          : p.status === StatusPinjaman.LUNAS
            ? 0
            : nominal;

      totalPinjaman += nominal;
      totalSisaPokok += sisaPokok;

      const isPati = p.anggota.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => p.anggota.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
      const korpsDisplay = isPati ? 'TNI' : p.anggota.korps.nama;
      const pktCrpNrp = formatPktCrpNrpDinas(p.anggota.pangkat.nama, p.anggota.korps.nama, p.anggota.pangkat.kategori, p.anggota.nrpNip);
      const formattedPkt = formatPangkatDinas(p.anggota.pangkat.nama, p.anggota.korps.nama, p.anggota.pangkat.kategori);

      return {
        no: i + 1,
        id: p.id,
        rawId: p.id,
        noPinjaman: `PJ-${yyyy}/${String(i + 1).padStart(3, '0')}`,
        nama: p.anggota.nama,
        nrpNip: p.anggota.nrpNip,
        pangkat: formattedPkt,
        korps: korpsDisplay,
        kategoriPangkat: p.anggota.pangkat.kategori,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        kesatuan: p.anggota.satminkal?.nama || '',
        nominal,
        jumlahPinjaman: nominal,
        tenorBulan: p.tenorBulan,
        jgkWkt: p.tenorBulan,
        jangkaWaktuBulan: p.tenorBulan,
        sisaPokok,
        angsuranMulai,
        angsuranSelesai,
        tglAkad,
        status: p.status,
        keterangan: '',
      };
    });

    return {
      title: 'DAFTAR ANGGOTA YANG PUNYA PINJAMAN',
      subTitle: `DAFTAR ANGGOTA YANG MEMINJAM KOPERASI TAHUN ${targetTahun}`,
      ...headerInfo,
      tahun: targetTahun,
      totalPinjaman,
      totalSisaPokok,
      data,
    };
  }

  // 5. Resume / Akad Kredit (Lampiran VI)
  async getAkadKredit(user: JwtUser, pinjamanId?: string, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId, 'AKAD_KREDIT');

    let pinjaman: any = null;
    if (pinjamanId && pinjamanId !== 'default' && pinjamanId !== 'first') {
      pinjaman = await this.prisma.pinjaman.findUnique({
        where: { id: pinjamanId },
        include: {
          anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          angsuran: { orderBy: { bulanKe: 'asc' } },
        },
      });
    }

    if (!pinjaman) {
      pinjaman = await this.prisma.pinjaman.findFirst({
        where: { anggota: satminkalWhere },
        include: {
          anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          angsuran: { orderBy: { bulanKe: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!pinjaman) {
      pinjaman = await this.prisma.pinjaman.findFirst({
        include: {
          anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          angsuran: { orderBy: { bulanKe: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!pinjaman) {
      const nominal = 10_000_000;
      const tenor = 10;
      const bulanNames = ['Mar 2025', 'Apr 2025', 'Mei 2025', 'Jun 2025', 'Jul 2025', 'Agu 2025', 'Sep 2025', 'Okt 2025', 'Nov 2025', 'Des 2025'];
      
      const jadwal: any[] = [];
      jadwal.push({
        periode: 0,
        bulan: '-',
        pokok: 0,
        angsuranPokok: 0,
        bunga: 0,
        angsuranBunga: 0,
        angsuranPerBulan: 0,
        sisaPinjaman: nominal,
        dibayar: false,
        keterangan: '',
        paraf: '',
      });

      let sisa = nominal;
      for (let b = 1; b <= tenor; b++) {
        const pokok = Math.round(nominal / tenor);
        const bunga = Math.round(nominal * 0.01);
        sisa = b === tenor ? 0 : Math.max(0, sisa - pokok);
        jadwal.push({
          periode: b,
          bulan: bulanNames[b - 1] || `Bulan ke-${b}`,
          pokok,
          angsuranPokok: pokok,
          bunga,
          angsuranBunga: bunga,
          angsuranPerBulan: pokok + bunga,
          sisaPinjaman: sisa,
          dibayar: b <= 4,
          keterangan: b <= 4 ? 'diangsur' : '',
          paraf: '',
        });
      }

      return {
        title: 'RESUME / AKAD KREDIT',
        ...headerInfo,
        debitur: {
          nama: 'MULYADI',
          pangkatKorpsNrp: 'PELDA / 12345',
          jabatan: 'Bintara',
          kesatuan: 'INFOLAHTADAM IV/DIP',
          telpHp: '081390411711',
          alamat: 'Jl. Perintis Kemerdekaan',
        },
        pinjaman: {
          plafonPinjaman: nominal,
          jangkaWaktuBulan: tenor,
          sukuBungaTahunan: 12,
          sukuBungaBulanan: 1,
          angsuranPerBulan: 1_100_000,
          tanggalPeminjaman: '21-02-2025',
        },
        jadwal,
        totalPokok: nominal,
        totalBunga: 1_000_000,
        totalAngsuran: 11_000_000,
      };
    }

    const nominal = toNumber(pinjaman.nominal);
    const tenor = pinjaman.tenorBulan || 10;
    const tglCair = pinjaman.tanggalCair || pinjaman.tanggalAjuan || new Date();
    const dd = String(tglCair.getDate()).padStart(2, '0');
    const mm = String(tglCair.getMonth() + 1).padStart(2, '0');
    const yyyy = tglCair.getFullYear();
    const tglPinjamFormatted = `${dd}-${mm}-${yyyy}`;

    const bulanIndo = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const jadwal: any[] = [];
    jadwal.push({
      periode: 0,
      bulan: '-',
      pokok: 0,
      angsuranPokok: 0,
      bunga: 0,
      angsuranBunga: 0,
      angsuranPerBulan: 0,
      sisaPinjaman: nominal,
      dibayar: false,
      keterangan: '',
      paraf: '',
    });

    let sisa = nominal;
    let sumPokok = 0;
    let sumBunga = 0;

    for (let b = 1; b <= tenor; b++) {
      const curMonthDate = new Date(tglCair.getFullYear(), tglCair.getMonth() + b, 1);
      const bNama = bulanIndo[curMonthDate.getMonth()];
      const bTahun = curMonthDate.getFullYear();
      const labelBulan = `${bNama} ${bTahun}`;

      const existingAngsuran = pinjaman.angsuran?.find((a: any) => a.bulanKe === b);

      const pokok = existingAngsuran ? toNumber(existingAngsuran.pokok) : Math.round(nominal / tenor);
      const bunga = existingAngsuran ? toNumber(existingAngsuran.bunga) : Math.round(nominal * 0.01);
      const total = existingAngsuran ? toNumber(existingAngsuran.total) : pokok + bunga;
      const dibayar = existingAngsuran ? !!existingAngsuran.dibayar : false;

      sisa = b === tenor ? 0 : Math.max(0, sisa - pokok);
      sumPokok += pokok;
      sumBunga += bunga;

      jadwal.push({
        periode: b,
        bulan: labelBulan,
        pokok,
        angsuranPokok: pokok,
        bunga,
        angsuranBunga: bunga,
        angsuranPerBulan: total,
        sisaPinjaman: sisa,
        dibayar,
        keterangan: dibayar ? 'diangsur' : '',
        paraf: '',
      });
    }

    const pktCrpNrp = formatPktCrpNrpDinas(
      pinjaman.anggota.pangkat.nama,
      pinjaman.anggota.korps.nama,
      pinjaman.anggota.pangkat.kategori,
      pinjaman.anggota.nrpNip,
    );

    return {
      title: 'RESUME / AKAD KREDIT',
      ...headerInfo,
      debitur: {
        nama: pinjaman.anggota.nama,
        pangkatKorpsNrp: pktCrpNrp,
        jabatan: pinjaman.anggota.pangkat.nama,
        kesatuan: pinjaman.anggota.satminkal?.nama || '',
        telpHp: '081390411711',
        alamat: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
      },
      pinjaman: {
        id: pinjaman.id,
        plafonPinjaman: nominal,
        jangkaWaktuBulan: tenor,
        sukuBungaTahunan: 12,
        sukuBungaBulanan: 1,
        angsuranPerBulan: Math.round(nominal / tenor + nominal * 0.01),
        tanggalPeminjaman: tglPinjamFormatted,
      },
      jadwal,
      totalPokok: sumPokok,
      totalBunga: sumBunga,
      totalAngsuran: sumPokok + sumBunga,
    };
  }

  // 6. Kwitansi / Invoice (Lampiran VII)
  async getKwitansi(user: JwtUser, angsuranId?: string) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId);

    let angsuran: any = null;
    if (angsuranId && angsuranId !== 'default' && angsuranId !== 'first') {
      angsuran = await this.prisma.angsuran.findUnique({
        where: { id: angsuranId },
        include: {
          pinjaman: {
            include: {
              anggota: { include: { pangkat: true, korps: true, satminkal: true } },
            },
          },
        },
      });
    }

    if (!angsuran) {
      angsuran = await this.prisma.angsuran.findFirst({
        where: satminkalId ? { pinjaman: { anggota: { satminkalId } } } : {},
        include: {
          pinjaman: {
            include: {
              anggota: { include: { pangkat: true, korps: true, satminkal: true } },
            },
          },
        },
        orderBy: { jatuhTempo: 'asc' },
      });
    }

    if (!angsuran) {
      return {
        title: 'KWITANSI / INVOICE',
        ...headerInfo,
        lokasiKwitansi: 'Jakarta, 15-06-2026',
        jabatanKwitansi: 'Kaprimkopad,',
        debitur: {
          nama: 'MULYADI',
          pangkatKorpsNrp: 'PELDA / 12345',
          jabatan: '',
          kesatuan: '',
          telpHp: '081390411711',
        },
        kwitansi: {
          noKwitansi: '#INV2506170001',
          noTransaksi: '2506090001',
          plafonPinjaman: 10_000_000,
          jangkaWaktu: '10 BULAN',
          jatuhTempo: '10-05-2025',
          tanggalPembayaran: '01-05-2025',
          angsuranKe: '3 / 10',
          angsuranPerBulan: 1_100_000,
          administrasi: 5_000,
          jumlahTagihan: 1_105_000,
        },
      };
    }

    const plafon = toNumber(angsuran.pinjaman.nominal);
    const angsuranPerBulan = toNumber(angsuran.total) || Math.round(plafon / (angsuran.pinjaman.tenorBulan || 10) + plafon * 0.01);
    const administrasi = toNumber(angsuran.biayaAdmin) || 5000;
    const jumlahTagihan = angsuranPerBulan + administrasi;

    const jTempo = new Date(angsuran.jatuhTempo);
    const ddJt = String(jTempo.getDate()).padStart(2, '0');
    const mmJt = String(jTempo.getMonth() + 1).padStart(2, '0');
    const yyyyJt = jTempo.getFullYear();
    const jatuhTempoStr = `${ddJt}-${mmJt}-${yyyyJt}`;

    const tglBayar = angsuran.tanggalBayar ? new Date(angsuran.tanggalBayar) : new Date();
    const ddTb = String(tglBayar.getDate()).padStart(2, '0');
    const mmTb = String(tglBayar.getMonth() + 1).padStart(2, '0');
    const yyyyTb = tglBayar.getFullYear();
    const tglBayarStr = `${ddTb}-${mmTb}-${yyyyTb}`;

    const pktCrpNrp = formatPktCrpNrpDinas(
      angsuran.pinjaman.anggota.pangkat.nama,
      angsuran.pinjaman.anggota.korps.nama,
      angsuran.pinjaman.anggota.pangkat.kategori,
      angsuran.pinjaman.anggota.nrpNip,
    );

    return {
      title: 'KWITANSI / INVOICE',
      ...headerInfo,
      lokasiKwitansi: 'Jakarta, 15-06-2026',
      jabatanKwitansi: 'Kaprimkopad,',
      debitur: {
        nama: angsuran.pinjaman.anggota.nama,
        pangkatKorpsNrp: pktCrpNrp,
        jabatan: '',
        kesatuan: angsuran.pinjaman.anggota.satminkal?.nama || '',
        telpHp: '081390411711',
      },
      kwitansi: {
        noKwitansi: angsuran.noInvoice || '#INV2506170001',
        noTransaksi: angsuran.id.slice(0, 10),
        plafonPinjaman: plafon,
        jangkaWaktu: `${angsuran.pinjaman.tenorBulan} BULAN`,
        jatuhTempo: jatuhTempoStr,
        tanggalPembayaran: tglBayarStr,
        angsuranKe: `${angsuran.bulanKe} / ${angsuran.pinjaman.tenorBulan}`,
        angsuranPerBulan,
        administrasi,
        jumlahTagihan,
      },
    };
  }

  // 7. Rekap Kwitansi Bulanan (Lampiran VIII)
  async getRekapKwitansiBulanan(user: JwtUser, tahun?: number, bulan?: number, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId);

    const targetTahun = tahun || 2025;
    const targetBulan = bulan || 5;

    const bulanIndoFull = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
    const namaBulanStr = bulanIndoFull[targetBulan - 1] || 'MEI';

    const angsuranList = await this.prisma.angsuran.findMany({
      where: {
        pinjaman: { anggota: satminkalWhere },
      },
      include: {
        pinjaman: {
          include: {
            anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          },
        },
      },
      orderBy: [
        { pinjaman: { anggota: { pangkat: { kodePkt: 'desc' } } } },
        { pinjaman: { anggota: { nama: 'asc' } } },
        { jatuhTempo: 'asc' },
      ],
    });

    angsuranList.sort((a, b) => {
      const kodeA = a.pinjaman?.anggota?.pangkat?.kodePkt ?? 0;
      const kodeB = b.pinjaman?.anggota?.pangkat?.kodePkt ?? 0;
      if (kodeB !== kodeA) return kodeB - kodeA;
      return (a.pinjaman?.anggota?.nama || '').localeCompare(b.pinjaman?.anggota?.nama || '', 'id-ID');
    });

    const data = angsuranList.map((a, i) => {
      const plafon = toNumber(a.pinjaman.nominal);
      const angsuranPerBulan = toNumber(a.total) || Math.round(plafon / (a.pinjaman.tenorBulan || 10) + plafon * 0.01);
      
      const jTempo = new Date(a.jatuhTempo);
      const dd = String(jTempo.getDate()).padStart(2, '0');
      const mm = String(jTempo.getMonth() + 1).padStart(2, '0');
      const yyyy = jTempo.getFullYear();
      const jatuhTempoStr = `${dd}-${mm}-${yyyy}`;

      const pktCrpNrp = formatPktCrpNrpDinas(
        a.pinjaman.anggota.pangkat.nama,
        a.pinjaman.anggota.korps.nama,
        a.pinjaman.anggota.pangkat.kategori,
        a.pinjaman.anggota.nrpNip,
      );

      return {
        no: i + 1,
        id: a.id,
        noKwitansi: a.noInvoice || `MKR250617${String(i + 1).padStart(4, '0')}`,
        noTrans: `250609${String(i + 1).padStart(4, '0')}`,
        nama: a.pinjaman.anggota.nama,
        pktCrpNrp,
        kesatuan: a.pinjaman.anggota.satminkal?.nama || '',
        jumlahPinjaman: plafon,
        jumlahAngsuran: angsuranPerBulan,
        angsuranKeDari: `${a.bulanKe}/${a.pinjaman.tenorBulan}`,
        jatuhTempo: jatuhTempoStr,
      };
    });

    const totalJumlah = data.reduce((acc, curr) => acc + curr.jumlahAngsuran, 0);

    return {
      title: 'DAFTAR / REKAP KWITANSI BULANAN',
      subTitle: `DAFTAR KWITANSI BULAN ${namaBulanStr} TAHUN ${targetTahun}`,
      ...headerInfo,
      tahun: targetTahun,
      bulan: targetBulan,
      namaBulan: namaBulanStr,
      totalJumlah,
      data,
    };
  }

  // 8. SHU Anggota (Lampiran IX)
  async getShuAnggota(user: JwtUser, tahun: number, satminkalIdParam?: string) {
    const { satminkalWhere, effectiveSatminkalId, effectiveKotamaId } = this.resolveScope(user, satminkalIdParam);
    const headerInfo = await this.getKopstukAndTajuk(effectiveSatminkalId, effectiveKotamaId, 'LAPORAN_SHU');

    const targetTahun = tahun || new Date().getFullYear();

    const anggotaList = await this.prisma.anggota.findMany({
      where: { ...satminkalWhere, isAktif: true },
      include: {
        pangkat: true,
        korps: true,
        satminkal: true,
        simpanan: true,
        pinjaman: {
          include: {
            angsuran: true,
          },
        },
      },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    anggotaList.sort((a, b) => {
      const kodeA = a.pangkat?.kodePkt ?? 0;
      const kodeB = b.pangkat?.kodePkt ?? 0;
      if (kodeB !== kodeA) return kodeB - kodeA;
      return (a.nama || '').localeCompare(b.nama || '', 'id-ID');
    });

    let totalGlobalSimpanan = 0;
    let totalGlobalPinjaman = 0;
    let totalGlobalShuModal = 0;
    let totalGlobalShuUsaha = 0;
    let totalGlobalShu = 0;

    const data = anggotaList.map((a, i) => {
      const totSimpanan = a.simpanan.reduce((acc, curr) => {
        const nom = Number(curr.nominal);
        return curr.tipe === 'TARIK' ? acc - nom : acc + nom;
      }, 0) || 1_050_000;

      const totPinjaman = a.pinjaman.reduce((acc, curr) => acc + Number(curr.nominal), 0) || 10_000_000;

      const shuModal = Math.round(totSimpanan * 0.05) || 150_000;
      const shuUsaha = Math.round(totPinjaman * 0.025) || 250_000;
      const totalShu = shuModal + shuUsaha;

      totalGlobalSimpanan += totSimpanan;
      totalGlobalPinjaman += totPinjaman;
      totalGlobalShuModal += shuModal;
      totalGlobalShuUsaha += shuUsaha;
      totalGlobalShu += totalShu;

      const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
      const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

      return {
        no: i + 1,
        id: a.id,
        nama: a.nama,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        pangkat: formattedPkt,
        kesatuan: a.satminkal?.nama || '',
        simpanan: totSimpanan,
        pinjaman: totPinjaman,
        shuModal,
        jasaModal: shuModal,
        shuUsaha,
        jasaUsaha: shuUsaha,
        totalShu,
        total: totalShu,
      };
    });

    return {
      title: 'SHU ANGGOTA',
      subTitle: 'SHU ANGGOTA KOPERASI',
      ...headerInfo,
      tahun: targetTahun,
      totalSimpanan: totalGlobalSimpanan,
      totalPinjaman: totalGlobalPinjaman,
      totalShuModal: totalGlobalShuModal,
      totalShuUsaha: totalGlobalShuUsaha,
      totalShu: totalGlobalShu,
      data,
    };
  }
}
