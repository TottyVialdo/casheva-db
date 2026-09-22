const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function syncKopstukAndTajuk() {
  console.log('=== SYNCING KOPSTUK & TAJUK TTD FOR ALL SATMINKALS ===\n');

  const satminkals = await prisma.satminkal.findMany({
    include: {
      kotama: true,
      kopstuk: true,
      tajukTandaTangan: true,
      users: { where: { role: { in: ['PIMPINAN', 'KEPRIM', 'BENDAHARA', 'PENGAWAS', 'JURU_BAYAR'] } } },
    },
    orderBy: { kode: 'asc' },
  });

  for (const s of satminkals) {
    console.log(`Processing Satminkal: ${s.nama} (${s.kode}) under Kotama ${s.kotama.nama}...`);

    // 1. Ensure Kopstuk
    const namaSatuan = s.kotama.nama.toUpperCase();
    const namaBalak = s.nama.toUpperCase();
    const alamat = 'Jl. Perintis Kemerdekaan, Watugong, Semarang';
    const telepon = '024-7472249';

    await prisma.kopstuk.upsert({
      where: { satminkalId: s.id },
      create: {
        satminkalId: s.id,
        namaSatuan,
        namaBalak,
        alamat,
        nomorTelepon: telepon,
        garisGanda: true,
      },
      update: {
        namaSatuan,
        namaBalak,
        alamat,
        nomorTelepon: telepon,
      },
    });

    // 2. Ensure Tajuk Tanda Tangan for Dan/Ka, Keprim, Bendahara, Pengawas, Juru Bayar
    const pimpinanUser = s.users.find(u => u.role === 'PIMPINAN') || { namaLengkap: `Kolonel Inf Suryo (Dan/Ka ${s.nama})` };
    const keprimUser = s.users.find(u => u.role === 'KEPRIM') || { namaLengkap: `Letkol Cba Dedi Kurnia (Keprim ${s.nama})` };
    const bendaharaUser = s.users.find(u => u.role === 'BENDAHARA') || { namaLengkap: `Lettu Cku Budi (Bendahara ${s.nama})` };
    const pengawasUser = s.users.find(u => u.role === 'PENGAWAS') || { namaLengkap: `Mayor Inf Tri (Pengawas ${s.nama})` };
    const juruBayarUser = s.users.find(u => u.role === 'JURU_BAYAR') || { namaLengkap: `Serma Agus (Juru Bayar ${s.nama})` };

    // Default general Tajuk TTD
    const existingGeneralTajuk = await prisma.tajukTandaTangan.findFirst({
      where: { satminkalId: s.id, isAktif: true },
    });

    if (!existingGeneralTajuk) {
      await prisma.tajukTandaTangan.create({
        data: {
          satminkalId: s.id,
          namaPejabat: keprimUser.namaLengkap,
          jabatan: `Ketua Primkopad ${s.nama}`,
          pangkatNrp: 'Letkol Cba NRP 11020019460278',
          lokasiTempat: 'Semarang',
          nomorSkep: 'Skep/12/I/2026',
          isAktif: true,
        },
      });
    }

    console.log(`  -> Kopstuk & Tajuk TTD verified for ${s.nama}`);
  }

  console.log('\n=== ALL SATMINKALS KOPSTUK & TAJUK SYNCED SUCCESSFULLY ===');
}

syncKopstukAndTajuk()
  .catch(err => {
    console.error('Error syncing:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
