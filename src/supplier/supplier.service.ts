import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  async getSuppliers(user: JwtUser) {
    return this.prisma.supplier.findMany({
      where: { satminkalId: this.scopeSatminkal(user) },
      include: {
        _count: { select: { pembelian: true, returSupplier: true } },
      },
      orderBy: { namaSupplier: 'asc' },
    });
  }

  async createSupplier(
    user: JwtUser,
    dto: {
      kodeSupplier?: string;
      namaSupplier: string;
      kontakPerson?: string;
      telepon?: string;
      alamat?: string;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);
    const count = await this.prisma.supplier.count({ where: { satminkalId } });
    const kode =
      dto.kodeSupplier || `SUP-${String(count + 1).padStart(3, '0')}`;

    return this.prisma.supplier.create({
      data: {
        satminkalId: satminkalId!,
        kodeSupplier: kode,
        namaSupplier: dto.namaSupplier,
        kontakPerson: dto.kontakPerson,
        telepon: dto.telepon,
        alamat: dto.alamat,
      },
    });
  }

  async getPembelian(user: JwtUser, supplierId?: string) {
    return this.prisma.pembelianSupplier.findMany({
      where: {
        satminkalId: this.scopeSatminkal(user),
        ...(supplierId ? { supplierId } : {}),
      },
      include: {
        supplier: true,
        items: { include: { produk: true } },
        pembayaran: true,
        retur: true,
      },
      orderBy: { tanggalNota: 'desc' },
    });
  }

  async createPembelian(
    user: JwtUser,
    dto: {
      supplierId: string;
      nomorNota: string;
      tanggalNota?: string;
      metodeBayar: 'TUNAI' | 'KREDIT';
      jatuhTempo?: string;
      items: Array<{
        produkId: string;
        jumlahSatuanBesar?: number;
        satuanBesar?: string;
        isiPerSatuan?: number;
        totalJumlahPcs: number;
        hargaBeliSatuan: number;
      }>;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.$transaction(async (tx) => {
      let totalPembelian = 0;
      const itemRows: any[] = [];

      for (const item of dto.items) {
        const subtotal = item.totalJumlahPcs * item.hargaBeliSatuan;
        totalPembelian += subtotal;

        itemRows.push({
          produkId: item.produkId,
          jumlahSatuanBesar: item.jumlahSatuanBesar || 0,
          satuanBesar: item.satuanBesar,
          isiPerSatuan: item.isiPerSatuan || 1,
          totalJumlahPcs: item.totalJumlahPcs,
          hargaBeliSatuan: item.hargaBeliSatuan,
          subtotal,
        });

        // Update stok produk & HPP harga beli terakhir
        const prod = await tx.produk.findUnique({ where: { id: item.produkId } });
        if (prod) {
          const stokSebelum = prod.stokFisik;
          const stokSesudah = stokSebelum + item.totalJumlahPcs;

          await tx.produk.update({
            where: { id: item.produkId },
            data: {
              stokFisik: stokSesudah,
              hargaBeli: item.hargaBeliSatuan, // Update HPP
            },
          });

          await tx.mutasiStok.create({
            data: {
              produkId: item.produkId,
              jenis: 'MASUK_PEMBELIAN',
              jumlahPcs: item.totalJumlahPcs,
              stokSebelum,
              stokSesudah,
              referensiNota: dto.nomorNota,
              keterangan: `Pembelian dari Supplier (Nota: ${dto.nomorNota})`,
            },
          });
        }
      }

      const sisaHutang = dto.metodeBayar === 'KREDIT' ? totalPembelian : 0;
      const statusLunas = dto.metodeBayar === 'TUNAI';

      const pembelian = await tx.pembelianSupplier.create({
        data: {
          satminkalId: satminkalId!,
          supplierId: dto.supplierId,
          nomorNota: dto.nomorNota,
          tanggalNota: dto.tanggalNota ? new Date(dto.tanggalNota) : new Date(),
          metodeBayar: dto.metodeBayar,
          jatuhTempo: dto.jatuhTempo ? new Date(dto.jatuhTempo) : undefined,
          totalPembelian,
          sisaHutang,
          statusLunas,
          items: {
            create: itemRows,
          },
        },
        include: { items: true, supplier: true },
      });

      // Update total hutang supplier jika kredit
      if (dto.metodeBayar === 'KREDIT') {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { totalHutang: { increment: totalPembelian } },
        });
      }

      return pembelian;
    });
  }

  async createRetur(
    user: JwtUser,
    dto: {
      pembelianId: string;
      supplierId: string;
      nomorRetur: string;
      alasanRetur?: string;
      items: Array<{
        produkId: string;
        jumlahPcs: number;
        hargaSatuan: number;
      }>;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.$transaction(async (tx) => {
      let totalNilaiRetur = 0;
      const returItems: any[] = [];

      for (const item of dto.items) {
        const subtotal = item.jumlahPcs * item.hargaSatuan;
        totalNilaiRetur += subtotal;

        returItems.push({
          produkId: item.produkId,
          jumlahPcs: item.jumlahPcs,
          hargaSatuan: item.hargaSatuan,
          subtotal,
        });

        // Kurangi stok barang karena retur kembali ke supplier
        const prod = await tx.produk.findUnique({ where: { id: item.produkId } });
        if (prod) {
          const stokSebelum = prod.stokFisik;
          const stokSesudah = Math.max(0, stokSebelum - item.jumlahPcs);

          await tx.produk.update({
            where: { id: item.produkId },
            data: { stokFisik: stokSesudah },
          });

          await tx.mutasiStok.create({
            data: {
              produkId: item.produkId,
              jenis: 'KELUAR_RETUR_SUPPLIER',
              jumlahPcs: item.jumlahPcs,
              stokSebelum,
              stokSesudah,
              referensiNota: dto.nomorRetur,
              keterangan: `Retur Barang Rusak ke Supplier (${dto.nomorRetur})`,
            },
          });
        }
      }

      const retur = await tx.returSupplier.create({
        data: {
          satminkalId: satminkalId!,
          pembelianId: dto.pembelianId,
          supplierId: dto.supplierId,
          nomorRetur: dto.nomorRetur,
          totalNilaiRetur,
          alasanRetur: dto.alasanRetur,
          items: { create: returItems },
        },
      });

      // Potong sisa hutang pembelian dan total hutang supplier
      const pb = await tx.pembelianSupplier.findUnique({
        where: { id: dto.pembelianId },
      });
      if (pb && Number(pb.sisaHutang) > 0) {
        const sisaBaru = Math.max(0, Number(pb.sisaHutang) - totalNilaiRetur);
        await tx.pembelianSupplier.update({
          where: { id: dto.pembelianId },
          data: {
            sisaHutang: sisaBaru,
            statusLunas: sisaBaru === 0,
          },
        });

        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { totalHutang: { decrement: totalNilaiRetur } },
        });
      }

      return retur;
    });
  }

  async bayarHutangSupplier(
    user: JwtUser,
    dto: {
      pembelianId: string;
      nominalBayar: number;
      noKwitansi?: string;
      keterangan?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pb = await tx.pembelianSupplier.findUnique({
        where: { id: dto.pembelianId },
        include: { supplier: true },
      });

      if (!pb) {
        throw new NotFoundException('Faktur pembelian tidak ditemukan');
      }

      const sisaHutang = Number(pb.sisaHutang);
      if (dto.nominalBayar > sisaHutang) {
        throw new BadRequestException(
          `Nominal pembayaran (Rp ${dto.nominalBayar}) melebihi sisa hutang (Rp ${sisaHutang})`,
        );
      }

      const payment = await tx.bayarHutangSupplier.create({
        data: {
          pembelianId: dto.pembelianId,
          nominalBayar: dto.nominalBayar,
          noKwitansi: dto.noKwitansi,
          keterangan: dto.keterangan,
        },
      });

      const sisaBaru = sisaHutang - dto.nominalBayar;
      await tx.pembelianSupplier.update({
        where: { id: dto.pembelianId },
        data: {
          sisaHutang: sisaBaru,
          statusLunas: sisaBaru === 0,
        },
      });

      await tx.supplier.update({
        where: { id: pb.supplierId },
        data: { totalHutang: { decrement: dto.nominalBayar } },
      });

      return payment;
    });
  }
}
