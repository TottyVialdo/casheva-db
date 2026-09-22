import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  async getPoinDanTarget(user: JwtUser, anggotaId: string) {
    const poin = await this.prisma.poinAnggota.findUnique({
      where: { anggotaId },
    });

    const now = new Date();
    const bulanTahun = now.toISOString().slice(0, 7); // "2026-08"

    const targetSetting = await this.prisma.targetBelanjaBulanan.findUnique({
      where: {
        satminkalId_bulanTahun: {
          satminkalId: this.scopeSatminkal(user)!,
          bulanTahun,
        },
      },
    });

    const awalBulan = new Date(now.getFullYear(), now.getMonth(), 1);
    const akhirBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const belanjaBulanIni = await this.prisma.transaksiPos.aggregate({
      where: {
        anggotaId,
        satminkalId: this.scopeSatminkal(user),
        createdAt: { gte: awalBulan, lte: akhirBulan },
        status: 'SELESAI',
      },
      _sum: { totalBelanja: true },
    });

    const totalBelanja = Number(belanjaBulanIni._sum.totalBelanja || 0);
    const targetNominal = Number(targetSetting?.targetNominal || 500000);
    const isTargetTercapai = totalBelanja >= targetNominal;
    const progressPersen = Math.min(100, Math.round((totalBelanja / targetNominal) * 100));

    return {
      anggotaId,
      totalPoinAktif: poin?.totalPoinAktif || 0,
      totalPoinKlaim: poin?.totalPoinKlaim || 0,
      bulanTahun,
      totalBelanjaBulanIni: totalBelanja,
      targetBelanjaNominal: targetNominal,
      isTargetTercapai,
      progressPersen,
      bonusPoinTarget: targetSetting?.bonusPoin || 100,
    };
  }

  async getEvents(user: JwtUser) {
    return this.prisma.eventUndian.findMany({
      where: { satminkalId: this.scopeSatminkal(user) },
      include: {
        _count: { select: { kupon: true } },
        kupon: {
          where: { isPemenang: true },
          include: { anggota: true },
        },
      },
      orderBy: { tanggalUndi: 'asc' },
    });
  }

  async createEvent(
    user: JwtUser,
    dto: {
      namaEvent: string;
      hadiahUtama: string;
      poinPerKupon?: number;
      tanggalUndi: string;
    },
  ) {
    return this.prisma.eventUndian.create({
      data: {
        satminkalId: this.scopeSatminkal(user)!,
        namaEvent: dto.namaEvent,
        hadiahUtama: dto.hadiahUtama,
        poinPerKupon: dto.poinPerKupon || 50,
        tanggalUndi: new Date(dto.tanggalUndi),
      },
    });
  }

  async tukarKuponUndian(
    user: JwtUser,
    dto: {
      eventId: string;
      anggotaId: string;
      jumlahKupon: number;
    },
  ) {
    const event = await this.prisma.eventUndian.findUnique({
      where: { id: dto.eventId },
    });

    if (!event) {
      throw new NotFoundException('Event undian tidak ditemukan');
    }

    if (event.isSelesai) {
      throw new BadRequestException('Event undian sudah selesai');
    }

    const poinPerKupon = event.poinPerKupon;
    const totalPoinDibutuhkan = poinPerKupon * dto.jumlahKupon;

    return this.prisma.$transaction(async (tx) => {
      const poin = await tx.poinAnggota.findUnique({
        where: { anggotaId: dto.anggotaId },
      });

      if (!poin || poin.totalPoinAktif < totalPoinDibutuhkan) {
        throw new BadRequestException(
          `Poin tidak mencukupi (Tersedia: ${poin?.totalPoinAktif || 0}, Dibutuhkan: ${totalPoinDibutuhkan})`,
        );
      }

      await tx.poinAnggota.update({
        where: { anggotaId: dto.anggotaId },
        data: {
          totalPoinAktif: { decrement: totalPoinDibutuhkan },
          totalPoinKlaim: { increment: totalPoinDibutuhkan },
        },
      });

      const kuponResults: any[] = [];
      const currentCount = await tx.kuponUndian.count({
        where: { eventId: dto.eventId },
      });

      for (let i = 1; i <= dto.jumlahKupon; i++) {
        const nomorKupon = `KP-${String(currentCount + i).padStart(6, '0')}`;
        const kupon = await tx.kuponUndian.create({
          data: {
            eventId: dto.eventId,
            anggotaId: dto.anggotaId,
            nomorKupon,
          },
        });
        kuponResults.push(kupon);
      }

      return {
        kuponDibuat: kuponResults,
        sisaPoin: poin.totalPoinAktif - totalPoinDibutuhkan,
      };
    });
  }

  async kocokPemenang(
    user: JwtUser,
    eventId: string,
    dto: { namaHadiah: string },
  ) {
    const event = await this.prisma.eventUndian.findFirst({
      where: { id: eventId, satminkalId: this.scopeSatminkal(user) },
    });

    if (!event) {
      throw new NotFoundException('Event tidak ditemukan');
    }

    const eligibleKupons = await this.prisma.kuponUndian.findMany({
      where: { eventId, isPemenang: false },
      include: { anggota: true },
    });

    if (eligibleKupons.length === 0) {
      throw new BadRequestException('Tidak ada kupon undian yang tersedia untuk diundi');
    }

    // Undi secara acak
    const randomIndex = Math.floor(Math.random() * eligibleKupons.length);
    const winnerKupon = eligibleKupons[randomIndex];

    return this.prisma.kuponUndian.update({
      where: { id: winnerKupon.id },
      data: {
        isPemenang: true,
        namaHadiah: dto.namaHadiah || event.hadiahUtama,
      },
      include: { anggota: true, event: true },
    });
  }
}
