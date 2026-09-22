import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { StatusPinjaman, TipePinjaman } from '@prisma/client';

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  async checkout(
    user: JwtUser,
    dto: {
      anggotaId?: string;
      namaPelanggan?: string;
      metodeBayar: 'TUNAI' | 'QRIS' | 'TRANSFER' | 'KREDIT_TEMPO';
      tenorBulan?: number; // Jika kredit tempo (default 3 bulan)
      bayarTunai?: number;
      items: Array<{
        produkId: string;
        jumlah: number;
        diskonItem?: number;
      }>;
    },
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Keranjang belanja kosong');
    }

    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.$transaction(async (tx) => {
      // 1. Validasi & Ambil data produk
      let totalBelanja = 0;
      let totalHpp = 0;
      let totalDiskon = 0;
      let totalItemCount = 0;

      const itemsDetail: Array<{
        produkId: string;
        jumlah: number;
        hargaBeliHpp: number;
        hargaJual: number;
        diskonItem: number;
        subtotal: number;
        namaProduk: string;
      }> = [];

      for (const item of dto.items) {
        const produk = await tx.produk.findFirst({
          where: { id: item.produkId, satminkalId },
        });

        if (!produk) {
          throw new NotFoundException(`Produk dengan ID ${item.produkId} tidak ditemukan`);
        }

        if (produk.stokFisik < item.jumlah) {
          throw new BadRequestException(
            `Stok barang "${produk.namaProduk}" tidak mencukupi (Tersedia: ${produk.stokFisik}, Diminta: ${item.jumlah})`,
          );
        }

        const hargaJual = Number(produk.hargaJual);
        const hargaHpp = Number(produk.hargaBeli);
        const diskon = item.diskonItem || (produk.isPromoAktif ? (hargaJual * Number(produk.diskonPersen)) / 100 : 0);
        const subtotal = (hargaJual - diskon) * item.jumlah;

        totalBelanja += subtotal;
        totalHpp += hargaHpp * item.jumlah;
        totalDiskon += diskon * item.jumlah;
        totalItemCount += item.jumlah;

        itemsDetail.push({
          produkId: produk.id,
          jumlah: item.jumlah,
          hargaBeliHpp: hargaHpp,
          hargaJual,
          diskonItem: diskon,
          subtotal,
          namaProduk: produk.namaProduk,
        });
      }

      // 2. Validasi Pembayaran Kredit Tempo
      let pinjamanId: string | undefined = undefined;
      if (dto.metodeBayar === 'KREDIT_TEMPO') {
        if (!dto.anggotaId) {
          throw new BadRequestException('Metode pembayaran Kredit Tempo wajib memilih anggota koperasi');
        }

        const anggota = await tx.anggota.findUnique({
          where: { id: dto.anggotaId },
        });

        if (!anggota) {
          throw new NotFoundException('Anggota tidak ditemukan');
        }

        if (anggota.tipeAnggota === 'NON_ORGANIK') {
          throw new BadRequestException('Anggota Non-Organik / Luar hanya diperbolehkan transaksi tunai');
        }

        const tenor = dto.tenorBulan || 3;
        const pinjaman = await tx.pinjaman.create({
          data: {
            anggotaId: dto.anggotaId,
            tipePinjaman: TipePinjaman.BARANG_TOKO,
            nominal: totalBelanja,
            tenorBulan: tenor,
            bungaPersenTahun: 0, // Cicilan toko 0% atau sesuai kebijakan
            status: StatusPinjaman.DICAIRKAN,
            tanggalAjuan: new Date(),
            tanggalCair: new Date(),
            sisaPokok: totalBelanja,
            catatan: `Kredit Belanja POS Toko Koperasi`,
          },
        });

        pinjamanId = pinjaman.id;

        // Generate angsuran bulanan
        const angsuranPerBulan = Math.ceil(totalBelanja / tenor);
        for (let i = 1; i <= tenor; i++) {
          const jatuhTempo = new Date();
          jatuhTempo.setMonth(jatuhTempo.getMonth() + i);

          await tx.angsuran.create({
            data: {
              pinjamanId: pinjaman.id,
              bulanKe: i,
              jatuhTempo,
              pokok: i === tenor ? totalBelanja - angsuranPerBulan * (tenor - 1) : angsuranPerBulan,
              bunga: 0,
              biayaAdmin: 0,
              total: i === tenor ? totalBelanja - angsuranPerBulan * (tenor - 1) : angsuranPerBulan,
              dibayar: false,
            },
          });
        }
      }

      // 3. Generate Nomor Invoice
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.transaksiPos.count({
        where: { satminkalId },
      });
      const nomorInvoice = `POS-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      // 4. Hitung Poin (1 poin per 10.000 belanja)
      const poinDidapat = Math.floor(totalBelanja / 10000);

      const bayarTunai = dto.bayarTunai || (dto.metodeBayar === 'TUNAI' ? totalBelanja : 0);
      const kembalian = dto.metodeBayar === 'TUNAI' ? Math.max(0, bayarTunai - totalBelanja) : 0;

      // 5. Buat Transaksi POS
      const transaksi = await tx.transaksiPos.create({
        data: {
          satminkalId: satminkalId!,
          nomorInvoice,
          kasirId: user.userId,
          anggotaId: dto.anggotaId,
          namaPelanggan: dto.namaPelanggan,
          metodeBayar: dto.metodeBayar,
          totalItem: totalItemCount,
          totalBelanja,
          totalHpp,
          totalDiskon,
          bayarTunai,
          kembalian,
          poinDidapat,
          status: 'SELESAI',
          pinjamanId,
          items: {
            create: itemsDetail.map((it) => ({
              produkId: it.produkId,
              jumlah: it.jumlah,
              hargaBeliHpp: it.hargaBeliHpp,
              hargaJual: it.hargaJual,
              diskonItem: it.diskonItem,
              subtotal: it.subtotal,
            })),
          },
        },
        include: {
          items: { include: { produk: true } },
          anggota: true,
          kasir: true,
        },
      });

      // 6. Update Stok Produk & Catat Mutasi
      for (const it of itemsDetail) {
        const p = await tx.produk.findUnique({ where: { id: it.produkId } });
        if (p) {
          const stokSebelum = p.stokFisik;
          const stokSesudah = stokSebelum - it.jumlah;

          await tx.produk.update({
            where: { id: it.produkId },
            data: { stokFisik: stokSesudah },
          });

          await tx.mutasiStok.create({
            data: {
              produkId: it.produkId,
              jenis: 'KELUAR_PENJUALAN_POS',
              jumlahPcs: it.jumlah,
              stokSebelum,
              stokSesudah,
              referensiNota: nomorInvoice,
              keterangan: `Penjualan Kasir POS (${nomorInvoice})`,
            },
          });
        }
      }

      // 7. Akumulasi Poin Anggota jika ada
      if (dto.anggotaId && poinDidapat > 0) {
        await tx.poinAnggota.upsert({
          where: { anggotaId: dto.anggotaId },
          create: {
            anggotaId: dto.anggotaId,
            totalPoinAktif: poinDidapat,
            totalPoinKlaim: 0,
          },
          update: {
            totalPoinAktif: { increment: poinDidapat },
          },
        });
      }

      return transaksi;
    });
  }

  async getTransaksi(
    user: JwtUser,
    params?: {
      search?: string;
      tanggalMulai?: string;
      tanggalSelesai?: string;
      metodeBayar?: string;
    },
  ) {
    const where: any = {
      satminkalId: this.scopeSatminkal(user),
    };

    if (params?.search) {
      where.OR = [
        { nomorInvoice: { contains: params.search, mode: 'insensitive' } },
        { namaPelanggan: { contains: params.search, mode: 'insensitive' } },
        { anggota: { nama: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    if (params?.metodeBayar) {
      where.metodeBayar = params.metodeBayar;
    }

    if (params?.tanggalMulai || params?.tanggalSelesai) {
      where.createdAt = {};
      if (params.tanggalMulai) where.createdAt.gte = new Date(params.tanggalMulai);
      if (params.tanggalSelesai) where.createdAt.lte = new Date(params.tanggalSelesai);
    }

    return this.prisma.transaksiPos.findMany({
      where,
      include: {
        items: { include: { produk: true } },
        anggota: true,
        kasir: { select: { id: true, namaLengkap: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getTransaksiById(user: JwtUser, id: string) {
    const trx = await this.prisma.transaksiPos.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
      include: {
        items: { include: { produk: true } },
        anggota: true,
        kasir: { select: { id: true, namaLengkap: true, username: true } },
      },
    });
    if (!trx) {
      throw new NotFoundException('Transaksi POS tidak ditemukan');
    }
    return trx;
  }

  async voidTransaksi(user: JwtUser, id: string, alasan: string) {
    const trx = await this.prisma.transaksiPos.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
      include: { items: true },
    });

    if (!trx) {
      throw new NotFoundException('Transaksi tidak ditemukan');
    }

    if (trx.status === 'DIBATALKAN') {
      throw new BadRequestException('Transaksi ini sudah pernah dibatalkan');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update status transaksi
      const updatedTrx = await tx.transaksiPos.update({
        where: { id },
        data: {
          status: 'DIBATALKAN',
        },
      });

      // 2. Kembalikan stok produk (Rollback)
      for (const item of trx.items) {
        const prod = await tx.produk.findUnique({ where: { id: item.produkId } });
        if (prod) {
          const stokSebelum = prod.stokFisik;
          const stokSesudah = stokSebelum + item.jumlah;

          await tx.produk.update({
            where: { id: item.produkId },
            data: { stokFisik: stokSesudah },
          });

          await tx.mutasiStok.create({
            data: {
              produkId: item.produkId,
              jenis: 'BATAL_TRANSAKSI_POS',
              jumlahPcs: item.jumlah,
              stokSebelum,
              stokSesudah,
              referensiNota: trx.nomorInvoice,
              keterangan: `Pembatalan Transaksi POS: ${alasan}`,
            },
          });
        }
      }

      // 3. Batalkan pinjaman jika metode kredit
      if (trx.pinjamanId) {
        await tx.pinjaman.update({
          where: { id: trx.pinjamanId },
          data: { status: StatusPinjaman.DITOLAK, catatan: `Dibatalkan dari Void POS: ${alasan}` },
        });
      }

      return updatedTrx;
    });
  }
}
