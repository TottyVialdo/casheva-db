import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKopstukDto } from './dto/create-kopstuk.dto';

@Injectable()
export class KopstukService {
  constructor(private prisma: PrismaService) {}

  async upsertBySatminkal(satminkalId: string, dto: CreateKopstukDto) {
    const data = {
      namaSatuan: dto.namaSatuan || dto.baris1 || 'MARKAS BESAR ANGKATAN DARAT',
      namaBalak: dto.namaBalak || dto.baris2 || 'KOMANDO UTAMA / BALAKPUS',
      alamat: dto.alamat || dto.baris3 || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
      nomorTelepon: dto.nomorTelepon || '024-7472249',
      logoUrl: dto.logoUrl,
      garisGanda: dto.garisGanda ?? true,
    };

    return this.prisma.kopstuk.upsert({
      where: { satminkalId },
      create: {
        satminkalId,
        ...data,
      },
      update: data,
    });
  }

  async upsertByKotama(kotamaId: string, dto: CreateKopstukDto) {
    const data = {
      namaSatuan: dto.namaSatuan || dto.baris1 || 'MARKAS BESAR ANGKATAN DARAT',
      namaBalak: dto.namaBalak || dto.baris2 || 'KOMANDO UTAMA / BALAKPUS',
      alamat: dto.alamat || dto.baris3 || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
      nomorTelepon: dto.nomorTelepon || '024-7472249',
      logoUrl: dto.logoUrl,
      garisGanda: dto.garisGanda ?? true,
    };

    const existing = await this.prisma.kopstuk.findFirst({
      where: { kotamaId },
    });

    if (existing) {
      return this.prisma.kopstuk.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.kopstuk.create({
      data: {
        kotamaId,
        ...data,
      },
    });
  }

  async getBySatminkal(satminkalId?: string, kotamaId?: string) {
    if (satminkalId) {
      const kopstuk = await this.prisma.kopstuk.findUnique({
        where: { satminkalId },
      });
      if (kopstuk) return kopstuk;
    }

    if (kotamaId) {
      const kopstuk = await this.prisma.kopstuk.findFirst({
        where: { kotamaId },
      });
      if (kopstuk) return kopstuk;
    }

    return this.prisma.kopstuk.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }

  async getByKotama(kotamaId?: string) {
    if (kotamaId) {
      const kopstuk = await this.prisma.kopstuk.findFirst({
        where: { kotamaId },
      });
      if (kopstuk) return kopstuk;
    }
    return this.prisma.kopstuk.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }
}
