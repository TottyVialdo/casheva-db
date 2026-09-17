import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import { hitungJadwalAngsuran } from '../common/utils/pinjaman-calculator';
import { toNumber } from '../common/utils/decimal.util';
import { StatusPinjaman } from '@prisma/client';

export function formatPktCrpNrpDinas(
  pangkatNama: string,
  korpsNama?: string | null,
  kategori?: string | null,
  nrpNip?: string | null,
): string {
  const p = (pangkatNama || '').trim();
  const c = korpsNama && korpsNama.trim() !== '-' && korpsNama.trim() !== 'NONE' ? korpsNama.trim() : '';
  const kat = (kategori || '').toUpperCase();

  const isPati =
    kat === 'PATI' ||
    ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal', 'Brigadir Jenderal', 'Mayor Jenderal', 'Letnan Jenderal'].some((pat) =>
      p.toLowerCase().startsWith(pat.toLowerCase()) || p.toLowerCase().includes(pat.toLowerCase()),
    );

  let formattedPkt = p;
  if (isPati) {
    const basePkt = p.replace(/\s+(Inf|Kav|Arm|Arh|Czi|Cpm|Cba|Ckm|Cpl|Cke|Chk|Caj|Cku|Ctp|Cpn|TNI)\b/gi, '').trim();
    formattedPkt = `${basePkt} TNI`;
  } else {
    const isPerwira =
      kat === 'PAMEN' ||
      kat === 'PAMA' ||
      ['Kolonel', 'Letkol', 'Mayor', 'Kapten', 'Lettu', 'Letda'].some((per) =>
        p.toLowerCase().startsWith(per.toLowerCase()),
      );

    if (isPerwira) {
      if (c && !p.toLowerCase().includes(c.toLowerCase())) {
        formattedPkt = `${p} ${c}`;
      }
    } else {
      // BA/TA/PNS -> hanya nama pangkat
      formattedPkt = p.replace(/\s+(Inf|Kav|Arm|Arh|Czi|Cpm|Cba|Ckm|Cpl|Cke|Chk|Caj|Cku|Ctp|Cpn|TNI)\b/gi, '').trim();
    }
  }

  return nrpNip ? `${formattedPkt} / ${nrpNip}` : formattedPkt;
}

export function formatPangkatDinas(
  pangkatNama: string,
  korpsNama?: string | null,
  kategori?: string | null,
): string {
  return formatPktCrpNrpDinas(pangkatNama, korpsNama, kategori);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getKopstukAndTajuk(satminkalId: string, kategoriTtd?: string) {
    const kopstuk = await this.prisma.kopstuk.findFirst({
      where: { satminkalId },
    });

    const tajuk = await this.prisma.tajukTandaTangan.findFirst({
      where: {
        isAktif: true,
        ...(kategoriTtd ? { kategori: kategoriTtd } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      kopstuk: kopstuk
        ? {
            id: kopstuk.id,
            satminkalId: kopstuk.satminkalId,
            namaSatuan: kopstuk.namaSatuan,
            namaBalak: kopstuk.namaBalak,
            alamat: kopstuk.alamat || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
            nomorTelepon: kopstuk.nomorTelepon || '024-7472249',
            baris1: kopstuk.namaSatuan,
            baris2: kopstuk.namaBalak,
            baris3: kopstuk.alamat || 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
          }
        : {
            namaSatuan: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
            namaBalak: 'INFORMASI DAN PENGOLAHAN DATA',
            alamat: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
            nomorTelepon: '024-7472249',
            baris1: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
            baris2: 'INFORMASI DAN PENGOLAHAN DATA',
            baris3: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
          },
      tajukTtd: tajuk
        ? {
            id: tajuk.id,
            jabatan: tajuk.jabatan,
            namaPejabat: tajuk.namaPejabat,
            pangkat: tajuk.pangkat,
            nrp: tajuk.nrp,
            pangkatNrp: `${tajuk.pangkat} NRP ${tajuk.nrp}`,
            tempatTanggal: 'Semarang, 4 Agustus 2026',
          }
        : {
            jabatan: 'Ketua Primkop Kartika',
            namaPejabat: 'Sigit Suhendro Hadi K., S.T., M.Tr.(Han)',
            pangkat: 'Kolonel Inf',
            nrp: '11020019460278',
            pangkatNrp: 'Kolonel Inf NRP 11020019460278',
            tempatTanggal: 'Semarang, 4 Agustus 2026',
          },
    };
  }

  // 1. Data Anggota Koperasi (Lampiran II)
  async getReportAnggota(user: JwtUser) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId);

    const anggota = await this.prisma.anggota.findMany({
      where: { satminkalId },
      include: {
        pangkat: true,
        korps: true,
        satminkal: { include: { kotama: true } },
      },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    return {
      title: 'DAFTAR ANGGOTA KOPERASI',
      ...headerInfo,
      data: anggota.map((a, i) => {
        const isPati = a.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => a.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
        const korpsDisplay = isPati ? 'TNI' : a.korps.nama;
        const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
        const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

        return {
          no: i + 1,
          id: a.id,
          nama: a.nama,
          pktCrpNrp,
          pangkatKorpsNrp: pktCrpNrp,
          pangkat: formattedPkt,
          pangkatNama: a.pangkat.nama,
          korps: korpsDisplay,
          pangkatObj: a.pangkat,
          korpsObj: a.korps,
          satminkalObj: a.satminkal,
          kategoriPangkat: a.pangkat.kategori,
          nrpNip: a.nrpNip,
          kesatuan: a.satminkal.nama,
          tmtAnggota: a.tmtAnggota ? a.tmtAnggota.toISOString().slice(0, 10) : '-',
          tanggalMasuk: a.tmtAnggota ? a.tmtAnggota.toISOString().slice(0, 10) : '-',
          status: a.isAktif ? 'AKTIF' : 'TIDAK AKTIF',
          isAktif: a.isAktif,
          keterangan: a.isAktif ? 'Anggota Organik Aktif' : 'Non-Aktif',
        };
      }),
    };
  }

  // 2. Brosur Pinjaman (Lampiran III)
  async getBrosurPinjaman() {
    const nominalList = [
      1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 7000000, 8000000,
      9000000, 10000000, 12000000, 15000000, 18000000, 20000000,
    ];
    const tenors = [6, 12, 18, 24, 30, 36];

    const matrix = nominalList.map((nominal) => {
      const row: Record<string, number | string> = {
        nominal,
        plafon: nominal,
      };
      for (const tenor of tenors) {
        const schedule = hitungJadwalAngsuran(nominal, tenor);
        row[`bulan_${tenor}`] = schedule[0]?.total || 0;
        row[`t_${tenor}`] = schedule[0]?.total || 0;
      }
      return row;
    });

    return {
      title: 'BROSUR PINJAMAN PRIMKOP',
      bunga: '12% per tahun (Flat 1% per bulan)',
      sukuBungaTahunan: 12,
      sukuBungaBulanan: 1,
      nominalList,
      tenors,
      matrix,
    };
  }

  // 3. Rekap Simpanan Anggota (Lampiran IV)
  async getRekapSimpanan(user: JwtUser) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId);

    const anggotaList = await this.prisma.anggota.findMany({
      where: { satminkalId, isAktif: true },
      include: { pangkat: true, korps: true, satminkal: true },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    const simpananRows = await this.prisma.simpanan.findMany({
      where: { anggota: { satminkalId } },
      select: { anggotaId: true, jenis: true, tipe: true, nominal: true },
    });

    let totalGlobalPokok = 0;
    let totalGlobalWajib = 0;
    let totalGlobalSukarela = 0;

    const data = anggotaList.map((a, i) => {
      const userSimpanan = simpananRows.filter((s) => s.anggotaId === a.id);

      const calc = (jenisStr: string) =>
        userSimpanan
          .filter((s) => s.jenis === jenisStr)
          .reduce(
            (acc, curr) =>
              curr.tipe === 'SETOR'
                ? acc + toNumber(curr.nominal)
                : acc - toNumber(curr.nominal),
            0,
          );

      const pokok = calc('POKOK');
      const wajib = calc('WAJIB');
      const sukarela = calc('SUKARELA');
      const total = pokok + wajib + sukarela;

      totalGlobalPokok += pokok;
      totalGlobalWajib += wajib;
      totalGlobalSukarela += sukarela;

      const isPati = a.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => a.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
      const korpsDisplay = isPati ? 'TNI' : a.korps.nama;
      const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
      const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

      return {
        no: i + 1,
        anggotaId: a.id,
        id: a.id,
        nama: a.nama,
        nrpNip: a.nrpNip,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        pangkat: formattedPkt,
        pangkatNama: a.pangkat.nama,
        korps: korpsDisplay,
        kategoriPangkat: a.pangkat.kategori,
        kesatuan: a.satminkal.nama,
        pokok,
        simpananPokok: pokok,
        wajib,
        simpananWajib: wajib,
        sukarela,
        simpananSukarela: sukarela,
        total,
        totalSimpanan: total,
      };
    });

    const grandTotal = totalGlobalPokok + totalGlobalWajib + totalGlobalSukarela;

    return {
      title: 'DAFTAR / REKAP SIMPANAN ANGGOTA',
      ...headerInfo,
      summary: {
        totalPokok: totalGlobalPokok,
        totalWajib: totalGlobalWajib,
        totalSukarela: totalGlobalSukarela,
        totalGlobal: grandTotal,
      },
      totalPokok: totalGlobalPokok,
      totalWajib: totalGlobalWajib,
      totalSukarela: totalGlobalSukarela,
      grandTotal,
      data,
    };
  }

  // 4. Data Anggota Meminjam (Lampiran V) - Diurutkan berdasarkan siapa yang meminjam duluan (kronologis)
  async getPinjamanAnggota(user: JwtUser, tahun?: number) {
    const satminkalId = user.satminkalId;
    const targetTahun = tahun || new Date().getFullYear();
    const headerInfo = await this.getKopstukAndTajuk(satminkalId);

    const pinjamanList = await this.prisma.pinjaman.findMany({
      where: {
        anggota: { satminkalId },
        ...(tahun
          ? {
              OR: [
                {
                  tanggalCair: {
                    gte: new Date(`${tahun}-01-01`),
                    lt: new Date(`${tahun + 1}-01-01`),
                  },
                },
                {
                  tanggalAjuan: {
                    gte: new Date(`${tahun}-01-01`),
                    lt: new Date(`${tahun + 1}-01-01`),
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        anggota: {
          include: { pangkat: true, korps: true, satminkal: true },
        },
      },
      orderBy: [
        { tanggalCair: 'asc' },
        { tanggalAjuan: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    let totalPinjaman = 0;
    let totalSisaPokok = 0;

    const data = pinjamanList.map((p, i) => {
      const tglMulai = p.tanggalCair
        ? p.tanggalCair.toISOString().slice(0, 7)
        : '-';
      const tglSelesai = p.tanggalCair
        ? new Date(
            p.tanggalCair.getFullYear(),
            p.tanggalCair.getMonth() + p.tenorBulan,
            1,
          )
            .toISOString()
            .slice(0, 7)
        : '-';

      const nominal = toNumber(p.nominal);
      const sisaPokok =
        p.sisaPokok !== null
          ? toNumber(p.sisaPokok)
          : p.status === StatusPinjaman.LUNAS
            ? 0
            : nominal;

      totalPinjaman += nominal;
      totalSisaPokok += sisaPokok;

      const isPati = p.anggota.pangkat.kategori === 'PATI' || ['Brigjen', 'Mayjen', 'Letjen', 'Jenderal'].some(pat => p.anggota.pangkat.nama.toLowerCase().includes(pat.toLowerCase()));
      const korpsDisplay = isPati ? 'TNI' : p.anggota.korps.nama;
      const pktCrpNrp = formatPktCrpNrpDinas(p.anggota.pangkat.nama, p.anggota.korps.nama, p.anggota.pangkat.kategori, p.anggota.nrpNip);
      const formattedPkt = formatPangkatDinas(p.anggota.pangkat.nama, p.anggota.korps.nama, p.anggota.pangkat.kategori);

      const tglAcuan = p.tanggalCair || p.tanggalAjuan || p.createdAt;
      const yearStr = tglAcuan ? new Date(tglAcuan).getFullYear() : 2026;
      const noPinjamanFormat = `PJ-${yearStr}/${String(i + 1).padStart(3, '0')}`;

      return {
        no: i + 1,
        id: noPinjamanFormat,
        rawId: p.id,
        noPinjaman: noPinjamanFormat,
        nama: p.anggota.nama,
        nrpNip: p.anggota.nrpNip,
        pangkat: formattedPkt,
        korps: korpsDisplay,
        kategoriPangkat: p.anggota.pangkat.kategori,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        kesatuan: p.anggota.satminkal.nama,
        anggota: {
          nama: p.anggota.nama,
          nrpNip: p.anggota.nrpNip,
          pangkat: p.anggota.pangkat,
          korps: p.anggota.korps,
          satminkal: p.anggota.satminkal,
        },
        nominal,
        jumlahPinjaman: nominal,
        tenorBulan: p.tenorBulan,
        jkaWkt: p.tenorBulan,
        jangkaWaktuBulan: p.tenorBulan,
        sisaPokok,
        angsuranMulai: tglMulai,
        angsuranSelesai: tglSelesai,
        tglAkad: p.tanggalCair
          ? p.tanggalCair.toISOString().slice(0, 10)
          : p.tanggalAjuan
            ? p.tanggalAjuan.toISOString().slice(0, 10)
            : '-',
        status: p.status,
        keterangan: p.catatan || p.status,
      };
    });

    return {
      title: `DAFTAR ANGGOTA YANG MEMINJAM KOPERASI TAHUN ${targetTahun}`,
      ...headerInfo,
      tahun: targetTahun,
      totalPinjaman,
      totalSisaPokok,
      data,
    };
  }

  // 5. Resume / Akad Kredit (Lampiran VI)
  async getAkadKredit(user: JwtUser, pinjamanId: string) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId, 'AKAD_KREDIT');

    const pinjaman = await this.prisma.pinjaman.findFirst({
      where: {
        anggota: { satminkalId },
        OR: [{ id: pinjamanId }],
      },
      include: {
        anggota: { include: { pangkat: true, korps: true, satminkal: true } },
        angsuran: { orderBy: { bulanKe: 'asc' } },
      },
    });

    if (!pinjaman) {
      throw new NotFoundException('Data pinjaman tidak ditemukan');
    }

    const nominal = toNumber(pinjaman.nominal);
    const jadwal =
      pinjaman.angsuran.length > 0
        ? pinjaman.angsuran.map((a) => ({
            periode: a.bulanKe,
            bulan: a.jatuhTempo.toISOString().slice(0, 7),
            pokok: toNumber(a.pokok),
            angsuranPokok: toNumber(a.pokok),
            bunga: toNumber(a.bunga),
            angsuranBunga: toNumber(a.bunga),
            angsuranPerBulan: toNumber(a.total),
            sisaPinjaman: 0,
            dibayar: a.dibayar,
            noInvoice: a.noInvoice,
            keterangan: a.dibayar ? 'Lunas' : 'Belum Dibayar',
            paraf: '',
          }))
        : hitungJadwalAngsuran(nominal, pinjaman.tenorBulan).map((j) => ({
            periode: j.bulanKe,
            bulan: `Bulan ke-${j.bulanKe}`,
            pokok: j.pokok,
            angsuranPokok: j.pokok,
            bunga: j.bunga,
            angsuranBunga: j.bunga,
            angsuranPerBulan: j.total,
            sisaPinjaman: 0,
            dibayar: false,
            noInvoice: null,
            keterangan: 'Jadwal',
            paraf: '',
          }));

    const totalPokok = jadwal.reduce((s, r) => s + r.pokok, 0);
    const totalBunga = jadwal.reduce((s, r) => s + r.bunga, 0);
    const totalAngsuran = jadwal.reduce((s, r) => s + r.angsuranPerBulan, 0);

    const pktCrpNrp = formatPktCrpNrpDinas(
      pinjaman.anggota.pangkat.nama,
      pinjaman.anggota.korps.nama,
      pinjaman.anggota.pangkat.kategori,
      pinjaman.anggota.nrpNip,
    );

    return {
      title: 'RESUME / AKAD KREDIT',
      ...headerInfo,
      debitur: {
        nama: pinjaman.anggota.nama,
        pangkatKorpsNrp: pktCrpNrp,
        jabatan: 'Anggota Koperasi',
        kesatuan: pinjaman.anggota.satminkal.nama,
        telpHp: '-',
        alamat: 'Asrama Militer Infolahtadam IV/Diponegoro',
      },
      pinjaman: {
        plafonPinjaman: nominal,
        jangkaWaktuBulan: pinjaman.tenorBulan,
        sukuBungaTahunan: toNumber(pinjaman.bungaPersenTahun),
        sukuBungaBulanan: 1,
        angsuranPerBulan: jadwal[0]?.angsuranPerBulan || 0,
        tanggalPeminjaman: pinjaman.tanggalCair
          ? pinjaman.tanggalCair.toISOString().slice(0, 10)
          : pinjaman.tanggalAjuan.toISOString().slice(0, 10),
      },
      jadwal,
      jadwalAngsuran: jadwal,
      totalPokok,
      totalBunga,
      totalAngsuran,
    };
  }

  // 6. Kwitansi / Invoice (Lampiran VII)
  async getKwitansi(user: JwtUser, angsuranId: string) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId, 'KWITANSI');

    const angsuran = await this.prisma.angsuran.findFirst({
      where: { id: angsuranId, pinjaman: { anggota: { satminkalId } } },
      include: {
        pinjaman: {
          include: {
            anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          },
        },
      },
    });

    if (!angsuran) {
      throw new NotFoundException('Kwitansi angsuran tidak ditemukan');
    }

    const plafon = toNumber(angsuran.pinjaman.nominal);
    const angsuranPerBulan = toNumber(angsuran.total);
    const administrasi = toNumber(angsuran.biayaAdmin);
    const jumlahTagihan = angsuranPerBulan + administrasi;
    const pktCrpNrp = formatPktCrpNrpDinas(
      angsuran.pinjaman.anggota.pangkat.nama,
      angsuran.pinjaman.anggota.korps.nama,
      angsuran.pinjaman.anggota.pangkat.kategori,
      angsuran.pinjaman.anggota.nrpNip,
    );

    return {
      title: 'KWITANSI / INVOICE',
      ...headerInfo,
      tanggalCetak: new Date().toISOString().slice(0, 10),
      debitur: {
        nama: angsuran.pinjaman.anggota.nama,
        pangkatKorpsNrp: pktCrpNrp,
        jabatan: 'Anggota Koperasi',
        kesatuan: angsuran.pinjaman.anggota.satminkal.nama,
        telpHp: '-',
      },
      kwitansi: {
        noKwitansi: angsuran.noInvoice || `KW-${angsuran.id.slice(0, 8).toUpperCase()}`,
        noInvoice: angsuran.noInvoice || `KW-${angsuran.id.slice(0, 8).toUpperCase()}`,
        noTransaksi: angsuran.id,
        nama: angsuran.pinjaman.anggota.nama,
        pangkatKorpsNrp: pktCrpNrp,
        kesatuan: angsuran.pinjaman.anggota.satminkal.nama,
        plafonPinjaman: plafon,
        jangkaWaktu: `${angsuran.pinjaman.tenorBulan} BULAN`,
        angsuranKe: `${angsuran.bulanKe} / ${angsuran.pinjaman.tenorBulan}`,
        jatuhTempo: angsuran.jatuhTempo.toISOString().slice(0, 10),
        tanggalPembayaran: angsuran.tanggalBayar
          ? angsuran.tanggalBayar.toISOString().slice(0, 10)
          : '-',
        pokok: toNumber(angsuran.pokok),
        bunga: toNumber(angsuran.bunga),
        angsuranPerBulan,
        administrasi,
        jumlahTagihan,
        status: angsuran.dibayar ? 'LUNAS' : 'BELUM DIBAYAR',
      },
    };
  }

  // 7. Rekap Kwitansi Bulanan (Lampiran VIII) - Realistis dengan Tanggal Bayar, Pokok, Bunga dan Total Masuk
  async getRekapKwitansiBulanan(user: JwtUser, tahun?: number, bulan?: number) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId);

    const whereClause: any = {
      pinjaman: { anggota: { satminkalId } },
      dibayar: true,
    };

    if (tahun && bulan) {
      const startDate = new Date(Date.UTC(tahun, bulan - 1, 1));
      const endDate = new Date(Date.UTC(tahun, bulan, 1));
      whereClause.tanggalBayar = { gte: startDate, lt: endDate };
    } else if (tahun) {
      const startDate = new Date(Date.UTC(tahun, 0, 1));
      const endDate = new Date(Date.UTC(tahun + 1, 0, 1));
      whereClause.tanggalBayar = { gte: startDate, lt: endDate };
    }

    const angsuranList = await this.prisma.angsuran.findMany({
      where: whereClause,
      include: {
        pinjaman: {
          include: {
            anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          },
        },
      },
      orderBy: [
        { tanggalBayar: 'asc' },
        { jatuhTempo: 'asc' },
      ],
    });

    const data = angsuranList.map((a, i) => {
      let pokok = toNumber(a.pokok);
      let bunga = toNumber(a.bunga);
      let total = toNumber(a.total);
      const nominalPinjaman = toNumber(a.pinjaman.nominal);
      const tenor = a.pinjaman.tenorBulan || 12;

      if ((pokok <= 0 || isNaN(pokok)) && nominalPinjaman > 0 && tenor > 0) {
        pokok = Math.floor(nominalPinjaman / tenor);
      } else if (pokok <= 0 && total > 0) {
        pokok = Math.floor(total * (tenor / (tenor + tenor * 0.01)));
      }

      if ((bunga <= 0 || isNaN(bunga)) && total > pokok) {
        bunga = total - pokok;
      } else if ((bunga <= 0 || isNaN(bunga)) && nominalPinjaman > 0) {
        bunga = Math.floor(nominalPinjaman * 0.01);
      }

      if (total <= 0 || isNaN(total)) {
        total = pokok + bunga;
      }

      const noKwitansi =
        a.noInvoice ||
        `KW-${new Date(a.tanggalBayar || a.jatuhTempo || new Date()).getFullYear()}-${String(i + 1).padStart(4, '0')}`;

      const pktCrpNrp = formatPktCrpNrpDinas(
        a.pinjaman.anggota.pangkat.nama,
        a.pinjaman.anggota.korps.nama,
        a.pinjaman.anggota.pangkat.kategori,
        a.pinjaman.anggota.nrpNip,
      );
      const formattedPkt = formatPangkatDinas(
        a.pinjaman.anggota.pangkat.nama,
        a.pinjaman.anggota.korps.nama,
        a.pinjaman.anggota.pangkat.kategori,
      );

      // Pastikan tanggal bayar nyata & valid
      const tglBayarObj = a.tanggalBayar || a.jatuhTempo || new Date();
      const formattedTglBayar = tglBayarObj
        ? new Date(tglBayarObj).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return {
        no: i + 1,
        id: a.id,
        noKwitansi,
        noInvoice: noKwitansi,
        noTrans: a.pinjamanId,
        pinjamanId: a.pinjamanId,
        nama: a.pinjaman.anggota.nama,
        nrpNip: a.pinjaman.anggota.nrpNip,
        pangkat: formattedPkt,
        korps:
          a.pinjaman.anggota.pangkat.kategori === 'PATI'
            ? 'TNI'
            : a.pinjaman.anggota.korps.nama,
        kategoriPangkat: a.pinjaman.anggota.pangkat.kategori,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        kesatuan: a.pinjaman.anggota.satminkal.nama,
        jumlahPinjaman: nominalPinjaman,
        nominalPinjaman,
        pokok,
        angsuranPokok: pokok,
        bunga,
        jasa: bunga,
        jasaUsaha: bunga,
        biayaAdmin: toNumber(a.biayaAdmin),
        total,
        jumlahAngsuran: total,
        totalDiterima: total,
        angsuranKeDari: `${a.bulanKe}/${a.pinjaman.tenorBulan}`,
        bulanKe: a.bulanKe,
        tenorBulan: a.pinjaman.tenorBulan,
        jatuhTempo: a.jatuhTempo.toISOString().slice(0, 10),
        tanggalBayar: formattedTglBayar,
        tglBayar: formattedTglBayar,
        tanggalPembayaran: formattedTglBayar,
      };
    });

    const totalPokok = data.reduce((acc, curr) => acc + curr.pokok, 0);
    const totalBunga = data.reduce((acc, curr) => acc + curr.bunga, 0);
    const totalAngsuran = data.reduce((acc, curr) => acc + curr.total, 0);

    return {
      title:
        tahun && bulan
          ? `DAFTAR KWITANSI BULAN ${bulan} TAHUN ${tahun}`
          : `REKAPITULASI PENERIMAAN KWITANSI & INVOICE ANGSURAN`,
      ...headerInfo,
      tahun: tahun || new Date().getFullYear(),
      bulan: bulan || new Date().getMonth() + 1,
      namaBulan: bulan ? `Bulan ${bulan}` : 'Semua Periode',
      totalPokok,
      totalBunga,
      totalJumlahAngsuran: totalAngsuran,
      totalJumlah: totalAngsuran,
      data,
    };
  }

  // 8. SHU Anggota (Lampiran IX)
  async getShuAnggota(user: JwtUser, tahun: number) {
    const satminkalId = user.satminkalId;
    const headerInfo = await this.getKopstukAndTajuk(satminkalId, 'LAPORAN_SHU');

    const periodeShu = await this.prisma.periodeShu.findUnique({
      where: { tahun },
      include: {
        shuAnggota: {
          where: { anggota: { satminkalId } },
          include: {
            anggota: { include: { pangkat: true, korps: true, satminkal: true } },
          },
          orderBy: [
            { anggota: { pangkat: { kodePkt: 'desc' } } },
            { anggota: { nama: 'asc' } },
          ],
        },
      },
    });

    if (periodeShu && periodeShu.shuAnggota.length > 0) {
      const data = periodeShu.shuAnggota.map((s, i) => {
        const jasaModal = toNumber(s.jasaModal);
        const jasaUsaha = toNumber(s.jasaUsaha);
        const totalShu = toNumber(s.total);

        const pktCrpNrp = formatPktCrpNrpDinas(
          s.anggota.pangkat.nama,
          s.anggota.korps.nama,
          s.anggota.pangkat.kategori,
          s.anggota.nrpNip,
        );
        const formattedPkt = formatPangkatDinas(
          s.anggota.pangkat.nama,
          s.anggota.korps.nama,
          s.anggota.pangkat.kategori,
        );

        return {
          no: i + 1,
          id: s.id,
          anggotaId: s.anggotaId,
          nama: s.anggota.nama,
          nrpNip: s.anggota.nrpNip,
          pangkat: formattedPkt,
          korps: s.anggota.pangkat.kategori === 'PATI' ? 'TNI' : s.anggota.korps.nama,
          kategoriPangkat: s.anggota.pangkat.kategori,
          pktCrpNrp,
          pangkatKorpsNrp: pktCrpNrp,
          kesatuan: s.anggota.satminkal?.nama || 'INFOLAHTADAM IV/DIPONEGORO',
          jasaModal,
          jasaUsaha,
          totalShu,
          total: totalShu,
        };
      });

      return {
        title: `LAPORAN SHU ANGGOTA KOPERASI TAHUN ${tahun}`,
        ...headerInfo,
        ringkasanShu: {
          tahun: periodeShu.tahun,
          totalPendapatan: toNumber(periodeShu.totalPendapatan),
          totalBeban: toNumber(periodeShu.totalBeban),
          shuBersih: toNumber(periodeShu.shuBersih),
          cadangan: toNumber(periodeShu.cadangan),
          jasaModal: toNumber(periodeShu.jasaModal),
          jasaUsaha: toNumber(periodeShu.jasaUsaha),
          pengurus: toNumber(periodeShu.pengurus),
          sosialPendidikan: toNumber(periodeShu.sosialPendidikan),
        },
        data,
      };
    }

    // Fallback perhitungan langsung dari database jika tabel PeriodeShu belum digenerate
    const aggregatePendapatan = await this.prisma.pendapatan.aggregate({
      where: { satminkalId, tahun },
      _sum: { nominal: true },
    });
    const aggregateBiaya = await this.prisma.biayaOperasional.aggregate({
      where: { tahun },
      _sum: { nominal: true },
    });

    const totalPendapatan = Number(aggregatePendapatan._sum?.nominal ?? 70000000);
    const totalBeban = Number(aggregateBiaya._sum?.nominal ?? 20000000);
    const shuBersih = Math.max(0, totalPendapatan - totalBeban);

    const alokasiJasaModal = (shuBersih * 20) / 100;
    const alokasiJasaUsaha = (shuBersih * 30) / 100;

    const anggotaList = await this.prisma.anggota.findMany({
      where: { satminkalId, isAktif: true },
      include: {
        pangkat: true,
        korps: true,
        satminkal: true,
        simpanan: true,
        pinjaman: {
          include: {
            angsuran: { where: { dibayar: true } },
          },
        },
      },
      orderBy: [
        { pangkat: { kodePkt: 'desc' } },
        { nama: 'asc' },
      ],
    });

    const simpananAgg = await this.prisma.simpanan.aggregate({
      where: { anggota: { satminkalId }, tipe: 'SETOR' },
      _sum: { nominal: true },
    });
    const angsuranAgg = await this.prisma.angsuran.aggregate({
      where: { pinjaman: { anggota: { satminkalId } }, dibayar: true },
      _sum: { bunga: true },
    });

    const totalSimpananSatminkal = Number(simpananAgg._sum?.nominal ?? 0) || 1;
    const totalBungaPinjamanSatminkal = Number(angsuranAgg._sum?.bunga ?? 0) || 1;

    const data = anggotaList.map((a, i) => {
      const totalSimpananAnggota = a.simpanan.reduce((acc, curr) => {
        const nom = Number(curr.nominal);
        return curr.tipe === 'TARIK' ? acc - nom : acc + nom;
      }, 0);

      const totalBungaAnggota = a.pinjaman.reduce(
        (accPinjaman, currPinjaman) =>
          accPinjaman +
          currPinjaman.angsuran.reduce(
            (accAngsuran, currAngsuran) =>
              accAngsuran + Number(currAngsuran.bunga),
            0,
          ),
        0,
      );

      const jasaModal =
        (Math.max(0, totalSimpananAnggota) / totalSimpananSatminkal) *
        alokasiJasaModal;
      const jasaUsaha =
        (totalBungaAnggota / totalBungaPinjamanSatminkal) * alokasiJasaUsaha;
      const totalShu = jasaModal + jasaUsaha;

      const pktCrpNrp = formatPktCrpNrpDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori, a.nrpNip);
      const formattedPkt = formatPangkatDinas(a.pangkat.nama, a.korps.nama, a.pangkat.kategori);

      return {
        no: i + 1,
        id: a.id,
        anggotaId: a.id,
        nama: a.nama,
        nrpNip: a.nrpNip,
        pangkat: formattedPkt,
        korps: a.pangkat.kategori === 'PATI' ? 'TNI' : a.korps.nama,
        kategoriPangkat: a.pangkat.kategori,
        pktCrpNrp,
        pangkatKorpsNrp: pktCrpNrp,
        kesatuan: a.satminkal.nama,
        jasaModal: Math.round(jasaModal),
        jasaUsaha: Math.round(jasaUsaha),
        totalShu: Math.round(totalShu),
        total: Math.round(totalShu),
      };
    });

    return {
      title: `LAPORAN SHU ANGGOTA KOPERASI TAHUN ${tahun}`,
      ...headerInfo,
      ringkasanShu: {
        tahun,
        totalPendapatan,
        totalBeban,
        shuBersih,
        cadangan: (shuBersih * 25) / 100,
        jasaModal: alokasiJasaModal,
        jasaUsaha: alokasiJasaUsaha,
        pengurus: (shuBersih * 15) / 100,
        sosialPendidikan: (shuBersih * 10) / 100,
      },
      data,
    };
  }
}
