import { Role, StatusPinjaman } from '@prisma/client';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { CreateAnggotaDto } from './dto/create-anggota.dto';
import { UpdateAnggotaDto } from './dto/update-anggota.dto';
import * as bcrypt from 'bcrypt';

const anggotaInclude = {
  pangkat: true,
  korps: true,
  satminkal: { include: { kotama: true } },
} as const;

@Injectable()
export class AnggotaService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkalWhere(user: JwtUser) {
    if (user.role === Role.SUPER_ADMIN) {
      return {};
    }
    if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      return { satminkal: { kotamaId: user.kotamaId } };
    }
    if (user.satminkalId) {
      return { satminkalId: user.satminkalId };
    }
    return {};
  }

  private scopeSatminkal(user: JwtUser): string | undefined {
    return user.satminkalId;
  }

  async findAll(user: JwtUser, hanyaAktif?: boolean) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';

    const list = await this.prisma.anggota.findMany({
      where: {
        ...this.scopeSatminkalWhere(user),
        ...(hanyaAktif === true ? { isAktif: true } : {}),
        ...(isAnggota ? { nrpNip: user.username } : {}),
      },
      include: anggotaInclude,
      orderBy: [{ pangkat: { kodePkt: 'desc' } }, { nama: 'asc' }],
    });

    const nrps = list.map((a) => a.nrpNip);
    const users = await this.prisma.user.findMany({
      where: { username: { in: nrps } },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        lastActiveAt: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.username, u]));

    return list.map((a) => {
      const u = userMap.get(a.nrpNip);
      return {
        ...a,
        role: u?.role || Role.ANGGOTA,
        user: u || null,
      };
    });
  }

  async findOne(user: JwtUser, id: string) {
    const isAnggota =
      user.role === Role.ANGGOTA || (user.role as any) === 'Anggota';

    const row = await this.prisma.anggota.findFirst({
      where: {
        id,
        ...this.scopeSatminkalWhere(user),
        ...(isAnggota ? { nrpNip: user.username } : {}),
      },
      include: anggotaInclude,
    });
    if (!row) {
      throw new NotFoundException('Anggota tidak ditemukan atau Anda tidak memiliki izin akses');
    }
    const matchedUser = await this.prisma.user.findUnique({
      where: { username: row.nrpNip },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        lastActiveAt: true,
      },
    });
    return {
      ...row,
      role: matchedUser?.role || Role.ANGGOTA,
      user: matchedUser || null,
    };
  }

  async create(user: JwtUser, dto: CreateAnggotaDto) {
    await this.assertMasterRefs(dto.pangkatId, dto.korpsId);

    const existingNrp = await this.prisma.anggota.findFirst({
      where: { nrpNip: dto.nrpNip },
    });
    if (existingNrp) {
      throw new ConflictException(
        `Anggota dengan NRP/NIP ${dto.nrpNip} sudah terdaftar`,
      );
    }

    const satminkalId = this.scopeSatminkal(user);
    const createdAnggota = await this.prisma.anggota.create({
      data: {
        nama: dto.nama.trim(),
        nrpNip: dto.nrpNip.trim(),
        pangkatId: dto.pangkatId,
        korpsId: dto.korpsId,
        satminkalId: satminkalId!,
        tmtAnggota: dto.tmtAnggota ? new Date(dto.tmtAnggota) : undefined,
      },
      include: anggotaInclude,
    });

    // Auto-create / synchronize login account (User)
    const targetRole = dto.role || Role.ANGGOTA;
    const initialPass = dto.password || 'Admin123!';
    const hashedPassword = await bcrypt.hash(initialPass, 10);

    const satminkal = await this.prisma.satminkal.findUnique({
      where: { id: satminkalId },
    });

    if (satminkal) {
      await this.prisma.user.upsert({
        where: { username: dto.nrpNip.trim() },
        create: {
          username: dto.nrpNip.trim(),
          password: hashedPassword,
          namaLengkap: dto.nama.trim(),
          role: targetRole,
          kotamaId: satminkal.kotamaId,
          satminkalId: satminkal.id,
          isActive: true,
        },
        update: {
          namaLengkap: dto.nama.trim(),
          role: targetRole,
          satminkalId: satminkal.id,
          kotamaId: satminkal.kotamaId,
          isActive: true,
        },
      });
    }

    return createdAnggota;
  }

  async update(user: JwtUser, id: string, dto: UpdateAnggotaDto) {
    const existing = await this.findOne(user, id);

    if (dto.pangkatId || dto.korpsId) {
      await this.assertMasterRefs(
        dto.pangkatId ?? (await this.getPangkatId(id)),
        dto.korpsId ?? (await this.getKorpsId(id)),
      );
    }

    const updated = await this.prisma.anggota.update({
      where: { id },
      data: {
        nama: dto.nama !== undefined ? dto.nama.trim() : undefined,
        nrpNip: dto.nrpNip !== undefined ? dto.nrpNip.trim() : undefined,
        pangkatId: dto.pangkatId,
        korpsId: dto.korpsId,
        isAktif: dto.isAktif,
        tmtAnggota: dto.tmtAnggota ? new Date(dto.tmtAnggota) : undefined,
      },
      include: anggotaInclude,
    });

    // Synchronize corresponding User record (including Role & Password if supplied)
    const updateUserData: any = {};
    if (dto.nama) updateUserData.namaLengkap = dto.nama.trim();
    if (dto.nrpNip) updateUserData.username = dto.nrpNip.trim();
    if (dto.isAktif !== undefined) updateUserData.isActive = dto.isAktif;
    if (dto.role) updateUserData.role = dto.role;
    if (dto.password) updateUserData.password = await bcrypt.hash(dto.password, 10);

    if (Object.keys(updateUserData).length > 0) {
      await this.prisma.user
        .updateMany({
          where: { username: existing.nrpNip },
          data: updateUserData,
        })
        .catch(() => {});
    }

    return updated;
  }

  async remove(user: JwtUser, id: string) {
    const anggota = await this.findOne(user, id);
    const pinjamanAktif = await this.prisma.pinjaman.count({
      where: {
        anggotaId: id,
        status: { in: [StatusPinjaman.DICAIRKAN] },
      },
    });
    if (pinjamanAktif > 0) {
      throw new ForbiddenException('Anggota masih memiliki pinjaman berjalan');
    }
    await this.prisma.anggota.update({
      where: { id: anggota.id },
      data: { isAktif: false },
    });

    // Also deactivate User login
    await this.prisma.user
      .updateMany({
        where: { username: anggota.nrpNip },
        data: { isActive: false, currentSessionToken: null },
      })
      .catch(() => {});

    return { message: 'Anggota dan akun login dinonaktifkan' };
  }

  private async getPangkatId(anggotaId: string) {
    const a = await this.prisma.anggota.findUniqueOrThrow({
      where: { id: anggotaId },
      select: { pangkatId: true },
    });
    return a.pangkatId;
  }

  private async getKorpsId(anggotaId: string) {
    const a = await this.prisma.anggota.findUniqueOrThrow({
      where: { id: anggotaId },
      select: { korpsId: true },
    });
    return a.korpsId;
  }

  private async assertMasterRefs(pangkatId: string, korpsId: string) {
    const [pangkat, korps] = await Promise.all([
      this.prisma.pangkat.findUnique({ where: { id: pangkatId } }),
      this.prisma.korps.findUnique({ where: { id: korpsId } }),
    ]);
    if (!pangkat || !korps) {
      throw new NotFoundException('Pangkat atau Korps tidak valid');
    }
  }
}
