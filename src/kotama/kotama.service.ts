import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { toNumber } from '../common/utils/decimal.util';
import { Role, StatusPinjaman } from '@prisma/client';
import {
  CreateKotamaSatminkalDto,
  UpdateKotamaSatminkalDto,
} from './dto/create-kotama-satminkal.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class KotamaService {
  constructor(private readonly prisma: PrismaService) {}

  private getEffectiveKotamaId(user: JwtUser, requestedKotamaId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      return requestedKotamaId || user.kotamaId || '';
    }
    if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      if (requestedKotamaId && requestedKotamaId !== user.kotamaId) {
        throw new ForbiddenException('Akses ditolak: Anda hanya memiliki izin mengelola Kotama Anda sendiri');
      }
      return user.kotamaId;
    }
    if (user.kotamaId) {
      return user.kotamaId;
    }
    throw new ForbiddenException('Kotama ID tidak ditemukan pada sesi pengguna');
  }

  // 1. DASHBOARD AGGREGATE SUMMARY (Sesuai Poin 1 & 74 pengembangan admin kotama balakpus.md)
  async getSummary(user: JwtUser, kotamaIdParam?: string) {
    let targetKotamaId = this.getEffectiveKotamaId(user, kotamaIdParam);

    if (!targetKotamaId && user.role === Role.SUPER_ADMIN) {
      const firstKotama = await this.prisma.kotama.findFirst({ where: { status: true } });
      targetKotamaId = firstKotama?.id || '';
    }

    const kotama = await this.prisma.kotama.findUnique({
      where: { id: targetKotamaId },
      include: {
        satminkal: {
          where: { status: true },
          orderBy: { kode: 'asc' },
        },
      },
    });

    if (!kotama) {
      throw new NotFoundException('Kotama tidak ditemukan');
    }

    const currentYear = new Date().getFullYear();
    const now = Date.now();

    // Fetch active users in this Kotama to determine online/offline status
    const usersInKotama = await this.prisma.user.findMany({
      where: { kotamaId: kotama.id, isActive: true },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        satminkalId: true,
        lastActiveAt: true,
      },
    });

    const satminkalStats = await Promise.all(
      kotama.satminkal.map(async (sat) => {
        const satId = sat.id;

        // 1. Total Anggota Aktif
        const totalAnggota = await this.prisma.anggota.count({
          where: { satminkalId: satId, isAktif: true },
        });

        // 2. Total Simpanan (Setor - Tarik)
        const simpananRows = await this.prisma.simpanan.findMany({
          where: { anggota: { satminkalId: satId } },
          select: { tipe: true, nominal: true },
        });
        const totalSimpanan = simpananRows.reduce((acc, row) => {
          const val = toNumber(row.nominal);
          return row.tipe === 'SETOR' ? acc + val : acc - val;
        }, 0);

        // 3. Total Pinjaman & Pinjaman Berjalan
        const pinjamanList = await this.prisma.pinjaman.findMany({
          where: {
            anggota: { satminkalId: satId },
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
        const pinjamanBerjalan = pinjamanBerjalanRows.reduce(
          (acc, p) => acc + toNumber(p.sisaPokok ?? p.nominal),
          0,
        );
        const countPinjamanBerjalan = pinjamanBerjalanRows.length;

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

        const totalPendapatanYear = toNumber(aggregatePendapatan._sum.nominal ?? 0);
        const totalBiayaYear = toNumber(aggregateBiaya._sum.nominal ?? 0);
        const estimasiShu = Math.max(0, totalPendapatanYear - totalBiayaYear);

        // 5. Kas Koperasi
        const totalAngsuranDibayarAgg = await this.prisma.angsuran.aggregate({
          where: {
            pinjaman: { anggota: { satminkalId: satId } },
            dibayar: true,
          },
          _sum: { total: true },
        });
        const totalAngsuranDibayar = toNumber(totalAngsuranDibayarAgg._sum.total ?? 0);

        const totalPencairanAgg = await this.prisma.pinjaman.aggregate({
          where: {
            anggota: { satminkalId: satId },
            status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
          },
          _sum: { nominal: true },
        });
        const totalPencairan = toNumber(totalPencairanAgg._sum.nominal ?? 0);

        const kasKoperasi =
          totalSimpanan + totalAngsuranDibayar - totalPencairan - totalBiayaYear;

        // Admin Satminkal Info & Online Status
        const adminUser = usersInKotama.find(
          (u) =>
            u.satminkalId === satId &&
            (u.role === Role.ADMIN_SATMINKAL || u.role === Role.ADMIN_KOPERASI),
        );

        let isOnline = false;
        let isIdle = false;
        if (adminUser?.lastActiveAt) {
          const diffMs = now - new Date(adminUser.lastActiveAt).getTime();
          isOnline = diffMs < 1000 * 60 * 5;
          isIdle = diffMs >= 1000 * 60 * 5 && diffMs < 1000 * 60 * 30;
        }

        return {
          id: sat.id,
          kode: sat.kode,
          nama: sat.nama,
          status: sat.status,
          totalAnggota,
          totalSimpanan,
          totalPinjaman,
          pinjamanBerjalan,
          countPinjamanBerjalan,
          estimasiShu,
          kasKoperasi,
          admin: adminUser
            ? {
                id: adminUser.id,
                username: adminUser.username,
                namaLengkap: adminUser.namaLengkap,
                role: adminUser.role,
                isOnline,
                isIdle,
                isOffline: !isOnline && !isIdle,
                lastActiveAt: adminUser.lastActiveAt,
              }
            : null,
        };
      }),
    );

    const totalAnggotaAktif = satminkalStats.reduce((acc, s) => acc + s.totalAnggota, 0);
    const totalSimpanan = satminkalStats.reduce((acc, s) => acc + s.totalSimpanan, 0);
    const totalKas = satminkalStats.reduce((acc, s) => acc + s.kasKoperasi, 0);
    const totalKasSimpanan = totalKas + totalSimpanan;
    const pinjamanBerjalan = satminkalStats.reduce((acc, s) => acc + s.pinjamanBerjalan, 0);
    const countPinjamanBerjalan = satminkalStats.reduce((acc, s) => acc + s.countPinjamanBerjalan, 0);
    const estimasiShuKotama = satminkalStats.reduce((acc, s) => acc + s.estimasiShu, 0);

    return {
      kotama: {
        id: kotama.id,
        kode: kotama.kode,
        nama: kotama.nama,
        tipe: kotama.tipe,
      },
      tahun: currentYear,
      kpi: {
        totalAnggotaAktif,
        totalSimpanan,
        totalKas,
        totalKasSimpanan,
        pinjamanBerjalan,
        countPinjamanBerjalan,
        estimasiShuKotama,
      },
      satminkals: satminkalStats,
    };
  }

  // 2. DASHBOARD AGGREGATE CHARTS (Simpanan vs Pinjaman & Realisasi Angsuran)
  async getCharts(user: JwtUser, tahun?: number, kotamaIdParam?: string) {
    const targetKotamaId = this.getEffectiveKotamaId(user, kotamaIdParam);
    const targetYear = tahun || new Date().getFullYear();

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
      'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
    ];

    const satminkals = await this.prisma.satminkal.findMany({
      where: { kotamaId: targetKotamaId, status: true },
      select: { id: true },
    });
    const satminkalIds = satminkals.map((s) => s.id);

    // Simpanan across all satminkals
    const simpananList = await this.prisma.simpanan.findMany({
      where: {
        anggota: { satminkalId: { in: satminkalIds } },
        createdAt: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
      },
      select: { createdAt: true, nominal: true, tipe: true },
    });

    // Pinjaman across all satminkals
    const pinjamanList = await this.prisma.pinjaman.findMany({
      where: {
        anggota: { satminkalId: { in: satminkalIds } },
        tanggalCair: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
        status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
      },
      select: { tanggalCair: true, nominal: true },
    });

    // Angsuran across all satminkals
    const angsuranList = await this.prisma.angsuran.findMany({
      where: {
        pinjaman: { anggota: { satminkalId: { in: satminkalIds } } },
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
        .reduce((sum, s) => s.tipe === 'SETOR' ? sum + toNumber(s.nominal) : sum - toNumber(s.nominal), 0);

      const monthPinjaman = pinjamanList
        .filter((p) => p.tanggalCair && new Date(p.tanggalCair).getMonth() === index)
        .reduce((sum, p) => sum + toNumber(p.nominal), 0);

      const monthAngsuran = angsuranList
        .filter((a) => a.tanggalBayar && new Date(a.tanggalBayar).getMonth() === index)
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

  // 3. SATMINKAL LIST & MANAGEMENT (Sesuai Poin 2 & 38-39 pengembangan admin kotama balakpus.md)
  async getSatminkalList(user: JwtUser, kotamaIdParam?: string) {
    let targetKotamaId = this.getEffectiveKotamaId(user, kotamaIdParam);

    if (!targetKotamaId && user.role === Role.SUPER_ADMIN && kotamaIdParam) {
      targetKotamaId = kotamaIdParam;
    }

    const satminkals = await this.prisma.satminkal.findMany({
      where: targetKotamaId ? { kotamaId: targetKotamaId, status: true } : { status: true },
      orderBy: [{ kotama: { kode: 'asc' } }, { kode: 'asc' }],
      include: {
        kotama: { select: { id: true, kode: true, nama: true } },
      },
    });

    const now = Date.now();
    const currentYear = new Date().getFullYear();
    const users = await this.prisma.user.findMany({
      where: targetKotamaId ? { kotamaId: targetKotamaId, isActive: true } : { isActive: true },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        satminkalId: true,
        lastActiveAt: true,
      },
    });

    return Promise.all(
      satminkals.map(async (sat) => {
        const satId = sat.id;

        // 1. Total Anggota Aktif
        const totalAnggota = await this.prisma.anggota.count({
          where: { satminkalId: satId, isAktif: true },
        });

        // 2. Total Simpanan (Setor - Tarik)
        const simpananRows = await this.prisma.simpanan.findMany({
          where: { anggota: { satminkalId: satId } },
          select: { tipe: true, nominal: true },
        });
        const totalSimpanan = simpananRows.reduce((acc, row) => {
          const val = toNumber(row.nominal);
          return row.tipe === 'SETOR' ? acc + val : acc - val;
        }, 0);

        // 3. Total Pinjaman & Pinjaman Berjalan (Pinjaman Aktif)
        const pinjamanList = await this.prisma.pinjaman.findMany({
          where: {
            anggota: { satminkalId: satId },
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
        const pinjamanBerjalan = pinjamanBerjalanRows.reduce(
          (acc, p) => acc + toNumber(p.sisaPokok ?? p.nominal),
          0,
        );
        const countPinjamanBerjalan = pinjamanBerjalanRows.length;

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

        const totalPendapatanYear = toNumber(aggregatePendapatan._sum.nominal ?? 0);
        const totalBiayaYear = toNumber(aggregateBiaya._sum.nominal ?? 0);
        const estimasiShu = Math.max(0, totalPendapatanYear - totalBiayaYear);

        // 5. Kas Koperasi
        const totalAngsuranDibayarAgg = await this.prisma.angsuran.aggregate({
          where: {
            pinjaman: { anggota: { satminkalId: satId } },
            dibayar: true,
          },
          _sum: { total: true },
        });
        const totalAngsuranDibayar = toNumber(totalAngsuranDibayarAgg._sum.total ?? 0);

        const totalPencairanAgg = await this.prisma.pinjaman.aggregate({
          where: {
            anggota: { satminkalId: satId },
            status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.LUNAS] },
          },
          _sum: { nominal: true },
        });
        const totalPencairan = toNumber(totalPencairanAgg._sum.nominal ?? 0);

        const kasKoperasi =
          totalSimpanan + totalAngsuranDibayar - totalPencairan - totalBiayaYear;

        // Admin Satminkal Info & Online Status
        const adminUser = users.find(
          (u) =>
            u.satminkalId === satId &&
            (u.role === Role.ADMIN_SATMINKAL || u.role === Role.ADMIN_KOPERASI),
        );

        let isOnline = false;
        let isIdle = false;
        if (adminUser?.lastActiveAt) {
          const diffMs = now - new Date(adminUser.lastActiveAt).getTime();
          isOnline = diffMs < 1000 * 60 * 5;
          isIdle = diffMs >= 1000 * 60 * 5 && diffMs < 1000 * 60 * 30;
        }

        return {
          id: sat.id,
          kode: sat.kode,
          nama: sat.nama,
          status: sat.status,
          kotamaId: sat.kotamaId,
          kotama: sat.kotama,
          totalAnggota,
          totalSimpanan,
          totalPinjaman,
          pinjamanBerjalan,
          countPinjamanBerjalan,
          estimasiShu,
          kasKoperasi,
          kinerja: 'SEHAT (A)',
          admin: adminUser
            ? {
                id: adminUser.id,
                username: adminUser.username,
                namaLengkap: adminUser.namaLengkap,
                role: adminUser.role,
                isOnline,
                isIdle,
                isOffline: !isOnline && !isIdle,
                lastActiveAt: adminUser.lastActiveAt,
              }
            : null,
        };
      }),
    );
  }

  // 4. CREATE SATMINKAL (+ OTOMATIS ADMIN SATMINKAL)
  async createSatminkal(user: JwtUser, dto: CreateKotamaSatminkalDto) {
    const kotamaId = this.getEffectiveKotamaId(user);

    const existing = await this.prisma.satminkal.findUnique({
      where: { kode: dto.kode.trim() },
    });
    if (existing) {
      throw new ConflictException(`Kode Satminkal '${dto.kode}' sudah digunakan`);
    }

    const satminkal = await this.prisma.satminkal.create({
      data: {
        kode: dto.kode.trim(),
        nama: dto.nama.trim(),
        kotamaId,
        status: true,
      },
      include: { kotama: true },
    });

    let createdAdmin: any = null;
    if (dto.adminUsername && dto.adminPassword) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username: dto.adminUsername.trim() },
      });
      if (existingUser) {
        throw new ConflictException(`Username '${dto.adminUsername}' sudah digunakan`);
      }

      const hashedPassword = await bcrypt.hash(dto.adminPassword, 10);
      createdAdmin = await this.prisma.user.create({
        data: {
          username: dto.adminUsername.trim(),
          password: hashedPassword,
          namaLengkap: dto.adminNamaLengkap?.trim() || `Admin ${dto.nama.trim()}`,
          role: Role.ADMIN_SATMINKAL,
          kotamaId,
          satminkalId: satminkal.id,
          isActive: true,
          passwordHistories: {
            create: { hash: hashedPassword },
          },
        },
        select: {
          id: true,
          username: true,
          namaLengkap: true,
          role: true,
          kotamaId: true,
          satminkalId: true,
        },
      });
    }

    // Write audit log
    await this.logActivity(
      user,
      'CREATE_SATMINKAL',
      'SATMINKAL',
      satminkal.id,
      satminkal.id,
      {
        kode: satminkal.kode,
        nama: satminkal.nama,
        adminCreated: !!createdAdmin,
      },
    );

    return {
      message: 'Satminkal berhasil ditambahkan',
      satminkal,
      admin: createdAdmin,
    };
  }

  // 5. UPDATE SATMINKAL
  async updateSatminkal(user: JwtUser, id: string, dto: UpdateKotamaSatminkalDto) {
    const kotamaId = this.getEffectiveKotamaId(user);
    const existing = await this.prisma.satminkal.findUnique({
      where: { id },
    });

    if (!existing || existing.kotamaId !== kotamaId) {
      throw new NotFoundException('Satminkal tidak ditemukan atau Anda tidak memiliki hak akses');
    }

    const updated = await this.prisma.satminkal.update({
      where: { id },
      data: {
        ...(dto.nama ? { nama: dto.nama.trim() } : {}),
        ...(typeof dto.status === 'boolean' ? { status: dto.status } : {}),
      },
    });

    await this.logActivity(
      user,
      'UPDATE_SATMINKAL',
      'SATMINKAL',
      updated.id,
      updated.id,
      dto,
    );

    return { message: 'Satminkal berhasil diperbarui', satminkal: updated };
  }

  // 6. REALTIME MONITORING SESSIONS & AUDIT LOG (Sesuai Poin 3 & 56-58)
  async startMonitoring(user: JwtUser, satminkalId: string, catatan?: string) {
    const kotamaId = this.getEffectiveKotamaId(user);
    const satminkal = await this.prisma.satminkal.findUnique({
      where: { id: satminkalId },
      include: { kotama: true },
    });

    if (!satminkal || satminkal.kotamaId !== kotamaId) {
      throw new ForbiddenException('Akses monitoring ditolak: Satminkal bukan bawahan Kotama Anda');
    }

    const log = await this.logActivity(
      user,
      'MONITORING_START',
      'SATMINKAL',
      satminkal.id,
      satminkal.id,
      {
        satminkalKode: satminkal.kode,
        satminkalNama: satminkal.nama,
        kotamaNama: satminkal.kotama.nama,
        catatan: catatan || 'Monitoring Satminkal oleh Admin Kotama',
      },
    );

    return {
      message: `Monitoring Satminkal ${satminkal.nama} dimulai`,
      monitoringId: log.id,
      satminkal: {
        id: satminkal.id,
        kode: satminkal.kode,
        nama: satminkal.nama,
      },
      kotama: {
        id: satminkal.kotama.id,
        nama: satminkal.kotama.nama,
      },
      startedAt: log.timestamp,
    };
  }

  async endMonitoring(user: JwtUser, satminkalId: string) {
    const kotamaId = this.getEffectiveKotamaId(user);
    const satminkal = await this.prisma.satminkal.findUnique({
      where: { id: satminkalId },
    });

    if (!satminkal || satminkal.kotamaId !== kotamaId) {
      throw new ForbiddenException('Akses monitoring ditolak: Satminkal bukan bawahan Kotama Anda');
    }

    const log = await this.logActivity(
      user,
      'MONITORING_END',
      'SATMINKAL',
      satminkal.id,
      satminkal.id,
      {
        satminkalKode: satminkal.kode,
        satminkalNama: satminkal.nama,
      },
    );

    return {
      message: `Monitoring Satminkal ${satminkal.nama} selesai`,
      endedAt: log.timestamp,
    };
  }

  async getActiveMonitoringForSatminkal(satminkalId: string) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const latestStart = await this.prisma.auditLog.findFirst({
      where: {
        satminkalId,
        action: 'MONITORING_START',
        timestamp: { gte: fifteenMinutesAgo },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!latestStart) return null;

    const laterEnd = await this.prisma.auditLog.findFirst({
      where: {
        satminkalId,
        action: 'MONITORING_END',
        timestamp: { gt: latestStart.timestamp },
      },
    });

    if (laterEnd) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: latestStart.userId },
      include: { kotama: true },
    });

    return {
      isActive: true,
      monitoringId: latestStart.id,
      startedAt: latestStart.timestamp,
      adminKotama: {
        id: user?.id,
        username: user?.username,
        namaLengkap: user?.namaLengkap,
        kotama: user?.kotama?.nama || 'Kotama',
      },
      details: latestStart.details,
    };
  }

  // 7. SUPER ADMIN -> KOTAMA REALTIME MONITORING SESSIONS
  async startKotamaMonitoring(user: JwtUser, kotamaId: string, catatan?: string) {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Akses ditolak: Hanya Super Admin yang berwenang memantau Komando Utama');
    }

    const kotama = await this.prisma.kotama.findUnique({
      where: { id: kotamaId },
    });

    if (!kotama) {
      throw new NotFoundException('Kotama tidak ditemukan');
    }

    const log = await this.logActivity(
      user,
      'MONITORING_KOTAMA_START',
      'KOTAMA',
      kotama.id,
      undefined,
      {
        kotamaKode: kotama.kode,
        kotamaNama: kotama.nama,
        catatan: catatan || 'Monitoring Kotama oleh Super Admin Mabesad/Pusat',
      },
    );

    return {
      message: `Monitoring Komando Utama ${kotama.nama} dimulai`,
      monitoringId: log.id,
      kotama: {
        id: kotama.id,
        kode: kotama.kode,
        nama: kotama.nama,
      },
      startedAt: log.timestamp,
    };
  }

  async endKotamaMonitoring(user: JwtUser, kotamaId: string) {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Akses ditolak: Hanya Super Admin yang berwenang memantau Komando Utama');
    }

    const kotama = await this.prisma.kotama.findUnique({
      where: { id: kotamaId },
    });

    if (!kotama) {
      throw new NotFoundException('Kotama tidak ditemukan');
    }

    const log = await this.logActivity(
      user,
      'MONITORING_KOTAMA_END',
      'KOTAMA',
      kotama.id,
      undefined,
      {
        kotamaKode: kotama.kode,
        kotamaNama: kotama.nama,
      },
    );

    return {
      message: `Monitoring Komando Utama ${kotama.nama} selesai`,
      endedAt: log.timestamp,
    };
  }

  async getActiveMonitoringForKotama(kotamaId: string) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const latestStart = await this.prisma.auditLog.findFirst({
      where: {
        kotamaId,
        action: 'MONITORING_KOTAMA_START',
        timestamp: { gte: fifteenMinutesAgo },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!latestStart) return null;

    const laterEnd = await this.prisma.auditLog.findFirst({
      where: {
        kotamaId,
        action: 'MONITORING_KOTAMA_END',
        timestamp: { gt: latestStart.timestamp },
      },
    });

    if (laterEnd) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: latestStart.userId },
    });

    return {
      isActive: true,
      monitoringId: latestStart.id,
      startedAt: latestStart.timestamp,
      superAdmin: {
        id: user?.id,
        username: user?.username,
        namaLengkap: user?.namaLengkap || 'Super Administrator TNI AD',
      },
      details: latestStart.details,
    };
  }


  async getAuditLogs(user: JwtUser, limit = 50) {
    const kotamaId = this.getEffectiveKotamaId(user);
    return this.prisma.auditLog.findMany({
      where: { kotamaId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  private async logActivity(
    user: JwtUser,
    action: string,
    targetType?: string,
    targetId?: string,
    satminkalId?: string,
    details?: any,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId: user.userId,
        username: user.username,
        role: String(user.role),
        action,
        targetType,
        targetId,
        kotamaId: user.kotamaId,
        satminkalId,
        details: details || {},
      },
    });
  }
}
