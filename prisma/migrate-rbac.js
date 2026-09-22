const { Pool } = require('d:/USM/MAGANG/Lomba/Website/casheva-db/node_modules/pg');
require('d:/USM/MAGANG/Lomba/Website/casheva-db/node_modules/dotenv').config({ path: 'd:/USM/MAGANG/Lomba/Website/casheva-db/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('🚀 Running database migrations for RBAC & Multi-Satminkal...');
  try {
    // 1. Add new roles to Role enum
    const newRoles = ['SUPER_ADMIN', 'ADMIN_KOTAMA', 'ADMIN_SATMINKAL'];
    for (const r of newRoles) {
      try {
        await pool.query(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '${r}';`);
        console.log(`✅ Enum Role: added ${r}`);
      } catch (e) {
        console.log(`ℹ️ Enum Role notice (${r}):`, e.message);
      }
    }

    // 2. Add tipe & status to tb_kotama
    await pool.query(`
      ALTER TABLE "tb_kotama"
      ADD COLUMN IF NOT EXISTS "tipe" VARCHAR(50) DEFAULT 'KOTAMA',
      ADD COLUMN IF NOT EXISTS "status" BOOLEAN DEFAULT true;
    `);
    console.log('✅ Added tipe & status to tb_kotama');

    // 3. Add status to tb_satker
    await pool.query(`
      ALTER TABLE "tb_satker"
      ADD COLUMN IF NOT EXISTS "status" BOOLEAN DEFAULT true;
    `);
    console.log('✅ Added status to tb_satker');

    // 4. Make kotamaId & satminkalId nullable in User table
    await pool.query(`
      ALTER TABLE "User"
      ALTER COLUMN "kotamaId" DROP NOT NULL,
      ALTER COLUMN "satminkalId" DROP NOT NULL;
    `);
    console.log('✅ Made User.kotamaId & User.satminkalId nullable for Super Admin & Admin Kotama');

    // 5. Add satminkalId to BiayaOperasional
    await pool.query(`
      ALTER TABLE "BiayaOperasional"
      ADD COLUMN IF NOT EXISTS "satminkalId" TEXT REFERENCES "tb_satker"("id") ON DELETE SET NULL;
    `);
    console.log('✅ Added satminkalId to BiayaOperasional');

    // 6. Add satminkalId to tb_tajuk_ttd
    await pool.query(`
      ALTER TABLE "tb_tajuk_ttd"
      ADD COLUMN IF NOT EXISTS "satminkalId" TEXT REFERENCES "tb_satker"("id") ON DELETE SET NULL;
    `);
    console.log('✅ Added satminkalId to tb_tajuk_ttd');

    console.log('🎉 Database migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await pool.end();
  }
}

run();
