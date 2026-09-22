import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { StatusPengajuanMarketplace, JenisSumberProduk } from '@prisma/client';

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  async ajukanProduk(
    user: JwtUser,
    dto: {
      anggotaId: string;
      namaProduk: string;
      kategori: string;
      deskripsi?: string;
      hargaJualUsul: number;
      stokAwal?: number;
      gambarUrl?: string;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.pengajuanMarketplace.create({
      data: {
        satminkalId: satminkalId!,
        anggotaId: dto.anggotaId,
        namaProduk: dto.namaProduk,
        kategori: dto.kategori,
        deskripsi: dto.deskripsi,
        hargaJualUsul: dto.hargaJualUsul,
        stokAwal: dto.stokAwal || 1,
        gambarUrl: dto.gambarUrl,
        status: StatusPengajuanMarketplace.DIAJUKAN,
      },
      include: { anggota: true },
    });
  }

  async getPengajuan(
    user: JwtUser,
    params?: {
      anggotaId?: string;
      status?: StatusPengajuanMarketplace;
    },
  ) {
    return this.prisma.pengajuanMarketplace.findMany({
      where: {
        satminkalId: this.scopeSatminkal(user),
        ...(params?.anggotaId ? { anggotaId: params.anggotaId } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      include: { anggota: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewPengajuan(
    user: JwtUser,
    id: string,
    dto: {
      action: 'APPROVE' | 'REJECT';
      catatan?: string;
      komisiKoperasiPersen?: number;
    },
  ) {
    const pengajuan = await this.prisma.pengajuanMarketplace.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
      include: { anggota: true },
    });

    if (!pengajuan) {
      throw new NotFoundException('Pengajuan marketplace tidak ditemukan');
    }

    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.$transaction(async (tx) => {
      const status =
        dto.action === 'APPROVE'
          ? StatusPengajuanMarketplace.DISETUJUI
          : StatusPengajuanMarketplace.DITOLAK;

      const updated = await tx.pengajuanMarketplace.update({
        where: { id },
        data: {
          status,
          catatanReview: dto.catatan,
          reviewedBy: user.username,
          reviewedAt: new Date(),
          komisiKoperasi: dto.komisiKoperasiPersen || 5,
        },
      });

      // Jika disetujui, daftarkan otomatis ke katalog Produk Koperasi
      if (dto.action === 'APPROVE') {
        const count = await tx.produk.count({ where: { satminkalId } });
        const barcode = `MKP-${String(count + 1).padStart(6, '0')}`;
        const hargaJual = Number(pengajuan.hargaJualUsul);
        const komisi = dto.komisiKoperasiPersen || 5;
        const hargaBeli = hargaJual * (1 - komisi / 100);

        await tx.produk.create({
          data: {
            satminkalId: satminkalId!,
            kodeBarcode: barcode,
            namaProduk: `[UMKM] ${pengajuan.namaProduk}`,
            satuanKecil: 'Pcs',
            pcsPerUnit: 1,
            hargaBeli,
            hargaJual,
            stokFisik: pengajuan.stokAwal,
            stokMinimum: 1,
            sumberProduk: JenisSumberProduk.MARKETPLACE_ANGGOTA,
            penjualAnggotaId: pengajuan.anggotaId,
            gambarUrl: pengajuan.gambarUrl,
            isAktif: true,
          },
        });
      }

      return updated;
    });
  }
}
