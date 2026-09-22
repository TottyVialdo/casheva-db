import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { Role, TipePengambilan, StatusPesananOnline } from '@prisma/client';

@Injectable()
export class PesananService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  private isStaffRole(user: JwtUser): boolean {
    const roleStr = String(user.role || '').toUpperCase().replace(/\s+/g, '_');
    return (
      roleStr === Role.ADMIN_KOPERASI ||
      roleStr === Role.KASIR_TOKO ||
      roleStr === 'ADMIN_KOPERASI' ||
      roleStr === 'KASIR_TOKO'
    );
  }

  async createPesanan(
    user: JwtUser,
    dto: {
      anggotaId: string;
      tipePengambilan: TipePengambilan;
      lokasiTujuan?: string;
      namaPetugasPiket?: string;
      noHpPenerima?: string;
      metodeBayar?: 'TUNAI' | 'QRIS' | 'TRANSFER' | 'KREDIT_TEMPO';
      items: Array<{
        produkId: string;
        jumlah: number;
      }>;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);
    let targetAnggotaId = dto.anggotaId;

    if (!this.isStaffRole(user)) {
      const anggota = await this.prisma.anggota.findFirst({
        where: {
          satminkalId,
          OR: [{ nrpNip: user.username }, { id: user.userId }],
        },
      });
      if (anggota) {
        targetAnggotaId = anggota.id;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let totalHargaBarang = 0;
      const itemRows: any[] = [];

      for (const item of dto.items) {
        const prod = await tx.produk.findFirst({
          where: { id: item.produkId, satminkalId },
        });
        if (!prod) {
          throw new NotFoundException(`Produk ${item.produkId} tidak ditemukan`);
        }
        if (prod.stokFisik < item.jumlah) {
          throw new BadRequestException(`Stok ${prod.namaProduk} tidak mencukupi`);
        }

        const hargaSatuan = Number(prod.hargaJual);
        const subtotal = hargaSatuan * item.jumlah;
        totalHargaBarang += subtotal;

        itemRows.push({
          produkId: item.produkId,
          jumlah: item.jumlah,
          hargaSatuan,
          subtotal,
        });

        // Reserve stock
        await tx.produk.update({
          where: { id: item.produkId },
          data: { stokFisik: prod.stokFisik - item.jumlah },
        });
      }

      // Hitung ongkir (contoh flat Rp 5.000 untuk delivery cepat)
      const ongkir = dto.tipePengambilan === 'DELIVERY_CEPAT' ? 5000 : 0;
      const totalTagihan = totalHargaBarang + ongkir;

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.pesananOnline.count({ where: { satminkalId } });
      const nomorPesanan = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      const pesanan = await tx.pesananOnline.create({
        data: {
          satminkalId: satminkalId!,
          nomorPesanan,
          anggotaId: targetAnggotaId,
          tipePengambilan: dto.tipePengambilan,
          lokasiTujuan: dto.lokasiTujuan,
          namaPetugasPiket: dto.namaPetugasPiket,
          noHpPenerima: dto.noHpPenerima,
          ongkir,
          totalHargaBarang,
          totalTagihan,
          metodeBayar: dto.metodeBayar || 'TUNAI',
          status: StatusPesananOnline.MENUNGGU_KONFIRMASI,
          estimasiMenit: 30,
          waktuPesan: now,
          items: {
            create: itemRows,
          },
        },
        include: {
          items: { include: { produk: true } },
          anggota: true,
        },
      });

      return pesanan;
    });
  }

  async getPesanan(
    user: JwtUser,
    params?: {
      anggotaId?: string;
      status?: StatusPesananOnline;
      tipePengambilan?: TipePengambilan;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);
    let filterAnggotaId = params?.anggotaId;

    // Jika BUKAN Admin Koperasi atau Kasir Toko (misalnya role Anggota), batasi HANYA pesanan miliknya sendiri
    if (!this.isStaffRole(user)) {
      const anggota = await this.prisma.anggota.findFirst({
        where: {
          satminkalId,
          OR: [{ nrpNip: user.username }, { id: user.userId }],
        },
      });

      if (!anggota) {
        return [];
      }
      filterAnggotaId = anggota.id;
    }

    return this.prisma.pesananOnline.findMany({
      where: {
        satminkalId,
        ...(filterAnggotaId ? { anggotaId: filterAnggotaId } : {}),
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.tipePengambilan
          ? { tipePengambilan: params.tipePengambilan }
          : {}),
      },
      include: {
        items: { include: { produk: true } },
        anggota: true,
      },
      orderBy: { waktuPesan: 'desc' },
    });
  }

  async updateStatusPesanan(
    user: JwtUser,
    id: string,
    status: StatusPesananOnline,
    petugasPiket?: string,
  ) {
    const satminkalId = this.scopeSatminkal(user);
    const pesanan = await this.prisma.pesananOnline.findFirst({
      where: { id, satminkalId },
      include: { anggota: true },
    });

    if (!pesanan) {
      throw new NotFoundException('Pesanan tidak ditemukan');
    }

    // Role Anggota hanya boleh memperbarui status pesanannya sendiri (khususnya konfirmasi SELESAI)
    if (!this.isStaffRole(user)) {
      if (
        pesanan.anggota?.nrpNip !== user.username &&
        pesanan.anggotaId !== user.userId
      ) {
        throw new ForbiddenException(
          'Anda hanya berhak mengonfirmasi status pesanan Anda sendiri',
        );
      }
      if (status !== StatusPesananOnline.SELESAI) {
        throw new ForbiddenException(
          'Anggota hanya diizinkan mengonfirmasi penyelesaian pesanan',
        );
      }
    }

    const now = new Date();
    const updateData: any = { status };

    if (status === StatusPesananOnline.SEDANG_DIANTAR) {
      updateData.waktuMulaiAntar = now;
    }

    if (status === StatusPesananOnline.TITIP_DI_PIKET && petugasPiket) {
      updateData.namaPetugasPiket = petugasPiket;
    }

    if (status === StatusPesananOnline.SELESAI) {
      updateData.waktuSelesai = now;

      // Evaluasi SLA Pengiriman
      if (pesanan.tipePengambilan === 'DELIVERY_CEPAT') {
        const durasiMenit =
          (now.getTime() - new Date(pesanan.waktuPesan).getTime()) / (1000 * 60);

        if (durasiMenit > pesanan.estimasiMenit) {
          updateData.isTerlambatSla = true;
          // Beri kompensasi diskon 15% dari total harga barang
          updateData.kompensasiDiskon =
            (Number(pesanan.totalHargaBarang) * 15) / 100;
        }
      }
    }

    return this.prisma.pesananOnline.update({
      where: { id },
      data: updateData,
      include: {
        items: { include: { produk: true } },
        anggota: true,
      },
    });
  }
}
