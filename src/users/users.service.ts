import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma, User, Role, StatusPinjaman } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const username = dto.username.trim();
    const existing = await this.prisma.user.findUnique({
      where: { username },
    });
    if (existing) {
      throw new ConflictException('Username / NRP sudah digunakan');
    }

    let satminkalId: string | null | undefined = dto.satminkalId;
    let kotamaId: string | null | undefined = dto.kotamaId;

    if (dto.role === Role.SUPER_ADMIN) {
      kotamaId = null;
      satminkalId = null;
    } else if (dto.role === Role.ADMIN_KOTAMA) {
      satminkalId = null;
      if (!kotamaId) {
        const firstKotama = await this.prisma.kotama.findFirst();
        kotamaId = firstKotama?.id;
      }
      if (!kotamaId) throw new NotFoundException('Kotama tidak ditemukan');
    } else {
      if (!satminkalId) {
        const firstSatminkal = await this.prisma.satminkal.findFirst();
        satminkalId = firstSatminkal?.id;
      }
      if (!satminkalId) {
        throw new NotFoundException('Satminkal tidak ditemukan');
      }

      if (!kotamaId) {
        const satminkal = await this.prisma.satminkal.findUnique({
          where: { id: satminkalId },
        });
        if (satminkal) {
          kotamaId = satminkal.kotamaId;
        }
      }

      if (!kotamaId) {
        const firstKotama = await this.prisma.kotama.findFirst();
        kotamaId = firstKotama?.id;
      }

      if (!kotamaId) {
        throw new NotFoundException('Kotama tidak ditemukan');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        namaLengkap: dto.namaLengkap.trim(),
        role: dto.role,
        ...(kotamaId ? { kotama: { connect: { id: kotamaId } } } : {}),
        ...(satminkalId ? { satminkal: { connect: { id: satminkalId } } } : {}),
        passwordHistories: {
          create: {
            hash: hashedPassword,
          },
        },
      },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        kotamaId: true,
        satminkalId: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Always ensure synchronized Anggota entity exists for non-SuperAdmin/Kotama users
    if (satminkalId) {
      const nrpNip = dto.nrpNip || username;
      const existingAnggota = await this.prisma.anggota.findFirst({
        where: { nrpNip },
      });

      if (!existingAnggota) {
        let pangkatId = dto.pangkatId;
        if (!pangkatId) {
          const firstPangkat = await this.prisma.pangkat.findFirst();
          pangkatId = firstPangkat?.id;
        }

        let korpsId = dto.korpsId;
        if (!korpsId) {
          const firstKorps = await this.prisma.korps.findFirst();
          korpsId = firstKorps?.id;
        }

        if (pangkatId && korpsId) {
          await this.prisma.anggota.create({
            data: {
              nama: dto.namaLengkap.trim(),
              nrpNip,
              pangkatId,
              korpsId,
              satminkalId,
              isAktif: true,
            },
          });
        }
      } else {
        // Sync Anggota if already exists
        await this.prisma.anggota.update({
          where: { id: existingAnggota.id },
          data: {
            nama: dto.namaLengkap.trim(),
            isAktif: true,
            satminkalId,
            ...(dto.pangkatId ? { pangkatId: dto.pangkatId } : {}),
            ...(dto.korpsId && dto.korpsId !== 'NONE' ? { korpsId: dto.korpsId } : {}),
          },
        });
      }
    }

    return user;
  }

  async findAll(currentUser?: any) {
    const where: any = {};
    if (currentUser) {
      if (currentUser.role === Role.SUPER_ADMIN) {
        // Super Admin sees all users across TNI AD
      } else if (currentUser.role === Role.ADMIN_KOTAMA && currentUser.kotamaId) {
        where.kotamaId = currentUser.kotamaId;
      } else if (currentUser.satminkalId) {
        where.satminkalId = currentUser.satminkalId;
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        kotama: { select: { id: true, kode: true, nama: true } },
        satminkal: {
          select: {
            id: true,
            kode: true,
            nama: true,
            kotamaId: true,
            kotama: { select: { id: true, kode: true, nama: true } },
          },
        },
        isActive: true,
        lastActiveAt: true,
        currentSessionToken: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch corresponding anggota to enrich metadata
    const nrps = users.map((u) => u.username);
    const anggotaList = await this.prisma.anggota.findMany({
      where: { nrpNip: { in: nrps } },
      include: {
        pangkat: true,
        korps: true,
      },
    });

    const anggotaMap = new Map(anggotaList.map((a) => [a.nrpNip, a]));

    const now = Date.now();
    return users.map((u) => {
      const matchedAnggota = anggotaMap.get(u.username);
      const diffMs = u.lastActiveAt ? now - new Date(u.lastActiveAt).getTime() : Infinity;
      const isOnline = u.isActive && diffMs < 1000 * 60 * 5; // 5 mins
      const isIdle = u.isActive && diffMs >= 1000 * 60 * 5 && diffMs < 1000 * 60 * 30; // 5-30 mins

      let formattedNama = u.namaLengkap;
      if (matchedAnggota) {
        const pNama = matchedAnggota.pangkat?.nama ? `${matchedAnggota.pangkat.nama} ` : '';
        const kNama = (matchedAnggota.korps?.nama && matchedAnggota.korps.nama !== '-') ? `${matchedAnggota.korps.nama} ` : '';
        formattedNama = `${pNama}${kNama}${matchedAnggota.nama}`.trim();
      }

      return {
        ...u,
        namaLengkap: formattedNama || u.namaLengkap,
        isAktif: u.isActive,
        isOnline,
        isIdle,
        isOffline: !isOnline && !isIdle,
        anggota: matchedAnggota
          ? {
              id: matchedAnggota.id,
              pangkat: matchedAnggota.pangkat,
              korps: matchedAnggota.korps,
              tmtAnggota: matchedAnggota.tmtAnggota,
              creditLimit: matchedAnggota.creditLimit,
            }
          : null,
      };
    }).sort((a, b) => {
      const pktA = a.anggota?.pangkat?.kodePkt ?? -1;
      const pktB = b.anggota?.pangkat?.kodePkt ?? -1;
      if (pktB !== pktA) return pktB - pktA;
      return (a.namaLengkap || '').localeCompare(b.namaLengkap || '');
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        kotamaId: true,
        satminkalId: true,
        isActive: true,
        lastActiveAt: true,
        currentSessionToken: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return user;
  }

  async updateRole(id: string, role: Role) {
    const user = await this.findOne(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return updated;
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.findOne(id);

    const updateData: Prisma.UserUpdateInput = {};

    if (dto.username !== undefined) updateData.username = dto.username.trim();
    if (dto.namaLengkap !== undefined) updateData.namaLengkap = dto.namaLengkap.trim();
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    if (dto.kotamaId) {
      updateData.kotama = { connect: { id: dto.kotamaId } };
    }

    if (dto.satminkalId) {
      updateData.satminkal = { connect: { id: dto.satminkalId } };
    }

    if (dto.password) {
      // 1. Ambil user lengkap beserta password saat ini
      const currentUserRecord = await this.prisma.user.findUnique({
        where: { id },
        select: { password: true },
      });

      if (currentUserRecord) {
        const isSameAsCurrent = await bcrypt.compare(
          dto.password,
          currentUserRecord.password,
        );
        if (isSameAsCurrent) {
          throw new BadRequestException(
            'Password baru tidak boleh sama dengan password yang sedang aktif.',
          );
        }
      }

      // 2. Ambil 5 riwayat password terakhir dari tb_password_history
      const recentHistories = await this.prisma.passwordHistory.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const history of recentHistories) {
        const isReused = await bcrypt.compare(dto.password, history.hash);
        if (isReused) {
          throw new BadRequestException(
            'Password baru tidak boleh sama dengan riwayat password yang pernah digunakan sebelumnya (Kebijakan Riwayat Password).',
          );
        }
      }

      const newHashed = await bcrypt.hash(dto.password, 10);
      updateData.password = newHashed;
      updateData.passwordHistories = {
        create: {
          hash: newHashed,
        },
      };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // Synchronize Anggota record
    const nrpToFind = user.username;
    const existingAnggota = await this.prisma.anggota.findFirst({
      where: { nrpNip: nrpToFind },
    });

    if (existingAnggota) {
      await this.prisma.anggota.update({
        where: { id: existingAnggota.id },
        data: {
          ...(dto.namaLengkap ? { nama: dto.namaLengkap.trim() } : {}),
          ...(dto.username ? { nrpNip: dto.username.trim() } : {}),
          ...(dto.isActive !== undefined ? { isAktif: dto.isActive } : {}),
          ...(dto.satminkalId ? { satminkalId: dto.satminkalId } : {}),
          ...(dto.pangkatId ? { pangkatId: dto.pangkatId } : {}),
          ...(dto.korpsId && dto.korpsId !== 'NONE' ? { korpsId: dto.korpsId } : {}),
        },
      });
    }

    return updatedUser;
  }

  async remove(id: string) {
    const user = await this.findOne(id);

    // Check if there is an associated anggota
    const anggota = await this.prisma.anggota.findFirst({
      where: { nrpNip: user.username },
    });

    if (anggota) {
      const pinjamanAktif = await this.prisma.pinjaman.count({
        where: {
          anggotaId: anggota.id,
          status: { in: [StatusPinjaman.DICAIRKAN, StatusPinjaman.SETUJU_KEPRIM] },
        },
      });
      if (pinjamanAktif > 0) {
        throw new ForbiddenException(
          'User/Anggota tidak dapat dihapus karena masih memiliki pinjaman aktif berjalan.',
        );
      }
    }

    try {
      // 1. Delete associated password histories
      await this.prisma.passwordHistory
        .deleteMany({
          where: { userId: id },
        })
        .catch(() => {});

      // 2. Check if user is referenced in transaksiPos as cashier
      const posCount = await this.prisma.transaksiPos.count({
        where: { kasirId: id },
      });

      if (posCount > 0) {
        // If cashier has historical POS transactions, soft delete / deactivate to preserve financial transaction logs
        const updated = await this.prisma.user.update({
          where: { id },
          data: { isActive: false, currentSessionToken: null },
          select: { id: true, username: true, namaLengkap: true, isActive: true },
        });
        if (anggota) {
          await this.prisma.anggota
            .update({
              where: { id: anggota.id },
              data: { isAktif: false },
            })
            .catch(() => {});
        }
        return {
          id: updated.id,
          username: user.username,
          namaLengkap: user.namaLengkap,
          message: 'Akun user dinonaktifkan karena memiliki arsip transaksi kasir POS.',
        };
      }

      // 3. Delete user record
      await this.prisma.user.delete({
        where: { id },
      });

      // 4. Try deleting associated anggota record if any (if no other blocking relations)
      if (anggota) {
        try {
          await this.prisma.simpanan
            .deleteMany({
              where: { anggotaId: anggota.id },
            })
            .catch(() => {});
          await this.prisma.poinAnggota
            .deleteMany({
              where: { anggotaId: anggota.id },
            })
            .catch(() => {});
          await this.prisma.anggota.delete({
            where: { id: anggota.id },
          });
        } catch {
          // If foreign key constraint prevents deleting anggota, deactivate it
          await this.prisma.anggota
            .update({
              where: { id: anggota.id },
              data: { isAktif: false },
            })
            .catch(() => {});
        }
      }

      return {
        id,
        username: user.username,
        namaLengkap: user.namaLengkap,
        message: 'User dan data personel berhasil dihapus dari sistem.',
      };
    } catch {
      // Fallback to deactivation if unforeseen foreign key constraint
      await this.prisma.user
        .update({
          where: { id },
          data: { isActive: false, currentSessionToken: null },
        })
        .catch(() => {});

      return {
        id,
        username: user.username,
        namaLengkap: user.namaLengkap,
        message: 'User dinonaktifkan.',
      };
    }
  }

  async getRealtimeStatus(currentUser?: any) {
    const where: any = {};
    if (currentUser) {
      if (currentUser.role === Role.SUPER_ADMIN) {
        // Super Admin sees all
      } else if (currentUser.role === Role.ADMIN_KOTAMA && currentUser.kotamaId) {
        where.kotamaId = currentUser.kotamaId;
      } else if (currentUser.satminkalId) {
        where.satminkalId = currentUser.satminkalId;
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        isActive: true,
        lastActiveAt: true,
        currentSessionToken: true,
        satminkal: { select: { nama: true } },
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    const now = Date.now();
    return users.map((u) => {
      const diffMs = u.lastActiveAt ? now - new Date(u.lastActiveAt).getTime() : Infinity;
      const isOnline = u.isActive && diffMs < 1000 * 60 * 5; // < 5 mins
      const isIdle = u.isActive && diffMs >= 1000 * 60 * 5 && diffMs < 1000 * 60 * 30; // 5-30 mins

      return {
        id: u.id,
        username: u.username,
        namaLengkap: u.namaLengkap,
        role: u.role,
        satminkal: u.satminkal?.nama ?? '-',
        lastActiveAt: u.lastActiveAt,
        isActive: u.isActive,
        isOnline,
        isIdle,
        isOffline: !isOnline && !isIdle,
        statusLabel: isOnline ? 'Online (Aktif)' : isIdle ? 'Idle (Tidak Aktif Sementara)' : 'Offline',
      };
    });
  }

  async getActiveSessions(currentUser?: any) {
    const where: any = {
      isActive: true,
      currentSessionToken: { not: null },
    };
    if (currentUser) {
      if (currentUser.role === Role.SUPER_ADMIN) {
        // Super Admin sees all
      } else if (currentUser.role === Role.ADMIN_KOTAMA && currentUser.kotamaId) {
        where.kotamaId = currentUser.kotamaId;
      } else if (currentUser.satminkalId) {
        where.satminkalId = currentUser.satminkalId;
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        role: true,
        lastActiveAt: true,
        kotama: { select: { id: true, kode: true, nama: true } },
        satminkal: {
          select: {
            id: true,
            kode: true,
            nama: true,
            kotama: { select: { id: true, kode: true, nama: true } },
          },
        },
      },
      orderBy: { lastActiveAt: 'desc' },
    });
    const now = Date.now();
    return users.map((u) => {
      const diffMs = u.lastActiveAt ? now - new Date(u.lastActiveAt).getTime() : Infinity;
      const kotamaObj = u.kotama || u.satminkal?.kotama || null;
      return {
        id: u.id,
        username: u.username,
        namaLengkap: u.namaLengkap,
        role: u.role,
        kotamaId: kotamaObj?.id ?? null,
        kotamaKode: kotamaObj?.kode ?? null,
        kotamaNama: kotamaObj?.nama ?? 'Mabes TNI AD / Pusat',
        satminkalId: u.satminkal?.id ?? null,
        satminkalKode: u.satminkal?.kode ?? null,
        satminkal: u.satminkal?.nama ?? (u.kotama?.nama ? `Kotama (${u.kotama.nama})` : 'Pusat / Super Admin'),
        lastActiveAt: u.lastActiveAt,
        isOnline: diffMs < 1000 * 60 * 5,
        isIdle: diffMs >= 1000 * 60 * 5 && diffMs < 1000 * 60 * 30,
      };
    });
  }

  async terminateSession(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { currentSessionToken: null },
    });
    return { message: 'Sesi berhasil diakhiri' };
  }
}
