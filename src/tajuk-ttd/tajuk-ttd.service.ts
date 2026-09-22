import { Injectable } from '@nestjs/common';
import { Role, TajukTandaTangan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTajukTtdDto } from './dto/create-tajuk-ttd.dto';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';

@Injectable()
export class TajukTtdService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: JwtUser, dto: CreateTajukTtdDto): Promise<TajukTandaTangan> {
    const satminkalId = (dto as any).satminkalId || user.satminkalId;
    const kotamaId = (dto as any).kotamaId || (user.role === Role.ADMIN_KOTAMA ? user.kotamaId : undefined);
    return await this.prisma.tajukTandaTangan.create({
      data: {
        ...dto,
        ...(satminkalId ? { satminkalId } : {}),
        ...(kotamaId ? { kotamaId } : {}),
      },
    });
  }

  async findAll(user?: JwtUser, satminkalIdParam?: string): Promise<TajukTandaTangan[]> {
    const where: any = {};
    if (satminkalIdParam && satminkalIdParam !== 'ALL') {
      where.satminkalId = satminkalIdParam;
    } else if (user && user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      where.OR = [
        { kotamaId: user.kotamaId },
        { satminkal: { kotamaId: user.kotamaId } },
      ];
    } else if (user && user.role !== Role.SUPER_ADMIN && user.satminkalId) {
      where.satminkalId = user.satminkalId;
    }

    const list = await this.prisma.tajukTandaTangan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (list.length === 0) {
      return await this.prisma.tajukTandaTangan.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }
    return list;
  }

  async findActive(user?: JwtUser, kategori?: string, satminkalIdParam?: string): Promise<TajukTandaTangan[]> {
    const where: any = { isAktif: true };
    if (kategori) {
      where.kategori = kategori;
    }

    if (satminkalIdParam && satminkalIdParam !== 'ALL') {
      where.satminkalId = satminkalIdParam;
    } else if (user && user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      where.OR = [
        { kotamaId: user.kotamaId },
        { satminkal: { kotamaId: user.kotamaId } },
      ];
    } else if (user && user.role !== Role.SUPER_ADMIN && user.satminkalId) {
      where.satminkalId = user.satminkalId;
    }

    const list = await this.prisma.tajukTandaTangan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (list.length === 0) {
      return await this.prisma.tajukTandaTangan.findMany({
        where: { isAktif: true, ...(kategori ? { kategori } : {}) },
        orderBy: { createdAt: 'desc' },
      });
    }
    return list;
  }

  async update(
    id: string,
    dto: Partial<CreateTajukTtdDto>,
  ): Promise<TajukTandaTangan> {
    return await this.prisma.tajukTandaTangan.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string): Promise<TajukTandaTangan> {
    return await this.prisma.tajukTandaTangan.delete({
      where: { id },
    });
  }
}
