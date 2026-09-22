require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function check() {
  const admin = await prisma.user.findUnique({
    where: { username: 'admin' },
    include: { satminkal: true, kotama: true }
  });
  console.log('User admin in DB:', admin);

  const allInfolahtaUsers = await prisma.user.findMany({
    where: { satminkalId: admin?.satminkalId },
    select: { username: true, role: true, namaLengkap: true, satminkalId: true }
  });
  console.log('Infolahta users count in DB:', allInfolahtaUsers.length);
  console.log('Sample Infolahta users:', allInfolahtaUsers.slice(0, 5));

  await prisma.$disconnect();
  await pool.end();
}

check().catch(console.error);
