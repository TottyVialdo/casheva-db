import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import {
  KategoriBarangGadai,
  StatusGadai,
  TipePinjaman,
  StatusPinjaman,
} from '@prisma/client';

@Injectable()
export class GadaiService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeSatminkal(user: JwtUser) {
    return user.satminkalId;
  }

  simulasiTaksiran(dto: {
    kategori: KategoriBarangGadai;
    beratGramEmas?: number;
    kadarKarat?: number;
    hargaPasarElektronik?: number;
    kondisiPersen?: number;
  }) {
    let nilaiTaksiran = 0;
    let uangPinjamanMaks = 0;

    if (dto.kategori === KategoriBarangGadai.EMAS_PERHIASAN) {
      const hargaEmasMurniPerGram = 1350000;
      const kadar = (dto.kadarKarat || 24) / 24;
      const berat = dto.beratGramEmas || 1;
      nilaiTaksiran = berat * hargaEmasMurniPerGram * kadar;
      uangPinjamanMaks = nilaiTaksiran * 0.85; // 85% LTV
    } else {
      const hargaPasar = dto.hargaPasarElektronik || 5000000;
      const kondisi = (dto.kondisiPersen || 80) / 100;
      nilaiTaksiran = hargaPasar * kondisi;
      uangPinjamanMaks = nilaiTaksiran * 0.7; // 70% LTV
    }

    const biayaJasaTitipPerBulan = (uangPinjamanMaks * 1.5) / 100; // 1.5% / bln
    const biayaAdmin = 25000;

    return {
      kategori: dto.kategori,
      nilaiTaksiran: Math.round(nilaiTaksiran),
      uangPinjamanMaksimal: Math.round(uangPinjamanMaks),
      biayaJasaTitipPerBulan: Math.round(biayaJasaTitipPerBulan),
      biayaAdmin,
      tenorHariDefault: 120, // 4 bulan
    };
  }

  async ajukanGadai(
    user: JwtUser,
    dto: {
      anggotaId: string;
      kategori: KategoriBarangGadai;
      namaBarang: string;
      spesifikasiKondisi?: string;
      nilaiTaksiran: number;
      uangPinjamanGadai: number;
      fotoBarangUrl?: string;
    },
  ) {
    const satminkalId = this.scopeSatminkal(user);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const jatuhTempo = new Date(now);
      jatuhTempo.setDate(jatuhTempo.getDate() + 120);

      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.gadaiBarang.count({ where: { satminkalId } });
      const nomorSbg = `SBG-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      const gadai = await tx.gadaiBarang.create({
        data: {
          satminkalId: satminkalId!,
          nomorSbg,
          anggotaId: dto.anggotaId,
          kategori: dto.kategori,
          namaBarang: dto.namaBarang,
          spesifikasiKondisi: dto.spesifikasiKondisi,
          nilaiTaksiran: dto.nilaiTaksiran,
          uangPinjamanGadai: dto.uangPinjamanGadai,
          biayaJasaTitip: 1.5,
          biayaAdmin: 25000,
          tanggalGadai: now,
          jatuhTempo,
          status: StatusGadai.AKTIF_BERJALAN,
          fotoBarangUrl: dto.fotoBarangUrl,
        },
        include: { anggota: true },
      });

      // Catat sebagai entri pinjaman bertipe DANA_GADAI
      await tx.pinjaman.create({
        data: {
          anggotaId: dto.anggotaId,
          tipePinjaman: TipePinjaman.DANA_GADAI,
          nominal: dto.uangPinjamanGadai,
          tenorBulan: 4,
          bungaPersenTahun: 18, // 1.5% x 12
          status: StatusPinjaman.DICAIRKAN,
          tanggalAjuan: now,
          tanggalCair: now,
          sisaPokok: dto.uangPinjamanGadai,
          catatan: `Agunan Gadai (${nomorSbg} - ${dto.namaBarang})`,
        },
      });

      return gadai;
    });
  }

  async getGadaiList(
    user: JwtUser,
    params?: {
      anggotaId?: string;
      status?: StatusGadai;
      lelangOnly?: boolean;
    },
  ) {
    const where: any = {
      satminkalId: this.scopeSatminkal(user),
    };

    if (params?.anggotaId) {
      where.anggotaId = params.anggotaId;
    }

    if (params?.status) {
      where.status = params.status;
    }

    if (params?.lelangOnly) {
      where.status = {
        in: [StatusGadai.JATUH_TEMPO_LELANG, StatusGadai.BARANG_TERJUAL_LELANG],
      };
    }

    return this.prisma.gadaiBarang.findMany({
      where,
      include: { anggota: true },
      orderBy: { tanggalGadai: 'desc' },
    });
  }

  async tebusGadai(user: JwtUser, id: string) {
    const gadai = await this.prisma.gadaiBarang.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
    });

    if (!gadai) {
      throw new NotFoundException('Data gadai tidak ditemukan');
    }

    if (gadai.status !== StatusGadai.AKTIF_BERJALAN) {
      throw new BadRequestException('Status gadai tidak dapat ditebus');
    }

    const now = new Date();
    const bulanBerjalan = Math.max(
      1,
      Math.ceil(
        (now.getTime() - new Date(gadai.tanggalGadai).getTime()) /
          (1000 * 60 * 60 * 24 * 30),
      ),
    );

    const pokok = Number(gadai.uangPinjamanGadai);
    const jasaTitip = (pokok * Number(gadai.biayaJasaTitip) * bulanBerjalan) / 100;
    const totalDitebus = pokok + jasaTitip;

    return this.prisma.gadaiBarang.update({
      where: { id },
      data: {
        status: StatusGadai.DITEBUS_LUNAS,
        tanggalPenebusan: now,
        totalDitebus,
      },
      include: { anggota: true },
    });
  }

  async jadwalkanLelang(user: JwtUser, id: string, hargaBukaLelang?: number) {
    const gadai = await this.prisma.gadaiBarang.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
    });

    if (!gadai) {
      throw new NotFoundException('Data gadai tidak ditemukan');
    }

    const hargaBuka =
      hargaBukaLelang || Number(gadai.uangPinjamanGadai) * 1.1; // Pokok + margin 10%

    return this.prisma.gadaiBarang.update({
      where: { id },
      data: {
        status: StatusGadai.JATUH_TEMPO_LELANG,
        hargaLelangBuka: hargaBuka,
      },
      include: { anggota: true },
    });
  }

  async beliBarangLelang(
    user: JwtUser,
    id: string,
    dto: {
      namaPembeli: string;
      nominalBayar: number;
    },
  ) {
    const gadai = await this.prisma.gadaiBarang.findFirst({
      where: { id, satminkalId: this.scopeSatminkal(user) },
    });

    if (!gadai || gadai.status !== StatusGadai.JATUH_TEMPO_LELANG) {
      throw new BadRequestException('Barang lelang tidak tersedia');
    }

    return this.prisma.gadaiBarang.update({
      where: { id },
      data: {
        status: StatusGadai.BARANG_TERJUAL_LELANG,
        hargaLelangTerjual: dto.nominalBayar,
        tanggalTerjual: new Date(),
        pembeliLelang: dto.namaPembeli,
      },
    });
  }
}
