import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@Injectable()
export class KotamaService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user?: JwtUser, all?: boolean) {
    const where: any = { status: true };

    if (user && !all && user.role !== Role.SUPER_ADMIN) {
      if (user.kotamaId) {
        where.id = user.kotamaId;
      }
    }

    return this.prisma.kotama.findMany({
      where,
      orderBy: { kode: 'asc' },
      include: {
        satminkal: {
          where: {
            status: true,
            ...(user && !all && user.role !== Role.SUPER_ADMIN && user.satminkalId
              ? { id: user.satminkalId }
              : {}),
          },
          orderBy: { kode: 'asc' },
        },
      },
    });
  }

  findByKode(kode: string) {
    return this.prisma.kotama.findUnique({
      where: { kode },
      include: { satminkal: { where: { status: true }, orderBy: { kode: 'asc' } } },
    });
  }

  async create(data: { kode: string; nama: string; tipe?: string }) {
    return this.prisma.kotama.create({
      data: {
        kode: data.kode.trim(),
        nama: data.nama.trim(),
        tipe: data.tipe || 'KOTAMA',
      },
    });
  }

  async update(id: string, data: { nama?: string; tipe?: string; status?: boolean }) {
    return this.prisma.kotama.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.kotama.update({
      where: { id },
      data: { status: false },
    });
  }

  async createWithAdmin(data: {
    kode: string;
    nama: string;
    tipe?: string;
    adminUsername: string;
    adminPassword: string;
    adminNamaLengkap: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { username: data.adminUsername.trim() },
    });
    if (existing) {
      throw new ConflictException(`Username '${data.adminUsername}' sudah digunakan`);
    }

    const existingKotama = await this.prisma.kotama.findUnique({
      where: { kode: data.kode.trim() },
    });
    if (existingKotama) {
      throw new ConflictException(`Kotama dengan kode '${data.kode}' sudah ada`);
    }

    const hashedPassword = await bcrypt.hash(data.adminPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const kotama = await tx.kotama.create({
        data: {
          kode: data.kode.trim(),
          nama: data.nama.trim(),
          tipe: data.tipe || 'KOTAMA',
        },
      });

      const admin = await tx.user.create({
        data: {
          username: data.adminUsername.trim(),
          password: hashedPassword,
          namaLengkap: data.adminNamaLengkap.trim(),
          role: Role.ADMIN_KOTAMA,
          kotamaId: kotama.id,
          passwordHistories: { create: { hash: hashedPassword } },
        },
        select: {
          id: true,
          username: true,
          namaLengkap: true,
          role: true,
          kotamaId: true,
        },
      });

      return { message: 'Kotama dan Admin berhasil dibuat', kotama, admin };
    });
  }
}
