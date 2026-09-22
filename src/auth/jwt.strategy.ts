import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SERVER_BOOT_TIME } from './server-boot.constant';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  kotamaId?: string;
  satminkalId?: string;
  sessionToken?: string;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, currentSessionToken: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Akun Anda telah dinonaktifkan.');
    }

    const enforceSingleDevice =
      process.env.STRICT_SINGLE_DEVICE === 'true';
    if (
      enforceSingleDevice &&
      payload.sessionToken &&
      user.currentSessionToken &&
      payload.sessionToken !== user.currentSessionToken
    ) {
      throw new UnauthorizedException(
        'Akun Anda sedang digunakan di perangkat lain.',
      );
    }

    this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {});

    return {
      id: payload.sub,
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      kotamaId: payload.kotamaId,
      satminkalId: payload.satminkalId,
    };
  }
}
