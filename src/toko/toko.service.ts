import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';

@Injectable()
export class TokoService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  async getKategori(user: JwtUser) {
    return this.prisma.kategoriProduk.findMany({
      where: { satminkalId: this.scopeSatminkal(user) },
      include: { _count: { select: { produk: true } } },
      orderBy: { nama: 'asc' },
    });
  }

  async createKategori(user: JwtUser, dto: { nama: string; deskripsi?: string }) {
    return this.prisma.kategoriProduk.create({
      data: {
        satminkalId: this.scopeSatminkal(user)!,
        nama: dto.nama,
        deskripsi: dto.deskripsi,
      },
    });
  }

  async getProduk(
    user: JwtUser,
    params?: {
      search?: string;
      kategoriId?: string;
      stokKritis?: boolean;
      fastConsumeOnly?: boolean;
      promoOnly?: boolean;
    },
  ) {
    const where: any = {
      satminkalId: this.scopeSatminkal(user),
      isAktif: true,
    };

    if (params?.kategoriId) {
      where.kategoriId = params.kategoriId;
    }

    if (params?.fastConsumeOnly) {
      where.isFastConsume = true;
    }

    if (params?.promoOnly) {
      where.isPromoAktif = true;
    }

    if (params?.search) {
      where.OR = [
        { namaProduk: { contains: params.search, mode: 'insensitive' } },
        { kodeBarcode: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.produk.findMany({
      where,
      include: { kategori: true },
      orderBy: { namaProduk: 'asc' },
    });

    if (params?.stokKritis) {
      return items.filter((p) => p.stokFisik <= p.stokMinimum);
    }

    return items;
  }

  async getProdukByBarcode(user: JwtUser, barcode: string) {
    const item = await this.prisma.produk.findFirst({
      where: {
        satminkalId: this.scopeSatminkal(user),
        kodeBarcode: barcode,
        isAktif: true,
      },
      include: { kategori: true },
    });
    if (!item) {
      throw new NotFoundException(`Produk dengan barcode ${barcode} tidak ditemukan`);
    }
    return item;
  }

  async createProduk(
    user: JwtUser,
    dto: {
      kodeBarcode: string;
      namaProduk: string;
      kategoriId?: string;
      satuanKecil?: string;
      satuanBesar?: string;
      pcsPerUnit?: number;
      hargaBeli: number;
      hargaJual: number;
      stokAwal?: number;
      stokMinimum?: number;
      diskonPersen?: number;
      isPromoAktif?: boolean;
      isFastConsume?: boolean;
      gambarUrl?: string;
    },
  ) {
    const existing = await this.prisma.produk.findFirst({
      where: { kodeBarcode: dto.kodeBarcode },
    });
    if (existing) {
      throw new ConflictException(`Barcode ${dto.kodeBarcode} sudah digunakan untuk ${existing.namaProduk}`);
    }

    const satminkalId = this.scopeSatminkal(user);
    const stokAwal = dto.stokAwal || 0;

    return this.prisma.$transaction(async (tx) => {
      const produk = await tx.produk.create({
        data: {
          satminkalId: satminkalId!,
          kodeBarcode: dto.kodeBarcode,
          namaProduk: dto.namaProduk,
          kategoriId: dto.kategoriId,
          satuanKecil: dto.satuanKecil || 'Pcs',
          satuanBesar: dto.satuanBesar,
          pcsPerUnit: dto.pcsPerUnit || 1,
          hargaBeli: dto.hargaBeli,
          hargaJual: dto.hargaJual,
          stokFisik: stokAwal,
          stokMinimum: dto.stokMinimum || 5,
          diskonPersen: dto.diskonPersen || 0,
          isPromoAktif: dto.isPromoAktif || false,
          isFastConsume: dto.isFastConsume || false,
          gambarUrl: dto.gambarUrl,
        },
      });

      if (stokAwal > 0) {
        await tx.mutasiStok.create({
          data: {
            produkId: produk.id,
            jenis: 'PENYESUAIAN_OPNAME_PLUS',
            jumlahPcs: stokAwal,
            stokSebelum: 0,
            stokSesudah: stokAwal,
            keterangan: 'Input stok awal produk baru',
          },
        });
      }

      return produk;
    });
  }

  async updateProduk(user: JwtUser, id: string, dto: any) {
    const item = await this.prisma.produk.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
    });
    if (!item) {
      throw new NotFoundException('Produk tidak ditemukan');
    }

    return this.prisma.produk.update({
      where: { id },
      data: dto,
      include: { kategori: true },
    });
  }

  async opnameStok(
    user: JwtUser,
    dto: {
      produkId: string;
      stokFisikBaru: number;
      alasan: string;
    },
  ) {
    const item = await this.prisma.produk.findFirst({
      where: { id: dto.produkId, satminkalId: this.scopeSatminkal(user) },
    });
    if (!item) {
      throw new NotFoundException('Produk tidak ditemukan');
    }

    const stokLama = item.stokFisik;
    const selisih = dto.stokFisikBaru - stokLama;
    const jenis = selisih >= 0 ? 'PENYESUAIAN_OPNAME_PLUS' : 'PENYESUAIAN_OPNAME_MINUS';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.produk.update({
        where: { id: dto.produkId },
        data: { stokFisik: dto.stokFisikBaru },
      });

      await tx.mutasiStok.create({
        data: {
          produkId: dto.produkId,
          jenis,
          jumlahPcs: Math.abs(selisih),
          stokSebelum: stokLama,
          stokSesudah: dto.stokFisikBaru,
          keterangan: `Stock Opname: ${dto.alasan}`,
        },
      });

      return updated;
    });
  }

  async getMutasiStok(user: JwtUser, produkId?: string) {
    return this.prisma.mutasiStok.findMany({
      where: {
        ...(produkId ? { produkId } : {}),
        produk: { satminkalId: this.scopeSatminkal(user) },
      },
      include: { produk: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
