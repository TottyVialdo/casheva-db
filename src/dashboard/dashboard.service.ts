import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { toNumber } from '../common/utils/decimal.util';
import { StatusPinjaman } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(user: JwtUser) {
    const satminkalId = user.satminkalId;
    const currentYear = new Date().getFullYear();

    // JIKA USER ADALAH ANGGOTA: Hitung metrik personal anggota yang bersangkutan
    if (user.role === 'ANGGOTA' || (user.role as any) === 'Anggota') {
      let anggota = await this.prisma.anggota.findFirst({
        where: {
          satminkalId,
          nrpNip: user.username,
        },
        include: {
          pangkat: true,
          korps: true,
          satminkal: true,
        },
      });

      if (!anggota) {
        anggota = await this.prisma.anggota.findFirst({
          where: {
            nrpNip: user.username,
          },
          include: {
            pangkat: true,
            korps: true,
            satminkal: true,
          },
        });
      }

      if (anggota) {
        // 1. Simpanan Personal Anggota
        const simpananRows = await this.prisma.simpanan.findMany({
          where: { anggotaId: anggota.id },
          select: { tipe: true, nominal: true, jenis: true },
        });
        const totalSimpanan = simpananRows.reduce((acc, row) => {
          const val = toNumber(row.nominal);
          return row.tipe === 'SETOR' ? acc + val : acc - val;
        }, 0);

        const totalSimpananPokok = simpananRows
          .filter((r) => r.jenis === 'POKOK')
          .reduce((acc, r) => (r.tipe === 'SETOR' ? acc + toNumber(r.nominal) : acc - toNumber(r.nominal)), 0);

        const totalSimpananWajib = simpananRows
          .filter((r) => r.jenis === 'WAJIB')
          .reduce((acc, r) => (r.tipe === 'SETOR' ? acc + toNumber(r.nominal) : acc - toNumber(r.nominal)), 0);

        const totalSimpananSukarela = simpananRows
          .filter((r) => r.jenis === 'SUKARELA' || r.jenis === 'KHUSUS')
          .reduce((acc, r) => (r.tipe === 'SETOR' ? acc + toNumber(r.nominal) : acc - toNumber(r.nominal)), 0);

        // 2. Pinjaman Personal Anggota
        const pinjamanList = await this.prisma.pinjaman.findMany({
          where: {
            anggotaId: anggota.id,
            status: { notIn: [StatusPinjaman.DITOLAK, StatusPinjaman.DIAJUKAN] },
          },
          select: { nominal: true, status: true, sisaPokok: true },
        });
        const totalPinjaman = pinjamanList.reduce(
          (acc, p) => acc + toNumber(p.nominal),
          0,
        );

        const pinjamanBerjalanRows = pinjamanList.filter(
          (p) => p.status === StatusPinjaman.DICAIRKAN,
        );
        const totalPinjamanBerjalan = pinjamanBerjalanRows.reduce(
          (acc, p) => acc + toNumber(p.sisaPokok ?? p.nominal),
          0,
        );
        const countPinjamanBerjalan = pinjamanBerjalanRows.length;

        // 3. Angsuran Bulan Ini Personal Anggota
        const now = new Date();
        const currentMonth = now.getMonth();
        const angsuranList = await this.prisma.angsuran.findMany({
          where: {
            pinjaman: {
              anggotaId: anggota.id,
              status: StatusPinjaman.DICAIRKAN,
            },
          },
          orderBy: { bulanKe: 'asc' },
        });

        const angsuranBulanIniItem =
          angsuranList.find(
            (a) =>
              new Date(a.jatuhTempo).getMonth() === currentMonth &&
              new Date(a.jatuhTempo).getFullYear() === currentYear,
          ) || angsuranList.find((a) => !a.dibayar);

        const angsuranBulanIni = angsuranBulanIniItem
          ? toNumber(angsuranBulanIniItem.total)
          : 0;
        const statusAngsuranBulanIni = angsuranBulanIniItem
          ? angsuranBulanIniItem.dibayar
          : true;

        // 4. Estimasi SHU Personal (Berdasarkan proporsi simpanan terhadap total simpanan koperasi)
        const allSimpananRows = await this.prisma.simpanan.findMany({
          where: { anggota: { satminkalId } },
          select: { tipe: true, nominal: true },
        });
        const totalSimpananSatminkal = allSimpananRows.reduce((acc, r) => {
          const v = toNumber(r.nominal);
          return r.tipe === 'SETOR' ? acc + v : acc - v;
        }, 0);

        const aggregatePendapatan = await this.prisma.pendapatan.aggregate({
          where: { satminkalId, tahun: currentYear },
          _sum: { nominal: true },
        });
        const aggregateBiaya = await this.prisma.biayaOperasional.aggregate({
          where: { tahun: currentYear },
          _sum: { nominal: true },
        });
        const totalPendapatanYear = toNumber(aggregatePendapatan._sum.nominal ?? 0);
        const totalBiayaYear = toNumber(aggregateBiaya._sum.nominal ?? 0);
        const shuSatminkal = Math.max(0, totalPendapatanYear - totalBiayaYear);

        const shuTahunBerjalan =
          totalSimpananSatminkal > 0 && totalSimpanan > 0
            ? Math.round(
                (totalSimpanan / totalSimpananSatminkal) * (shuSatminkal * 0.7),
              )
            : 0;

        return {
          isAnggota: true,
          anggota: {
            id: anggota.id,
            nama: anggota.nama,
            nrpNip: anggota.nrpNip,
            pangkat: anggota.pangkat?.nama ?? '-',
            kategoriPangkat: anggota.pangkat?.kategori ?? '-',
            korps: anggota.korps?.nama ?? anggota.korps?.kode ?? '-',
            satminkal: anggota.satminkal?.nama ?? 'INFOLAHTADAM IV/DIPONEGORO',
          },
          totalAnggota: 1,
          totalSimpanan,
          totalSimpananPokok,
          totalSimpananWajib,
          totalSimpananSukarela,
          totalPinjaman,
          totalPinjamanBerjalan,
          countPinjamanBerjalan,
          angsuranBulanIni,
          statusAngsuranBulanIni,
          kasKoperasi: 0,
          shuTahunBerjalan,
          tahun: currentYear,
        };
      }
    }

    return this.getSummaryKoperasi(user, currentYear);
  }

  private resolveDashboardScope(user: JwtUser) {
    if (user.satminkalId) {
      return {
        anggotaWhere: { satminkalId: user.satminkalId },
        satminkalId: user.satminkalId,
      };
    }
    if (user.kotamaId) {
      return {
        anggotaWhere: { satminkal: { kotamaId: user.kotamaId } },
        kotamaId: user.kotamaId,
      };
    }
    return {
      anggotaWhere: {},
    };
  }

  // ========== SUMMARY KOPERASI / PENGURUS (Admin, Bendahara, Keprim, dll.) ==========
  private async getSummaryKoperasi(user: JwtUser, currentYear: number) {
    const { anggotaWhere, satminkalId, kotamaId } = this.resolveDashboardScope(user);

    // 1. Total Anggota Aktif
    const totalAnggota = await this.prisma.anggota.count({
      where: { ...anggotaWhere, isAktif: true },
    });

    // 2. Total Simpanan
    const simpananRows = await this.prisma.simpanan.findMany({
      where: { anggota: anggotaWhere },
      select: { tipe: true, nominal: true },
    });
    const totalSimpanan = simpananRows.reduce((acc, row) => {
      const val = toNumber(row.nominal);
      return row.tipe === 'SETOR' ? acc + val : acc - val;
    }, 0);

    // 3. Total Pinjaman (Akumulasi disetujui / dicairkan)
    const pinjamanList = await this.prisma.pinjaman.findMany({
      where: {
        anggota: anggotaWhere,
        status: { notIn: [StatusPinjaman.DITOLAK, StatusPinjaman.DIAJUKAN] },
      },
      select: { nominal: true, status: true, sisaPokok: true },
    });
    const totalPinjaman = pinjamanList.reduce(
      (acc, p) => acc + toNumber(p.nominal),
      0,
    );

    // 4. Pinjaman Berjalan (Status DICAIRKAN & sisaPokok > 0)
    const pinjamanBerjalanRows = pinjamanList.filter(
      (p) => p.status === StatusPinjaman.DICAIRKAN,
    );
    const totalPinjamanBerjalan = pinjamanBerjalanRows.reduce(
      (acc, p) => acc + toNumber(p.sisaPokok ?? p.nominal),
      0,
    );
    const countPinjamanBerjalan = pinjamanBerjalanRows.length;

    // 5. Pendapatan & Biaya Tahun Berjalan -> SHU Tahun Berjalan
    const aggregatePendapatan = await this.prisma.pendapatan.aggregate({
      where: {
        ...(satminkalId
          ? { satminkalId }
          : kotamaId
            ? { satminkal: { kotamaId } }
            : {}),
        tahun: currentYear,
      },
      _sum: { nominal: true },
    });
    const aggregateBiaya = await this.prisma.biayaOperasional.aggregate({
      where: {
        ...(satminkalId
          ? { satminkalId }
          : kotamaId
            ? { satminkal: { kotamaId } }
            : {}),
        tahun: currentYear,
      },
      _sum: { nominal: true },
    });

    const totalPendapatanYear = toNumber(aggregatePendapatan._sum.nominal ?? 0);
    const totalBiayaYear = toNumber(aggregateBiaya._sum.nominal ?? 0);
    const shuTahunBerjalan = totalPendapatanYear - totalBiayaYear;

    // 6. Estimasi Kas Koperasi (Kas = Simpanan + Angsuran Dibayar - Pinjaman Dicairkan + Pendapatan - Biaya Operasional)
    const totalAngsuranDibayarAgg = await this.prisma.angsuran.aggregate({
      where: {
        pinjaman: { anggota: anggotaWhere },
        dibayar: true,
      },
      _sum: { total: true },
    });
    const totalAngsuranDibayar = toNumber(totalAngsuranDibayarAgg._sum.total ?? 0);

    const totalPencairanAgg = await this.prisma.pinjaman.aggregate({
      where: {
        anggota: anggotaWhere,
        status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
      },
      _sum: { nominal: true },
    });
    const totalPencairan = toNumber(totalPencairanAgg._sum.nominal ?? 0);

    const kasKoperasi =
      totalSimpanan + totalAngsuranDibayar - totalPencairan - totalBiayaYear;

    return {
      isAnggota: false,
      totalAnggota,
      totalSimpanan,
      totalPinjaman,
      totalPinjamanBerjalan,
      countPinjamanBerjalan,
      kasKoperasi,
      shuTahunBerjalan,
      tahun: currentYear,
    };
  }

  async getCharts(user: JwtUser, tahun?: number) {
    const targetYear = tahun || new Date().getFullYear();
    const { anggotaWhere } = this.resolveDashboardScope(user);
    const isAnggota =
      user.role === 'ANGGOTA' || (user.role as any) === 'Anggota';

    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'Mei',
      'Jun',
      'Jul',
      'Agu',
      'Sep',
      'Okt',
      'Nov',
      'Des',
    ];

    // Data Simpanan Bulanan per Bulan
    const simpananList = await this.prisma.simpanan.findMany({
      where: {
        anggota: {
          ...anggotaWhere,
          ...(isAnggota ? { nrpNip: user.username } : {}),
        },
        createdAt: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
      },
      select: { createdAt: true, nominal: true, tipe: true },
    });

    // Data Pinjaman Bulanan (pencairan)
    const pinjamanList = await this.prisma.pinjaman.findMany({
      where: {
        anggota: {
          ...anggotaWhere,
          ...(isAnggota ? { nrpNip: user.username } : {}),
        },
        tanggalCair: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
        status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
      },
      select: { tanggalCair: true, nominal: true },
    });

    // Data Angsuran Bulanan (pembayaran)
    const angsuranList = await this.prisma.angsuran.findMany({
      where: {
        pinjaman: {
          anggota: {
            ...anggotaWhere,
            ...(isAnggota ? { nrpNip: user.username } : {}),
          },
        },
        dibayar: true,
        tanggalBayar: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
      },
      select: { tanggalBayar: true, total: true },
    });

    const monthlyData = monthNames.map((name, index) => {
      const monthSimpanan = simpananList
        .filter((s) => new Date(s.createdAt).getMonth() === index)
        .reduce(
          (sum, s) =>
            s.tipe === 'SETOR'
              ? sum + toNumber(s.nominal)
              : sum - toNumber(s.nominal),
          0,
        );

      const monthPinjaman = pinjamanList
        .filter(
          (p) => p.tanggalCair && new Date(p.tanggalCair).getMonth() === index,
        )
        .reduce((sum, p) => sum + toNumber(p.nominal), 0);

      const monthAngsuran = angsuranList
        .filter(
          (a) => a.tanggalBayar && new Date(a.tanggalBayar).getMonth() === index,
        )
        .reduce((sum, a) => sum + toNumber(a.total), 0);

      return {
        bulan: name,
        bulanIndex: index + 1,
        simpanan: monthSimpanan,
        pinjaman: monthPinjaman,
        angsuran: monthAngsuran,
      };
    });

    return {
      tahun: targetYear,
      data: monthlyData,
    };
  }

  // ========== KOTAMA / BALAKPUS AGGREGATE SUMMARY (RBAC.md Point 23 & 25) ==========
  async getKotamaSummary(user: JwtUser, kotamaIdParam?: string) {
    let targetKotamaId = kotamaIdParam || user.kotamaId;

    if (!targetKotamaId) {
      const firstKotama = await this.prisma.kotama.findFirst({
        where: { status: true },
      });
      targetKotamaId = firstKotama?.id;
    }

    if (!targetKotamaId) {
      return {
        kotamaId: null,
        kotamaName: '-',
        totalMembers: 0,
        totalSavings: 0,
        totalCash: 0,
        totalActiveLoans: 0,
        estimatedShu: 0,
        satminkalStatistics: [],
      };
    }

    const kotama = await this.prisma.kotama.findUnique({
      where: { id: targetKotamaId },
      include: {
        satminkal: {
          where: { status: true },
          orderBy: { nama: 'asc' },
        },
      },
    });

    if (!kotama) {
      return {
        kotamaId: targetKotamaId,
        kotamaName: '-',
        totalMembers: 0,
        totalSavings: 0,
        totalCash: 0,
        totalActiveLoans: 0,
        estimatedShu: 0,
        satminkalStatistics: [],
      };
    }

    const currentYear = new Date().getFullYear();
    const satminkalStats = await Promise.all(
      kotama.satminkal.map(async (sat) => {
        const satId = sat.id;

        // 1. Total Anggota Aktif
        const totalMembers = await this.prisma.anggota.count({
          where: { satminkalId: satId, isAktif: true },
        });

        // 2. Total Simpanan
        const simpananRows = await this.prisma.simpanan.findMany({
          where: { anggota: { satminkalId: satId } },
          select: { tipe: true, nominal: true },
        });
        const totalSavings = simpananRows.reduce((acc, row) => {
          const val = toNumber(row.nominal);
          return row.tipe === 'SETOR' ? acc + val : acc - val;
        }, 0);

        // 3. Total Pinjaman
        const pinjamanList = await this.prisma.pinjaman.findMany({
          where: {
            anggota: { satminkalId: satId },
            status: { notIn: [StatusPinjaman.DITOLAK, StatusPinjaman.DIAJUKAN] },
          },
          select: { nominal: true, status: true, sisaPokok: true },
        });
        const totalLoans = pinjamanList.reduce(
          (acc, p) => acc + toNumber(p.nominal),
          0,
        );

        const pinjamanBerjalanRows = pinjamanList.filter(
          (p) => p.status === StatusPinjaman.DICAIRKAN,
        );
        const totalActiveLoans = pinjamanBerjalanRows.reduce(
          (acc, p) => acc + toNumber(p.sisaPokok ?? p.nominal),
          0,
        );

        // 4. SHU Tahun Berjalan
        const aggregatePendapatan = await this.prisma.pendapatan.aggregate({
          where: { satminkalId: satId, tahun: currentYear },
          _sum: { nominal: true },
        });
        const aggregateBiaya = await this.prisma.biayaOperasional.aggregate({
          where: {
            OR: [{ satminkalId: satId }, { satminkalId: null }],
            tahun: currentYear,
          },
          _sum: { nominal: true },
        });

        const totalPendapatanYear = toNumber(
          aggregatePendapatan._sum.nominal ?? 0,
        );
        const totalBiayaYear = toNumber(aggregateBiaya._sum.nominal ?? 0);
        const estimatedShu = Math.max(0, totalPendapatanYear - totalBiayaYear);

        // 5. Kas Koperasi
        const totalAngsuranDibayarAgg = await this.prisma.angsuran.aggregate({
          where: {
            pinjaman: { anggota: { satminkalId: satId } },
            dibayar: true,
          },
          _sum: { total: true },
        });
        const totalAngsuranDibayar = toNumber(
          totalAngsuranDibayarAgg._sum.total ?? 0,
        );

        const totalPencairanAgg = await this.prisma.pinjaman.aggregate({
          where: {
            anggota: { satminkalId: satId },
            status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
          },
          _sum: { nominal: true },
        });
        const totalPencairan = toNumber(totalPencairanAgg._sum.nominal ?? 0);

        const cash =
          totalSavings + totalAngsuranDibayar - totalPencairan - totalBiayaYear;

        return {
          satminkalId: sat.id,
          satminkalKode: sat.kode,
          satminkalName: sat.nama,
          totalMembers,
          totalSavings,
          totalLoans,
          totalActiveLoans,
          estimatedShu,
          cash,
        };
      }),
    );

    const totalMembers = satminkalStats.reduce(
      (acc, s) => acc + s.totalMembers,
      0,
    );
    const totalSavings = satminkalStats.reduce(
      (acc, s) => acc + s.totalSavings,
      0,
    );
    const totalLoans = satminkalStats.reduce((acc, s) => acc + s.totalLoans, 0);
    const totalActiveLoans = satminkalStats.reduce(
      (acc, s) => acc + s.totalActiveLoans,
      0,
    );
    const totalCash = satminkalStats.reduce((acc, s) => acc + s.cash, 0);
    const estimatedShu = satminkalStats.reduce(
      (acc, s) => acc + s.estimatedShu,
      0,
    );

    return {
      kotamaId: kotama.id,
      kotamaKode: kotama.kode,
      kotamaName: kotama.nama,
      tipe: kotama.tipe,
      totalMembers,
      totalSavings,
      totalLoans,
      totalActiveLoans,
      totalCash,
      estimatedShu,
      satminkalStatistics: satminkalStats,
    };
  }
}

