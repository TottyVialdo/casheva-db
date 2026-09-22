import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@Injectable()
export class SatminkalService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user?: JwtUser, kotamaKode?: string, all?: boolean) {
    const where: any = {
      status: true,
      ...(kotamaKode ? { kotama: { kode: kotamaKode } } : {}),
    };

    if (user && !all && user.role !== Role.SUPER_ADMIN) {
      if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
        where.kotamaId = user.kotamaId;
      } else if (user.satminkalId) {
        where.id = user.satminkalId;
      }
    }

    return this.prisma.satminkal.findMany({
      where,
      orderBy: { kode: 'asc' },
      include: { kotama: { select: { id: true, kode: true, nama: true } } },
    });
  }

  findByKode(kode: string) {
    return this.prisma.satminkal.findUnique({
      where: { kode },
      include: { kotama: true },
    });
  }

  async create(data: { kode: string; nama: string; kotamaId: string }) {
    return this.prisma.satminkal.create({
      data: {
        kode: data.kode.trim(),
        nama: data.nama.trim(),
        kotamaId: data.kotamaId,
      },
    });
  }

  async update(id: string, data: { nama?: string; kotamaId?: string; status?: boolean }) {
    return this.prisma.satminkal.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.satminkal.update({
      where: { id },
      data: { status: false },
    });
  }

  async createWithAdmin(data: {
    kode: string;
    nama: string;
    kotamaId: string;
    adminUsername: string;
    adminPassword: string;
    adminNamaLengkap: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { username: data.adminUsername.trim() },
    });
    if (existingUser) {
      throw new ConflictException(`Username '${data.adminUsername}' sudah digunakan`);
    }

    const existingSatminkal = await this.prisma.satminkal.findUnique({
      where: { kode: data.kode.trim() },
    });
    if (existingSatminkal) {
      throw new ConflictException(`Satminkal dengan kode '${data.kode}' sudah ada`);
    }

    const kotama = await this.prisma.kotama.findUnique({
      where: { id: data.kotamaId },
    });
    if (!kotama) throw new NotFoundException('Kotama tidak ditemukan');

    const hashedPassword = await bcrypt.hash(data.adminPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const satminkal = await tx.satminkal.create({
        data: {
          kode: data.kode.trim(),
          nama: data.nama.trim(),
          kotamaId: data.kotamaId,
        },
      });

      const admin = await tx.user.create({
        data: {
          username: data.adminUsername.trim(),
          password: hashedPassword,
          namaLengkap: data.adminNamaLengkap.trim(),
          role: Role.ADMIN_SATMINKAL,
          kotamaId: data.kotamaId,
          satminkalId: satminkal.id,
          passwordHistories: { create: { hash: hashedPassword } },
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

      return { message: 'Satminkal dan Admin berhasil dibuat', satminkal, admin };
    });
  }
}
