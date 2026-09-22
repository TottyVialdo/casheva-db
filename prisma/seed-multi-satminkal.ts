import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import {
  JenisPendapatan,
  JenisBiayaOperasional,
  JenisSimpanan,
  JenisTransaksiSimpanan,
  KategoriPangkat,
  PrismaClient,
  Role,
  StatusPinjaman,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { decimal } from '../src/common/utils/decimal.util';
import { hitungJadwalAngsuran } from '../src/common/utils/pinjaman-calculator';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL wajib di-set');
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log('🌱 Starting Multi-Satminkal RBAC Seeding...');

  const defaultPasswordHash = await bcrypt.hash('Admin123!', 10);

  // 1. KOTAMA & BALAKPUS DEFINITIONS
  const kotamaDefs = [
    { kode: '07', nama: 'KODAM IV/DIPONEGORO', tipe: 'KOTAMA' },
    { kode: '08', nama: 'KODAM V/BRAWIJAYA', tipe: 'KOTAMA' },
    { kode: '25', nama: 'KOPASSUS', tipe: 'KOTAMA' },
    { kode: '38', nama: 'PUSKOMLEKAD', tipe: 'BALAKPUS' },
  ];

  const kotamaMap = new Map<string, any>();
  for (const kd of kotamaDefs) {
    const k = await prisma.kotama.upsert({
      where: { kode: kd.kode },
      create: { kode: kd.kode, nama: kd.nama, tipe: kd.tipe, status: true },
      update: { nama: kd.nama, tipe: kd.tipe, status: true },
    });
    kotamaMap.set(kd.kode, k);
  }
  console.log(`✅ ${kotamaMap.size} Kotama / Balakpus disiapkan.`);

  // 2. SUPER ADMIN & ADMIN KOTAMA ACCOUNTS
  // Super Admin
  await prisma.user.upsert({
    where: { username: 'superadmin' },
    create: {
      username: 'superadmin',
      password: defaultPasswordHash,
      namaLengkap: 'Super Administrator TNI AD',
      role: Role.SUPER_ADMIN,
      kotamaId: null,
      satminkalId: null,
      isActive: true,
    },
    update: {
      password: defaultPasswordHash,
      namaLengkap: 'Super Administrator TNI AD',
      role: Role.SUPER_ADMIN,
      kotamaId: null,
      satminkalId: null,
      isActive: true,
    },
  });

  // Admin Kotama IV/Dip
  await prisma.user.upsert({
    where: { username: 'admin_kodam4' },
    create: {
      username: 'admin_kodam4',
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Inf Suryo (Admin Kodam IV/Dip)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('07').id,
      satminkalId: null,
      isActive: true,
    },
    update: {
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Inf Suryo (Admin Kodam IV/Dip)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('07').id,
      satminkalId: null,
      isActive: true,
    },
  });

  // Admin Kotama V/Brw
  await prisma.user.upsert({
    where: { username: 'admin_kodam5' },
    create: {
      username: 'admin_kodam5',
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Cba Joko (Admin Kodam V/Brw)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('08').id,
      satminkalId: null,
      isActive: true,
    },
    update: {
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Cba Joko (Admin Kodam V/Brw)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('08').id,
      satminkalId: null,
      isActive: true,
    },
  });

  // Admin Kopassus
  await prisma.user.upsert({
    where: { username: 'admin_kopassus' },
    create: {
      username: 'admin_kopassus',
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Inf Bayu (Admin Kopassus)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('25').id,
      satminkalId: null,
      isActive: true,
    },
    update: {
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Inf Bayu (Admin Kopassus)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('25').id,
      satminkalId: null,
      isActive: true,
    },
  });

  // Admin Puskomlekad
  await prisma.user.upsert({
    where: { username: 'admin_puskomlekad' },
    create: {
      username: 'admin_puskomlekad',
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Cke Yudi (Admin Puskomlekad)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('38').id,
      satminkalId: null,
      isActive: true,
    },
    update: {
      password: defaultPasswordHash,
      namaLengkap: 'Kolonel Cke Yudi (Admin Puskomlekad)',
      role: Role.ADMIN_KOTAMA,
      kotamaId: kotamaMap.get('38').id,
      satminkalId: null,
      isActive: true,
    },
  });

  console.log('✅ Akun Super Admin & 4 Admin Kotama/Balakpus disiapkan.');

  // Fetch Master Pangkat & Korps
  const patiPangkat = await prisma.pangkat.findFirst({ where: { kategori: KategoriPangkat.PATI } });
  const pamenPangkat = await prisma.pangkat.findFirst({ where: { kategori: KategoriPangkat.PAMEN } });
  const pamaPangkat = await prisma.pangkat.findFirst({ where: { kategori: KategoriPangkat.PAMA } });
  const bintaraPangkat = await prisma.pangkat.findFirst({ where: { kategori: KategoriPangkat.BINTARA } });
  const pnsPangkat = await prisma.pangkat.findFirst({ where: { kategori: KategoriPangkat.PNS } });

  const infKorps = (await prisma.korps.findFirst({ where: { kode: '1' } })) || (await prisma.korps.findFirst());
  const cbaKorps = (await prisma.korps.findFirst({ where: { kode: 'G' } })) || infKorps;
  const ckeKorps = (await prisma.korps.findFirst({ where: { kode: 'N' } })) || infKorps;
  const ckuKorps = (await prisma.korps.findFirst({ where: { kode: 'Q' } })) || infKorps;
  const cziKorps = (await prisma.korps.findFirst({ where: { kode: '2' } })) || infKorps;
  const cpmKorps = (await prisma.korps.findFirst({ where: { kode: '6' } })) || infKorps;
  const cplKorps = (await prisma.korps.findFirst({ where: { kode: '9' } })) || infKorps;
  const cajKorps = (await prisma.korps.findFirst({ where: { kode: 'J' } })) || infKorps;

  if (!patiPangkat || !pamenPangkat || !pamaPangkat || !bintaraPangkat || !pnsPangkat || !infKorps) {
    throw new Error('Master Pangkat / Korps tidak lengkap di database.');
  }

  // 3. SATMINKAL DEFINITIONS LIST
  const satminkalList = [
    // --- KODAM IV/DIP ---
    {
      kode: '685600',
      nama: 'INFOLAHTADAM IV/DIPONEGORO',
      slug: 'infolahta',
      kotamaKode: '07',
      isExisting: true,
      satuanLengkap: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
      balakLengkap: 'INFORMASI DAN PENGOLAHAN DATA',
      alamat: 'Jl. Perintis Kemerdekaan, Watugong, Semarang',
      telepon: '024-7472249',
    },
    {
      kode: '685610',
      nama: 'TOPDAM IV/DIPONEGORO',
      slug: 'topdam',
      kotamaKode: '07',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
      balakLengkap: 'TOPOGRAFI DAERAH MILITER',
      alamat: 'Jl. Dr. Wahidin No. 45, Semarang',
      telepon: '024-8311223',
    },
    {
      kode: '685620',
      nama: 'KUDAM IV/DIPONEGORO',
      slug: 'kudam',
      kotamaKode: '07',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
      balakLengkap: 'KEUANGAN DAERAH MILITER',
      alamat: 'Jl. Pemuda No. 12, Semarang',
      telepon: '024-3544567',
    },
    {
      kode: '344238',
      nama: 'KESDAM IV/DIPONEGORO',
      slug: 'kesdam',
      kotamaKode: '07',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER IV/DIPONEGORO',
      balakLengkap: 'KESEHATAN DAERAH MILITER',
      alamat: 'Jl. HOS Cokroaminoto No. 8, Semarang',
      telepon: '024-3512345',
    },

    // --- KODAM V/BRW ---
    {
      kode: '344235',
      nama: 'BEKANGDAM V/BRAWIJAYA',
      slug: 'bekangdam',
      kotamaKode: '08',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER V/BRAWIJAYA',
      balakLengkap: 'PERBEKALAN DAN ANGKUTAN DAERAH MILITER',
      alamat: 'Jl. Hayam Wuruk No. 6, Surabaya',
      telepon: '031-5678901',
    },
    {
      kode: '344236',
      nama: 'PALDAM V/BRAWIJAYA',
      slug: 'paldam',
      kotamaKode: '08',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER V/BRAWIJAYA',
      balakLengkap: 'PERALATAN DAERAH MILITER',
      alamat: 'Jl. Raden Wijaya No. 1, Surabaya',
      telepon: '031-5689012',
    },
    {
      kode: '344239',
      nama: 'POMDAM V/BRAWIJAYA',
      slug: 'pomdam',
      kotamaKode: '08',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER V/BRAWIJAYA',
      balakLengkap: 'POLISI MILITER DAERAH MILITER',
      alamat: 'Jl. Kesatrian No. 4, Surabaya',
      telepon: '031-5690123',
    },
    {
      kode: '344240',
      nama: 'AJENDAM V/BRAWIJAYA',
      slug: 'ajendam',
      kotamaKode: '08',
      isExisting: false,
      satuanLengkap: 'KOMANDO DAERAH MILITER V/BRAWIJAYA',
      balakLengkap: 'AJUDAN JENDERAL DAERAH MILITER',
      alamat: 'Jl. Mayjen Sungkono No. 10, Surabaya',
      telepon: '031-5671234',
    },

    // --- KOPASSUS ---
    {
      kode: '250001',
      nama: 'MAKOPASSUS',
      slug: 'makopassus',
      kotamaKode: '25',
      isExisting: false,
      satuanLengkap: 'KOMANDO PASUKAN KHUSUS',
      balakLengkap: 'MARKAS KOMANDO PASUKAN KHUSUS',
      alamat: 'Cijantung, Jakarta Timur',
      telepon: '021-8710001',
    },
    {
      kode: '250002',
      nama: 'PUSDIKLATPASSUS',
      slug: 'pusdiklatpassus',
      kotamaKode: '25',
      isExisting: false,
      satuanLengkap: 'KOMANDO PASUKAN KHUSUS',
      balakLengkap: 'PUSAT PENDIDIKAN DAN LATIHAN PASUKAN KHUSUS',
      alamat: 'Batujajar, Bandung Barat',
      telepon: '022-6860002',
    },
    {
      kode: '250013',
      nama: 'BATALYON 13 KOPASSUS',
      slug: 'yon13',
      kotamaKode: '25',
      isExisting: false,
      satuanLengkap: 'KOMANDO PASUKAN KHUSUS',
      balakLengkap: 'BATALYON 13 GRUP 1 KOPASSUS',
      alamat: 'Serang, Banten',
      telepon: '0254-200013',
    },
    {
      kode: '250021',
      nama: 'BATALYON 21 KOPASSUS',
      slug: 'yon21',
      kotamaKode: '25',
      isExisting: false,
      satuanLengkap: 'KOMANDO PASUKAN KHUSUS',
      balakLengkap: 'BATALYON 21 GRUP 2 KOPASSUS',
      alamat: 'Kandang Menjangan, Kartasura, Sukoharjo',
      telepon: '0271-780021',
    },

    // --- PUSKOMLEKAD ---
    {
      kode: '380001',
      nama: 'PUSDIKKOMLEK',
      slug: 'pusdikkomlek',
      kotamaKode: '38',
      isExisting: false,
      satuanLengkap: 'PUSAT KOMUNIKASI DAN ELEKTRONIKA TNI AD',
      balakLengkap: 'PUSAT PENDIDIKAN KOMLEK',
      alamat: 'Cimahi, Jawa Barat',
      telepon: '022-6650001',
    },
    {
      kode: '380002',
      nama: 'YONKOMLEK',
      slug: 'yonkomlek',
      kotamaKode: '38',
      isExisting: false,
      satuanLengkap: 'PUSAT KOMUNIKASI DAN ELEKTRONIKA TNI AD',
      balakLengkap: 'BATALYON KOMUNIKASI DAN ELEKTRONIKA',
      alamat: 'Cijantung, Jakarta Timur',
      telepon: '021-8710038',
    },
    {
      kode: '380003',
      nama: 'GUDPUSKOMLEK',
      slug: 'gudpuskomlek',
      kotamaKode: '38',
      isExisting: false,
      satuanLengkap: 'PUSAT KOMUNIKASI DAN ELEKTRONIKA TNI AD',
      balakLengkap: 'GUDANG PUSAT MATERIIL KOMLEK',
      alamat: 'Cimahi, Jawa Barat',
      telepon: '022-6650003',
    },
    {
      kode: '380004',
      nama: 'BENGPUSKOMLEK',
      slug: 'bengpuskomlek',
      kotamaKode: '38',
      isExisting: false,
      satuanLengkap: 'PUSAT KOMUNIKASI DAN ELEKTRONIKA TNI AD',
      balakLengkap: 'BENGKEL PUSAT PEMELIHARAAN KOMLEK',
      alamat: 'Bandung, Jawa Barat',
      telepon: '022-7300004',
    },
  ];

  // Base member template generator for 20 anggota
  const generate20AnggotaDefs = (satminkalCodePrefix: string, satminkalSlug: string) => [
    // 2 PATI
    { nama: `Hadi Tjahjanto (${satminkalSlug.toUpperCase()})`, nrp: `${satminkalCodePrefix}01`, pkt: patiPangkat.id, crp: infKorps.id },
    { nama: `TNI Andika Perkasa (${satminkalSlug.toUpperCase()})`, nrp: `${satminkalCodePrefix}02`, pkt: patiPangkat.id, crp: infKorps.id },

    // 5 PAMEN
    { nama: `Letkol Cba Wahyu Santoso`, nrp: `${satminkalCodePrefix}03`, pkt: pamenPangkat.id, crp: cbaKorps!.id },
    { nama: `Kolonel Cke Arif Budiman`, nrp: `${satminkalCodePrefix}04`, pkt: pamenPangkat.id, crp: ckeKorps!.id },
    { nama: `Mayor Cku Teguh Prasetya`, nrp: `${satminkalCodePrefix}05`, pkt: pamenPangkat.id, crp: ckuKorps!.id },
    { nama: `Letkol Czi Bambang Irawan`, nrp: `${satminkalCodePrefix}06`, pkt: pamenPangkat.id, crp: cziKorps!.id },
    { nama: `Mayor Cpm Hendro Siswanto`, nrp: `${satminkalCodePrefix}07`, pkt: pamenPangkat.id, crp: cpmKorps!.id },

    // 5 PAMA
    { nama: `Kapten Inf Danu Setiawan`, nrp: `${satminkalCodePrefix}08`, pkt: pamaPangkat.id, crp: infKorps.id },
    { nama: `Lettu Cpl Fajar Pratama`, nrp: `${satminkalCodePrefix}09`, pkt: pamaPangkat.id, crp: cplKorps!.id },
    { nama: `Letda Caj Gilang Gumelar`, nrp: `${satminkalCodePrefix}10`, pkt: pamaPangkat.id, crp: cajKorps!.id },
    { nama: `Kapten Cku Haryono`, nrp: `${satminkalCodePrefix}11`, pkt: pamaPangkat.id, crp: ckuKorps!.id },
    { nama: `Lettu Cke Indra Kusuma`, nrp: `${satminkalCodePrefix}12`, pkt: pamaPangkat.id, crp: ckeKorps!.id },

    // 5 BINTARA
    { nama: `Serma Joko Purnomo`, nrp: `${satminkalCodePrefix}13`, pkt: bintaraPangkat.id, crp: infKorps.id },
    { nama: `Serka Kusnadi`, nrp: `${satminkalCodePrefix}14`, pkt: bintaraPangkat.id, crp: infKorps.id },
    { nama: `Sertu Lukman Hakim`, nrp: `${satminkalCodePrefix}15`, pkt: bintaraPangkat.id, crp: infKorps.id },
    { nama: `Serda Mulyadi`, nrp: `${satminkalCodePrefix}16`, pkt: bintaraPangkat.id, crp: infKorps.id },
    { nama: `Peltu Nurdin Hidayat`, nrp: `${satminkalCodePrefix}17`, pkt: bintaraPangkat.id, crp: infKorps.id },

    // 3 PNS
    { nama: `PNS IV/a Oktaviani, S.E.`, nrp: `${satminkalCodePrefix}18`, pkt: pnsPangkat.id, crp: infKorps.id },
    { nama: `PNS III/d Putri Rahmadani`, nrp: `${satminkalCodePrefix}19`, pkt: pnsPangkat.id, crp: infKorps.id },
    { nama: `PNS III/a Qoriatul Aini`, nrp: `${satminkalCodePrefix}20`, pkt: pnsPangkat.id, crp: infKorps.id },
  ];

  // LOOP OVER ALL SATMINKALS
  for (let sIdx = 0; sIdx < satminkalList.length; sIdx++) {
    const sDef = satminkalList[sIdx];
    const kotamaObj = kotamaMap.get(sDef.kotamaKode);

    console.log(`\n🏢 Processing Satminkal [${sDef.kode}] ${sDef.nama}...`);

    // 1. Upsert Satminkal
    const satminkal = await prisma.satminkal.upsert({
      where: { kode: sDef.kode },
      create: {
        kode: sDef.kode,
        nama: sDef.nama,
        kotamaId: kotamaObj.id,
        status: true,
      },
      update: {
        nama: sDef.nama,
        kotamaId: kotamaObj.id,
        status: true,
      },
    });

    // 2. Kopstuk
    await prisma.kopstuk.upsert({
      where: { satminkalId: satminkal.id },
      create: {
        satminkalId: satminkal.id,
        namaSatuan: sDef.satuanLengkap,
        namaBalak: sDef.balakLengkap,
        alamat: sDef.alamat,
        nomorTelepon: sDef.telepon,
      },
      update: {
        namaSatuan: sDef.satuanLengkap,
        namaBalak: sDef.balakLengkap,
        alamat: sDef.alamat,
        nomorTelepon: sDef.telepon,
      },
    });

    // 3. Officers / Pengurus Accounts
    // For Infolahtadam (existing), keep 'admin', 'pimpinan', etc. and also support slug alias
    const officerPrefix = sDef.isExisting ? '' : `_${sDef.slug}`;
    const officersToCreate = [
      {
        username: sDef.isExisting ? 'admin' : `admin_${sDef.slug}`,
        role: Role.ADMIN_KOPERASI,
        nama: `Admin Koperasi (${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'pimpinan' : `pimpinan_${sDef.slug}`,
        role: Role.PIMPINAN,
        nama: `Kolonel Inf Heru (Dan/Ka ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'keprim' : `keprim_${sDef.slug}`,
        role: Role.KEPRIM,
        nama: `Letkol Cba Dedi Kurnia (Keprim ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'bendahara' : `bendahara_${sDef.slug}`,
        role: Role.BENDAHARA,
        nama: `Lettu Cku Budi (Bendahara ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'pengawas' : `pengawas_${sDef.slug}`,
        role: Role.PENGAWAS,
        nama: `Mayor Inf Tri (Pengawas ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'jurubayar' : `jurubayar_${sDef.slug}`,
        role: Role.JURU_BAYAR,
        nama: `Serma Agus (Juru Bayar ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'kasir' : `kasir_${sDef.slug}`,
        role: Role.KASIR_TOKO,
        nama: `Kopda Hendra Setiawan (Kasir ${sDef.slug.toUpperCase()})`,
      },
      {
        username: sDef.isExisting ? 'gadai' : `gadai_${sDef.slug}`,
        role: Role.PETUGAS_GADAI,
        nama: `Sertu Bambang (Petugas Gadai ${sDef.slug.toUpperCase()})`,
      },
    ];

    for (const off of officersToCreate) {
      await prisma.user.upsert({
        where: { username: off.username },
        create: {
          username: off.username,
          password: defaultPasswordHash,
          namaLengkap: off.nama,
          role: off.role,
          kotamaId: kotamaObj.id,
          satminkalId: satminkal.id,
          isActive: true,
        },
        update: {
          password: defaultPasswordHash,
          namaLengkap: off.nama,
          role: off.role,
          kotamaId: kotamaObj.id,
          satminkalId: satminkal.id,
          isActive: true,
        },
      });
    }

    // 4. Seed 20 Anggota per Satminkal
    const prefixNum = String(40 + sIdx * 10).padStart(3, '0');
    const memberDefs = generate20AnggotaDefs(prefixNum, sDef.slug);
    const createdMembers: any[] = [];

    for (const mDef of memberDefs) {
      const existingAnggota = await prisma.anggota.findFirst({
        where: { nrpNip: mDef.nrp },
      });

      let anggotaRow: any;
      if (!existingAnggota) {
        anggotaRow = await prisma.anggota.create({
          data: {
            nama: mDef.nama,
            nrpNip: mDef.nrp,
            pangkatId: mDef.pkt,
            korpsId: mDef.crp,
            satminkalId: satminkal.id,
            isAktif: true,
            tmtAnggota: new Date('2024-01-01'),
          },
          include: { pangkat: true },
        });
      } else {
        anggotaRow = await prisma.anggota.update({
          where: { id: existingAnggota.id },
          data: {
            nama: mDef.nama,
            satminkalId: satminkal.id,
            pangkatId: mDef.pkt,
            korpsId: mDef.crp,
            isAktif: true,
          },
          include: { pangkat: true },
        });
      }
      createdMembers.push(anggotaRow);

      // Create Login User account for this Anggota
      await prisma.user.upsert({
        where: { username: mDef.nrp },
        create: {
          username: mDef.nrp,
          password: defaultPasswordHash,
          namaLengkap: mDef.nama.trim(),
          role: Role.ANGGOTA,
          kotamaId: kotamaObj.id,
          satminkalId: satminkal.id,
          isActive: true,
        },
        update: {
          namaLengkap: mDef.nama.trim(),
          password: defaultPasswordHash,
          role: Role.ANGGOTA,
          kotamaId: kotamaObj.id,
          satminkalId: satminkal.id,
          isActive: true,
        },
      });
    }

    // 5. Simpanan Pokok & Wajib for all 20 Members
    for (const a of createdMembers) {
      const countP = await prisma.simpanan.count({
        where: { anggotaId: a.id, jenis: JenisSimpanan.POKOK },
      });
      if (countP === 0) {
        await prisma.simpanan.create({
          data: {
            anggotaId: a.id,
            jenis: JenisSimpanan.POKOK,
            tipe: JenisTransaksiSimpanan.SETOR,
            nominal: decimal(50000),
            periode: new Date('2024-01-01'),
            keterangan: 'Simpanan pokok awal',
          },
        });
      }

      const countW = await prisma.simpanan.count({
        where: { anggotaId: a.id, jenis: JenisSimpanan.WAJIB },
      });
      if (countW === 0) {
        await prisma.simpanan.create({
          data: {
            anggotaId: a.id,
            jenis: JenisSimpanan.WAJIB,
            tipe: JenisTransaksiSimpanan.SETOR,
            nominal: decimal(100000),
            periode: new Date('2024-01-01'),
            keterangan: 'Simpanan wajib awal',
          },
        });
      }
    }

    // 6. Simpanan Sukarela Bulanan (2024 to 2026)
    const existingSukarela = await prisma.simpanan.count({
      where: { anggota: { satminkalId: satminkal.id }, jenis: JenisSimpanan.SUKARELA },
    });
    if (existingSukarela === 0) {
      const sukarelaEntries: any[] = [];
      for (let y = 2024; y <= 2026; y++) {
        const mEnd = y === 2026 ? 5 : 11;
        for (let m = 0; m <= mEnd; m++) {
          const periodeTgl = new Date(Date.UTC(y, m, 5));
          for (const a of createdMembers) {
            let nominalSukarela = 150000;
            if (a.pangkat?.kategori === KategoriPangkat.PATI) nominalSukarela = 500000;
            else if (a.pangkat?.kategori === KategoriPangkat.PAMEN) nominalSukarela = 300000;
            else if (a.pangkat?.kategori === KategoriPangkat.PAMA) nominalSukarela = 250000;
            else if (a.pangkat?.kategori === KategoriPangkat.BINTARA) nominalSukarela = 150000;
            else if (a.pangkat?.kategori === KategoriPangkat.PNS) nominalSukarela = 100000;

            sukarelaEntries.push({
              anggotaId: a.id,
              jenis: JenisSimpanan.SUKARELA,
              tipe: JenisTransaksiSimpanan.SETOR,
              nominal: decimal(nominalSukarela),
              periode: periodeTgl,
              createdAt: periodeTgl,
              keterangan: `Potong sukarela ${y}-${String(m + 1).padStart(2, '0')}`,
            });
          }
        }
      }
      if (sukarelaEntries.length > 0) {
        await prisma.simpanan.createMany({ data: sukarelaEntries });
      }
    }

    // 7. Pinjaman & Angsuran Sample
    const existingLoans = await prisma.pinjaman.count({
      where: { anggota: { satminkalId: satminkal.id } },
    });
    if (existingLoans === 0) {
      const loanConfigs = [
        { idx: 0, nominal: 20000000, tenor: 36, status: StatusPinjaman.DICAIRKAN, paid: 12 },
        { idx: 1, nominal: 15000000, tenor: 24, status: StatusPinjaman.DICAIRKAN, paid: 6 },
        { idx: 2, nominal: 10000000, tenor: 12, status: StatusPinjaman.DICAIRKAN, paid: 4 },
        { idx: 3, nominal: 8000000, tenor: 10, status: StatusPinjaman.LUNAS, paid: 10 },
        { idx: 4, nominal: 5000000, tenor: 6, status: StatusPinjaman.DICAIRKAN, paid: 2 },
        { idx: 5, nominal: 12000000, tenor: 24, status: StatusPinjaman.SETUJU_KEPRIM, paid: 0 },
        { idx: 6, nominal: 7000000, tenor: 12, status: StatusPinjaman.REKOMENDASI_PIMPINAN, paid: 0 },
        { idx: 7, nominal: 4000000, tenor: 6, status: StatusPinjaman.VERIFIKASI_JURU_BAYAR, paid: 0 },
        { idx: 8, nominal: 3000000, tenor: 6, status: StatusPinjaman.VERIFIKASI_PRIMKOP, paid: 0 },
        { idx: 9, nominal: 2000000, tenor: 6, status: StatusPinjaman.DIAJUKAN, paid: 0 },
      ];

      for (let lIdx = 0; lIdx < loanConfigs.length; lIdx++) {
        const cfg = loanConfigs[lIdx];
        const targetAnggota = createdMembers[cfg.idx];
        if (!targetAnggota) continue;

        const isCair = cfg.status === StatusPinjaman.DICAIRKAN || cfg.status === StatusPinjaman.LUNAS;
        const tglCair = isCair ? new Date('2025-01-10') : null;
        const sisaPokok = cfg.status === StatusPinjaman.LUNAS ? 0 : cfg.nominal - cfg.paid * (cfg.nominal / cfg.tenor);

        const p = await prisma.pinjaman.create({
          data: {
            anggotaId: targetAnggota.id,
            nominal: decimal(cfg.nominal),
            tenorBulan: cfg.tenor,
            bungaPersenTahun: decimal(12),
            status: cfg.status,
            tanggalCair: tglCair ?? undefined,
            sisaPokok: decimal(sisaPokok),
          },
        });

        if (tglCair) {
          const jadwal = hitungJadwalAngsuran(cfg.nominal, cfg.tenor);
          const angsuranData: any[] = [];
          for (let b = 0; b < jadwal.length; b++) {
            const row = jadwal[b];
            const isPaid = b < cfg.paid;
            const jatuh = new Date(tglCair.getFullYear(), tglCair.getMonth() + row.bulanKe, 5);
            const tglBayar = isPaid ? new Date(tglCair.getFullYear(), tglCair.getMonth() + row.bulanKe, 3) : null;
            const invoiceNo = isPaid ? `KW-${sDef.slug.toUpperCase()}-${row.bulanKe}-${lIdx + 100}` : null;

            angsuranData.push({
              pinjamanId: p.id,
              bulanKe: row.bulanKe,
              jatuhTempo: jatuh,
              pokok: decimal(row.pokok),
              bunga: decimal(row.bunga),
              biayaAdmin: decimal(0),
              total: decimal(row.total),
              dibayar: isPaid,
              tanggalBayar: tglBayar ?? undefined,
              noInvoice: invoiceNo ?? undefined,
            });
          }
          await prisma.angsuran.createMany({ data: angsuranData });
        }
      }
    }

    // 8. Pendapatan & Biaya Operasional (2024, 2025, 2026)
    for (const yr of [2024, 2025, 2026]) {
      const pCount = await prisma.pendapatan.count({
        where: { satminkalId: satminkal.id, tahun: yr },
      });
      if (pCount === 0) {
        await prisma.pendapatan.createMany({
          data: [
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisPendapatan.BUNGA_PINJAMAN,
              nominal: decimal(45000000),
              keterangan: `Pendapatan Bunga Pinjaman ${yr} - ${sDef.nama}`,
            },
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisPendapatan.ADMINISTRASI_RISIKO,
              nominal: decimal(15000000),
              keterangan: `Pendapatan Admin Pinjaman ${yr} - ${sDef.nama}`,
            },
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisPendapatan.JASA_LAINNYA,
              nominal: decimal(10000000),
              keterangan: `Jasa Deposito & Bank ${yr} - ${sDef.nama}`,
            },
          ],
        });
      }

      const bCount = await prisma.biayaOperasional.count({
        where: { satminkalId: satminkal.id, tahun: yr },
      });
      if (bCount === 0) {
        await prisma.biayaOperasional.createMany({
          data: [
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisBiayaOperasional.HONOR_PENGURUS,
              nominal: decimal(8000000),
              keterangan: `Honor Pengurus & Pengawas ${yr} - ${sDef.nama}`,
            },
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisBiayaOperasional.OPERASIONAL_KANTOR,
              nominal: decimal(7000000),
              keterangan: `Biaya Operasional Kantor ${yr} - ${sDef.nama}`,
            },
            {
              satminkalId: satminkal.id,
              tahun: yr,
              jenis: JenisBiayaOperasional.RAPAT_PENDIDIKAN_SOSIAL,
              nominal: decimal(5000000),
              keterangan: `Biaya Rapat RAT & Sosial ${yr} - ${sDef.nama}`,
            },
          ],
        });
      }
    }

    // 9. Produk Toko Koperasi Sample
    const existingKat = await prisma.kategoriProduk.findFirst({
      where: { satminkalId: satminkal.id },
    });
    let katId = existingKat?.id;
    if (!katId) {
      const kat = await prisma.kategoriProduk.create({
        data: {
          satminkalId: satminkal.id,
          nama: 'Sembako & Kebutuhan Dinas',
          deskripsi: 'Kebutuhan pokok dan perlengkapan harian',
        },
      });
      katId = kat.id;
    }

    const prodBarcode = `899${sDef.kode.substring(0, 4)}0001`;
    await prisma.produk.upsert({
      where: { kodeBarcode: prodBarcode },
      create: {
        satminkalId: satminkal.id,
        kategoriId: katId,
        kodeBarcode: prodBarcode,
        namaProduk: `Beras Super Premium 5kg (${sDef.slug.toUpperCase()})`,
        satuanKecil: 'Sak',
        satuanBesar: 'Karung',
        pcsPerUnit: 1,
        hargaBeli: decimal(65000),
        hargaJual: decimal(72000),
        stokFisik: 50,
        stokMinimum: 10,
        isPromoAktif: true,
        diskonPersen: decimal(5),
        isFastConsume: true,
      },
      update: {
        satminkalId: satminkal.id,
      },
    });

    // 10. Supplier
    const supCode = `SUP-${sDef.slug.toUpperCase()}`;
    const existingSup = await prisma.supplier.findFirst({
      where: { kodeSupplier: supCode, satminkalId: satminkal.id },
    });
    if (!existingSup) {
      await prisma.supplier.create({
        data: {
          satminkalId: satminkal.id,
          kodeSupplier: supCode,
          namaSupplier: `Distributor Sembako & Logistik ${sDef.nama}`,
          kontakPerson: 'Bpk. Hendrawan',
          telepon: sDef.telepon,
          alamat: sDef.alamat,
          totalHutang: decimal(0),
        },
      });
    }

    // 11. Event Undian RAT
    const evCount = await prisma.eventUndian.count({
      where: { satminkalId: satminkal.id },
    });
    if (evCount === 0) {
      await prisma.eventUndian.create({
        data: {
          satminkalId: satminkal.id,
          namaEvent: `Undian Doorprize RAT Koperasi ${sDef.nama} TB 2026`,
          hadiahUtama: 'Sepeda Motor Honda Beat & Logam Mulia 5g',
          poinPerKupon: 50,
          tanggalUndi: new Date('2026-12-20'),
          isSelesai: false,
        },
      });
    }

    console.log(`✅ Satminkal ${sDef.nama} berhasil diisi 20 Anggota, 8 Pengurus, Simpanan, Pinjaman, dan Data Koperasi.`);
  }

  console.log('\n🎉 ALL MULTI-SATMINKAL SEEDING COMPLETED SUCCESSFULLY!');
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('❌ Seeding Error:', e);
  process.exit(1);
});
