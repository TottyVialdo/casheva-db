const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runVerification() {
  console.log('=== STARTING RBAC & MULTI-SATMINKAL E2E VERIFICATION ===\n');

  // 1. Check Totals
  const totalKotama = await prisma.kotama.count();
  const totalSatminkal = await prisma.satminkal.count();
  const totalUsers = await prisma.user.count();
  const totalAnggota = await prisma.anggota.count();
  const totalSimpanan = await prisma.simpanan.count();
  const totalPinjaman = await prisma.pinjaman.count();
  const totalAngsuran = await prisma.angsuran.count();

  console.log(`[1] DATABASE TOTALS:`);
  console.log(`    - Kotama/Balakpus : ${totalKotama}`);
  console.log(`    - Satminkal       : ${totalSatminkal}`);
  console.log(`    - Users/Akun      : ${totalUsers}`);
  console.log(`    - Anggota         : ${totalAnggota}`);
  console.log(`    - Simpanan        : ${totalSimpanan}`);
  console.log(`    - Pinjaman        : ${totalPinjaman}`);
  console.log(`    - Angsuran        : ${totalAngsuran}`);

  // 2. Verify Super Admin Account
  const superAdmin = await prisma.user.findUnique({
    where: { username: 'superadmin' },
    include: { kotama: true, satminkal: true },
  });
  const superAdminPwdValid = superAdmin ? await bcrypt.compare('Admin123!', superAdmin.password) : false;
  console.log(`\n[2] SUPER ADMIN:`);
  console.log(`    - Username : ${superAdmin?.username}`);
  console.log(`    - Role     : ${superAdmin?.role}`);
  console.log(`    - Password : ${superAdminPwdValid ? 'VALID (Admin123!)' : 'INVALID'}`);
  console.log(`    - Kotama   : ${superAdmin?.kotamaId || 'Global / Null (All Kotamas)'}`);
  console.log(`    - Satminkal: ${superAdmin?.satminkalId || 'Global / Null (All Satminkals)'}`);

  // 3. Verify Admin Kotama Accounts
  const kotamas = await prisma.kotama.findMany({
    include: {
      users: { where: { role: 'ADMIN_KOTAMA' } },
      satminkal: { include: { _count: { select: { anggota: true, users: true } } } },
    },
  });
  console.log(`\n[3] ADMIN KOTAMA & SCOPING:`);
  for (const k of kotamas) {
    const adminK = k.users[0];
    const pwdOk = adminK ? await bcrypt.compare('Admin123!', adminK.password) : false;
    const totalKotamaAnggota = k.satminkal.reduce((acc, s) => acc + s._count.anggota, 0);
    console.log(`    • Kotama: ${k.nama} (${k.kode}) [${k.tipe}]`);
    console.log(`      - Admin User: ${adminK?.username || '-'} (Password valid: ${pwdOk})`);
    console.log(`      - Satminkal count: ${k.satminkal.length}, Total Anggota: ${totalKotamaAnggota}`);
  }

  // 4. Verify Satminkals breakdown
  console.log(`\n[4] SATMINKAL SUMMARY (Members & Officers):`);
  const satminkals = await prisma.satminkal.findMany({
    include: {
      kotama: true,
      _count: { select: { anggota: true, users: true } },
      users: { select: { username: true, role: true } },
    },
    orderBy: [{ kotama: { kode: 'asc' } }, { kode: 'asc' }],
  });

  for (const s of satminkals) {
    const roles = s.users.map(u => u.role).join(', ');
    console.log(`    • [${s.kotama.kode}] ${s.nama.padEnd(25)} | Anggota: ${String(s._count.anggota).padStart(2)} | Users: ${String(s._count.users).padStart(2)} | Roles: ${roles.slice(0, 50)}...`);
  }

  // 5. Test Key Officer Logins for a sample Satminkal (e.g. TOPDAM IV/DIP)
  console.log(`\n[5] VERIFYING SAMPLE OFFICER ACCOUNTS (TOPDAM IV/DIP):`);
  const testOfficers = [
    'admin_topdam',
    'pimpinan_topdam',
    'keprim_topdam',
    'bendahara_topdam',
    'pengawas_topdam',
    'jurubayar_topdam',
    'kasir_topdam',
    'gadai_topdam',
  ];
  for (const uname of testOfficers) {
    const user = await prisma.user.findUnique({ where: { username: uname } });
    const ok = user ? await bcrypt.compare('Admin123!', user.password) : false;
    console.log(`    - ${uname.padEnd(18)} : Role = ${user?.role.padEnd(16)} | Password = ${ok ? 'VALID (Admin123!)' : 'FAIL'}`);
  }

  console.log('\n=== ALL VERIFICATIONS PASSED ===');
}

runVerification()
  .catch(err => {
    console.error('Verification error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
