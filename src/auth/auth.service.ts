import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { Role } from '@prisma/client';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) { }

  async login(dto: LoginDto) {
    const inputIdentifier = dto.username.trim();

    let user = await this.prisma.user.findUnique({
      where: { username: inputIdentifier },
      include: { kotama: true, satminkal: { include: { kotama: true } } },
    });

    // If user not found by username, check if it's an Anggota NRP/NIP
    if (!user) {
      const anggota = await this.prisma.anggota.findFirst({
        where: { nrpNip: inputIdentifier, isAktif: true },
        include: { satminkal: { include: { kotama: true } }, pangkat: true },
      });

      if (anggota) {
        const defaultPasswordHash = await bcrypt.hash('Admin123!', 10);
        user = await this.prisma.user.upsert({
          where: { username: anggota.nrpNip },
          create: {
            username: anggota.nrpNip,
            password: defaultPasswordHash,
            namaLengkap: `${anggota.pangkat?.nama || ''} ${anggota.nama}`.trim(),
            role: Role.ANGGOTA,
            kotamaId: anggota.satminkal.kotamaId,
            satminkalId: anggota.satminkalId,
          },
          update: {},
          include: { kotama: true, satminkal: { include: { kotama: true } } },
        });
      }
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Kredensial tidak valid atau akun tidak aktif.',
      );
    }

    const currentUser = user;

    const isPasswordValid = await bcrypt.compare(dto.password, currentUser.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('NRP / Username atau password salah.');
    }

    // Enrich and synchronize official military display name from Anggota
    const anggota = await this.prisma.anggota.findFirst({
      where: { nrpNip: currentUser.username },
      include: { pangkat: true, korps: true },
    });

    let displayNama = currentUser.namaLengkap;
    if (anggota) {
      const pNama = anggota.pangkat?.nama ? `${anggota.pangkat.nama} ` : '';
      const kNama = (anggota.korps?.nama && anggota.korps.nama !== '-') ? `${anggota.korps.nama} ` : '';
      displayNama = `${pNama}${kNama}${anggota.nama}`.trim();

      if (displayNama && currentUser.namaLengkap !== displayNama) {
        user = await this.prisma.user.update({
          where: { id: currentUser.id },
          data: { namaLengkap: displayNama },
          include: { kotama: true, satminkal: { include: { kotama: true } } },
        });
      }
    }

    const finalUser = user || currentUser;

    // Detect if account had an active session on another device
    const wasActiveOnAnotherDevice = Boolean(
      finalUser.currentSessionToken &&
      finalUser.lastActiveAt &&
      (new Date().getTime() - new Date(finalUser.lastActiveAt).getTime()) < 24 * 60 * 60 * 1000
    );

    const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);

    await this.prisma.user.update({
      where: { id: finalUser.id },
      data: {
        currentSessionToken: sessionToken,
        lastActiveAt: new Date(),
      },
    });

    const payload = {
      sub: finalUser.id,
      username: finalUser.username,
      namaLengkap: displayNama,
      role: finalUser.role,
      kotamaId: finalUser.kotamaId,
      satminkalId: finalUser.satminkalId,
      sessionToken,
    };

    return {
      message: 'Login berhasil',
      wasActiveOnAnotherDevice,
      accessToken: this.jwtService.sign(payload),
      user: {
        id: finalUser.id,
        namaLengkap: displayNama,
        role: finalUser.role,
        kotama: finalUser.kotama?.nama ?? finalUser.satminkal?.kotama?.nama ?? 'KODAM IV/DIPONEGORO',
        satminkal: finalUser.satminkal?.nama ?? (finalUser.role === Role.ADMIN_KOTAMA ? (finalUser.kotama?.nama ?? 'KODAM IV/DIPONEGORO') : 'INFOLAHTADAM IV/DIPONEGORO'),
        kotamaId: finalUser.kotamaId ?? finalUser.satminkal?.kotamaId ?? null,
        satminkalId: finalUser.satminkalId,
      },
    };
  }

  async logout(userId: string) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          currentSessionToken: null,
        },
      });
    } catch {
      // Ignore if user not found
    }
  }

  async getProfile(user: JwtUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: { kotama: true, satminkal: { include: { kotama: true } } },
    });
    if (!dbUser) return user;

    const anggota = await this.prisma.anggota.findFirst({
      where: { nrpNip: dbUser.username },
      include: { pangkat: true, korps: true },
    });

    let displayNama = dbUser.namaLengkap;
    if (anggota) {
      const pNama = anggota.pangkat?.nama ? `${anggota.pangkat.nama} ` : '';
      const kNama = (anggota.korps?.nama && anggota.korps.nama !== '-') ? `${anggota.korps.nama} ` : '';
      displayNama = `${pNama}${kNama}${anggota.nama}`.trim();
    }

    return {
      id: dbUser.id,
      username: dbUser.username,
      namaLengkap: displayNama,
      role: dbUser.role,
      kotama: dbUser.kotama?.nama ?? dbUser.satminkal?.kotama?.nama ?? 'KODAM IV/DIPONEGORO',
      satminkal: dbUser.satminkal?.nama ?? (dbUser.role === Role.ADMIN_KOTAMA ? (dbUser.kotama?.nama ?? 'KODAM IV/DIPONEGORO') : 'INFOLAHTADAM IV/DIPONEGORO'),
      kotamaId: dbUser.kotamaId ?? dbUser.satminkal?.kotamaId ?? null,
      satminkalId: dbUser.satminkalId,
    };
  }
}
