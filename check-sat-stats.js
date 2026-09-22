const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function checkSatminkals() {
  const satminkals = await prisma.satminkal.findMany({
    include: {
      kotama: true,
      _count: {
        select: { anggota: true, users: true }
      }
    },
    orderBy: [{ kotama: { kode: 'asc' } }, { kode: 'asc' }]
  });
  console.log('--- SATMINKALS STATS ---');
  for (const s of satminkals) {
    const simpananRows = await prisma.simpanan.findMany({
      where: { anggota: { satminkalId: s.id } },
      select: { tipe: true, nominal: true }
    });
    const totalSimpanan = simpananRows.reduce((acc, row) => {
      const val = Number(row.nominal || 0);
      return row.tipe === 'SETOR' ? acc + val : acc - val;
    }, 0);

    const pinjamanList = await prisma.pinjaman.findMany({
      where: {
        anggota: { satminkalId: s.id },
        status: { notIn: ['DITOLAK', 'DIAJUKAN'] }
      },
      select: { nominal: true, status: true, sisaPokok: true }
    });
    const totalPinjaman = pinjamanList.reduce((acc, p) => acc + Number(p.nominal || 0), 0);
    const pinjamanBerjalan = pinjamanList
      .filter(p => p.status === 'DICAIRKAN')
      .reduce((acc, p) => acc + Number(p.sisaPokok ?? p.nominal ?? 0), 0);

    console.log(
      `[${s.kotama.kode}] ${s.kode} ${s.nama.padEnd(28)} | Anggota: ${String(s._count.anggota).padStart(2)} | Simpanan: Rp ${totalSimpanan.toLocaleString('id-ID')} | Total Pinjaman: Rp ${totalPinjaman.toLocaleString('id-ID')} | Pinjaman Berjalan: Rp ${pinjamanBerjalan.toLocaleString('id-ID')}`
    );
  }
  await prisma.$disconnect();
  await pool.end();
}

checkSatminkals();
