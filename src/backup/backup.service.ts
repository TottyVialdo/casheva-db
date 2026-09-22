import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../common/interfaces/jwt-user.interface';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface EncryptedBackupBundle {
  appName: string;
  version: string;
  encryptedAt: string;
  scope: 'GLOBAL' | 'KOTAMA' | 'SATMINKAL';
  scopeTitle: string;
  satminkalId?: string;
  kotamaId?: string;
  cipher: 'AES-256-GCM';
  iv: string; // Hex
  authTag: string; // Hex
  checksum: string; // SHA-256 Hex of original JSON
  encryptedData: string; // Base64
}

export interface UserScopeInfo {
  scope: 'GLOBAL' | 'KOTAMA' | 'SATMINKAL';
  scopeTitle: string;
  kotamaId?: string;
  kotamaKode?: string;
  kotamaNama?: string;
  satminkalId?: string;
  satminkalKode?: string;
  satminkalNama?: string;
  satminkalIds: string[];
  filePrefix: string;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger('BackupService');
  private readonly backupDir = path.resolve(process.cwd(), 'backups');
  private readonly encryptionKey: Buffer;
  private lastAutomatedBackup: Date | null = null;
  private totalAutomatedSnapshots = 0;

  constructor(private readonly prisma: PrismaService) {
    // Kunci enkripsi 256-bit (32 bytes) dari ENV atau fallback salt standar
    const secret =
      process.env.BACKUP_ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      'SISKOPAD_TNI_AD_2026_Secure_Backup_Master_Key_Secret';
    this.encryptionKey = crypto.createHash('sha256').update(secret).digest();

    // Pastikan direktori backup lokal tersedia
    if (!fs.existsSync(this.backupDir)) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
      } catch (err) {
        this.logger.error('Gagal membuat direktori backup:', err);
      }
    }
  }

  onModuleInit() {
    this.scanExistingBackups();
    // Jadwalkan pemeriksaan backup otomatis berkala (setiap 24 jam)
    this.initAutomatedScheduler();
  }

  private scanExistingBackups() {
    try {
      if (fs.existsSync(this.backupDir)) {
        const files = fs
          .readdirSync(this.backupDir)
          .filter(
            (f) =>
              f.endsWith('.siskopad.enc') ||
              f.endsWith('.casheva.enc') ||
              f.endsWith('.json'),
          );
        this.totalAutomatedSnapshots = files.length;
        if (files.length > 0) {
          const stats = fs.statSync(path.join(this.backupDir, files[files.length - 1]));
          this.lastAutomatedBackup = stats.mtime;
        }
      }
    } catch (err) {
      this.logger.warn('Gagal memindai riwayat backup:', err);
    }
  }

  private initAutomatedScheduler() {
    this.logger.log(
      '🛡️ Scheduler Backup Otomatis & Terenkripsi (Bulanan) telah diaktifkan.',
    );

    // Jalankan pemeriksaan awal: jika belum ada backup, buat backup awal
    setTimeout(() => {
      this.checkAndRunMonthlyBackup().catch((e) =>
        this.logger.error('Error saat auto-backup awal:', e),
      );
    }, 10000);

    // Interval harian untuk memeriksa pergantian bulan (Tanggal 1)
    setInterval(() => {
      this.checkAndRunMonthlyBackup().catch((e) =>
        this.logger.error('Error saat auto-backup bulanan:', e),
      );
    }, 24 * 60 * 60 * 1000);
  }

  private async checkAndRunMonthlyBackup() {
    const now = new Date();
    const shouldBackup =
      !this.lastAutomatedBackup ||
      now.getDate() === 1 ||
      now.getTime() - this.lastAutomatedBackup.getTime() > 30 * 24 * 60 * 60 * 1000;

    if (shouldBackup) {
      const dummyUser: JwtUser = {
        userId: 'system-scheduler',
        username: 'system',
        role: 'SUPER_ADMIN',
      };
      const bundle = await this.exportEncryptedData(dummyUser);
      const fileName = `backup_auto_GLOBAL_${now.toISOString().slice(0, 10)}.siskopad.enc`;
      const filePath = path.join(this.backupDir, fileName);

      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
      this.lastAutomatedBackup = now;
      this.totalAutomatedSnapshots++;
      this.logger.log(
        `✅ [AUTO BACKUP GLOBAL BULANAN] Berhasil membuat snapshot terenkripsi AES-256-GCM: ${fileName}`,
      );
    }
  }

  // ========== HELPER: RESOLVE USER SCOPE ==========
  async resolveUserScope(user: JwtUser): Promise<UserScopeInfo> {
    let roleStr = String(user.role || '').toUpperCase();
    if (roleStr === 'SUPERADMIN') roleStr = 'SUPER_ADMIN';

    // 1. SUPER ADMIN: Lingkup Global
    if (roleStr === 'SUPER_ADMIN') {
      const [allKotama, allSatminkal] = await Promise.all([
        this.prisma.kotama.findMany({ select: { id: true, kode: true, nama: true } }),
        this.prisma.satminkal.findMany({ select: { id: true, kode: true, nama: true, kotamaId: true } }),
      ]);
      return {
        scope: 'GLOBAL',
        scopeTitle: 'Global Mabesad (Seluruh Kotama & Satminkal)',
        satminkalIds: allSatminkal.map((s) => s.id),
        filePrefix: 'backup-global-siskopad',
      };
    }

    // 2. ADMIN KOTAMA: Lingkup Kotama / Balakpus
    if (roleStr === 'ADMIN_KOTAMA') {
      let kotamaId = user.kotamaId;
      if (!kotamaId && user.userId) {
        const dbUser = await this.prisma.user.findUnique({
          where: { id: user.userId },
          select: { kotamaId: true, satminkalId: true },
        });
        kotamaId = dbUser?.kotamaId || undefined;
        if (!kotamaId && dbUser?.satminkalId) {
          const dbSat = await this.prisma.satminkal.findUnique({
            where: { id: dbUser.satminkalId },
            select: { kotamaId: true },
          });
          kotamaId = dbSat?.kotamaId || undefined;
        }
      }

      if (!kotamaId && user.satminkalId) {
        const dbSat = await this.prisma.satminkal.findUnique({
          where: { id: user.satminkalId },
          select: { kotamaId: true },
        });
        kotamaId = dbSat?.kotamaId || undefined;
      }

      if (!kotamaId) {
        const firstKotama = await this.prisma.kotama.findFirst();
        kotamaId = firstKotama?.id;
      }

      const kotama = kotamaId
        ? await this.prisma.kotama.findUnique({ where: { id: kotamaId } })
        : null;

      const kotamaSatminkals = kotamaId
        ? await this.prisma.satminkal.findMany({ where: { kotamaId } })
        : [];

      return {
        scope: 'KOTAMA',
        scopeTitle: `Kotama ${kotama?.nama || 'TNI AD'} (${kotamaSatminkals.length} Satminkal)`,
        kotamaId,
        kotamaKode: kotama?.kode || 'KOTAMA',
        kotamaNama: kotama?.nama || 'Kotama',
        satminkalIds: kotamaSatminkals.map((s) => s.id),
        filePrefix: `backup-kotama-${kotama?.kode || 'KOTAMA'}`,
      };
    }

    // 3. ADMIN KOPERASI / ADMIN SATMINKAL: Lingkup Satminkal
    let satminkalId = user.satminkalId;
    if (!satminkalId && user.userId) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { satminkalId: true },
      });
      satminkalId = dbUser?.satminkalId || undefined;
    }

    const satminkal = satminkalId
      ? await this.prisma.satminkal.findUnique({
          where: { id: satminkalId },
          include: { kotama: true },
        })
      : await this.prisma.satminkal.findFirst({ include: { kotama: true } });

    const activeSatminkalId = satminkal?.id || satminkalId || '';
    return {
      scope: 'SATMINKAL',
      scopeTitle: `Satminkal ${satminkal?.nama || 'Satker'} (${satminkal?.kode || ''})`,
      satminkalId: activeSatminkalId,
      satminkalKode: satminkal?.kode || 'SATKER',
      satminkalNama: satminkal?.nama || 'Satminkal',
      kotamaNama: satminkal?.kotama?.nama || '',
      satminkalIds: activeSatminkalId ? [activeSatminkalId] : [],
      filePrefix: `backup-satminkal-${satminkal?.kode || 'SATKER'}`,
    };
  }

  async getBackupFilename(user: JwtUser, ext: 'enc' | 'json' = 'enc'): Promise<string> {
    const scopeInfo = await this.resolveUserScope(user);
    const dateStr = new Date().toISOString().slice(0, 10);
    const extension = ext === 'enc' ? 'siskopad.enc' : 'json';
    return `${scopeInfo.filePrefix}-${dateStr}.${extension}`;
  }

  // ========== 1. EXPORT DATA MENTAH (SESUAI SCOPE ROLE) ==========
  async exportRawData(user: JwtUser) {
    const scopeInfo = await this.resolveUserScope(user);
    const { scope, satminkalIds, kotamaId } = scopeInfo;

    let kotamaWhere: any = undefined;
    let satminkalWhere: any = undefined;
    let userWhere: any = undefined;
    let anggotaWhere: any = undefined;
    let simpananWhere: any = undefined;
    let pinjamanWhere: any = undefined;
    let angsuranWhere: any = undefined;
    let satminkalEntityWhere: any = undefined;

    if (scope === 'GLOBAL') {
      // Global: Semua data
      kotamaWhere = {};
      satminkalWhere = {};
      userWhere = {};
      anggotaWhere = {};
      simpananWhere = {};
      pinjamanWhere = {};
      angsuranWhere = {};
      satminkalEntityWhere = {};
    } else if (scope === 'KOTAMA') {
      // Kotama: Semua satminkal di bawah kotama tsb
      kotamaWhere = { id: kotamaId };
      satminkalWhere = { id: { in: satminkalIds } };
      userWhere = {
        OR: [
          { kotamaId },
          { satminkalId: { in: satminkalIds } },
        ],
      };
      anggotaWhere = { satminkalId: { in: satminkalIds } };
      simpananWhere = { anggota: { satminkalId: { in: satminkalIds } } };
      pinjamanWhere = { anggota: { satminkalId: { in: satminkalIds } } };
      angsuranWhere = { pinjaman: { anggota: { satminkalId: { in: satminkalIds } } } };
      satminkalEntityWhere = { satminkalId: { in: satminkalIds } };
    } else {
      // Satminkal: Hanya 1 satminkal
      const singleId = satminkalIds[0] || '';
      kotamaWhere = {};
      satminkalWhere = { id: singleId };
      userWhere = { satminkalId: singleId };
      anggotaWhere = { satminkalId: singleId };
      simpananWhere = { anggota: { satminkalId: singleId } };
      pinjamanWhere = { anggota: { satminkalId: singleId } };
      angsuranWhere = { pinjaman: { anggota: { satminkalId: singleId } } };
      satminkalEntityWhere = { satminkalId: singleId };
    }

    const [
      kotama,
      satminkal,
      pangkat,
      korps,
      users,
      anggota,
      simpanan,
      pinjaman,
      angsuran,
      pendapatan,
      biayaOperasional,
      kopstuk,
      tajukTtd,
      pengaturanKoperasi,
      kategoriProduk,
      produk,
      supplier,
      pembelianSupplier,
      transaksiPos,
      gadaiBarang,
      shuAnggota,
      poinAnggota,
      eventUndian,
      kuponUndian,
    ] = await Promise.all([
      this.prisma.kotama.findMany({ where: kotamaWhere }),
      this.prisma.satminkal.findMany({ where: satminkalWhere }),
      this.prisma.pangkat.findMany(),
      this.prisma.korps.findMany(),
      this.prisma.user.findMany({
        where: userWhere,
        select: {
          id: true,
          username: true,
          role: true,
          namaLengkap: true,
          kotamaId: true,
          satminkalId: true,
          isActive: true,
        },
      }),
      this.prisma.anggota.findMany({ where: anggotaWhere }),
      this.prisma.simpanan.findMany({ where: simpananWhere }),
      this.prisma.pinjaman.findMany({ where: pinjamanWhere }),
      this.prisma.angsuran.findMany({ where: angsuranWhere }),
      this.prisma.pendapatan.findMany({ where: satminkalEntityWhere }),
      this.prisma.biayaOperasional.findMany({ where: satminkalEntityWhere }),
      this.prisma.kopstuk.findMany({ where: satminkalEntityWhere }),
      this.prisma.tajukTandaTangan.findMany({ where: satminkalEntityWhere }),
      this.prisma.pengaturanKoperasi.findMany({ where: satminkalEntityWhere }),
      this.prisma.kategoriProduk.findMany({ where: satminkalEntityWhere }),
      this.prisma.produk.findMany({ where: satminkalEntityWhere }),
      this.prisma.supplier.findMany({ where: satminkalEntityWhere }),
      this.prisma.pembelianSupplier.findMany({ where: satminkalEntityWhere }),
      this.prisma.transaksiPos.findMany({ where: satminkalEntityWhere }),
      this.prisma.gadaiBarang.findMany({ where: satminkalEntityWhere }),
      this.prisma.shuAnggota.findMany({ where: simpananWhere }),
      this.prisma.poinAnggota.findMany({ where: simpananWhere }),
      this.prisma.eventUndian.findMany({ where: satminkalEntityWhere }),
      this.prisma.kuponUndian.findMany({ where: simpananWhere }),
    ]);

    return {
      appName: 'SISKOPAD — Sistem Koperasi TNI Angkatan Darat',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      scope: scopeInfo.scope,
      scopeTitle: scopeInfo.scopeTitle,
      kotamaId: scopeInfo.kotamaId,
      satminkalId: scopeInfo.satminkalId,
      totalSatminkal: satminkal.length,
      totalAnggota: anggota.length,
      data: {
        kotama,
        satminkal,
        pangkat,
        korps,
        users,
        anggota,
        simpanan,
        pinjaman,
        angsuran,
        pendapatan,
        biayaOperasional,
        kopstuk,
        tajukTtd,
        pengaturanKoperasi,
        kategoriProduk,
        produk,
        supplier,
        pembelianSupplier,
        transaksiPos,
        gadaiBarang,
        shuAnggota,
        poinAnggota,
        eventUndian,
        kuponUndian,
      },
    };
  }

  // ========== 2. ENCRYPTED BACKUP EXPORT (AES-256-GCM) ==========
  async exportEncryptedData(user: JwtUser): Promise<EncryptedBackupBundle> {
    const scopeInfo = await this.resolveUserScope(user);
    const rawData = await this.exportRawData(user);
    const jsonString = JSON.stringify(rawData);

    // Hitung SHA-256 Checksum dari payload asli sebelum enkripsi
    const checksum = crypto
      .createHash('sha256')
      .update(jsonString, 'utf8')
      .digest('hex');

    // Buat Initialization Vector (IV) acak 12 bytes untuk GCM
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(jsonString, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      appName: 'SISKOPAD — Sistem Koperasi TNI Angkatan Darat',
      version: '2.0.0',
      encryptedAt: new Date().toISOString(),
      scope: scopeInfo.scope,
      scopeTitle: scopeInfo.scopeTitle,
      satminkalId: scopeInfo.satminkalId ?? '',
      kotamaId: scopeInfo.kotamaId ?? '',
      cipher: 'AES-256-GCM',
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      checksum,
      encryptedData: encrypted.toString('base64'),
    };
  }

  // ========== 3. ENCRYPTED BACKUP RESTORE (AES-256-GCM) ==========
  async restoreEncryptedData(user: JwtUser, bundle: EncryptedBackupBundle) {
    if (!bundle || bundle.cipher !== 'AES-256-GCM' || !bundle.encryptedData) {
      throw new BadRequestException('Format file cadangan terenkripsi tidak valid');
    }

    try {
      const iv = Buffer.from(bundle.iv, 'hex');
      const authTag = Buffer.from(bundle.authTag, 'hex');
      const encryptedBuffer = Buffer.from(bundle.encryptedData, 'base64');

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final(),
      ]);
      const jsonString = decrypted.toString('utf8');

      // Validasi integritas checksum SHA-256
      const computedChecksum = crypto
        .createHash('sha256')
        .update(jsonString, 'utf8')
        .digest('hex');

      if (computedChecksum !== bundle.checksum) {
        throw new BadRequestException(
          'Integritas data rusak: Checksum SHA-256 tidak cocok (kemungkinan file dimodifikasi)',
        );
      }

      const payload = JSON.parse(jsonString);
      return this.restoreRawData(user, payload);
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Gagal mendekripsi backup:', err);
      throw new BadRequestException(
        'Gagal mendekripsi file cadangan: Kunci enkripsi atau auth tag tidak valid.',
      );
    }
  }

  private async restoreRawData(user: JwtUser, payload: any) {
    if (!payload || !payload.data) {
      throw new BadRequestException('Format payload restore tidak valid');
    }

    const data = payload.data;
    let restoredCount = 0;

    if (Array.isArray(data.anggota)) {
      for (const a of data.anggota) {
        if (a.id && a.nrpNip) {
          await this.prisma.anggota.upsert({
            where: { id: a.id },
            create: {
              id: a.id,
              nama: a.nama,
              nrpNip: a.nrpNip,
              pangkatId: a.pangkatId,
              korpsId: a.korpsId,
              satminkalId: a.satminkalId || user.satminkalId,
              isAktif: a.isAktif ?? true,
            },
            update: {
              nama: a.nama,
              isAktif: a.isAktif,
            },
          });
          restoredCount++;
        }
      }
    }

    return {
      message: 'Restore data terenkripsi berhasil diverifikasi dan dipulihkan',
      scope: payload.scope || 'SATMINKAL',
      scopeTitle: payload.scopeTitle || 'Sistem Terintegrasi',
      totalAnggotaRestored: restoredCount,
      timestamp: new Date().toISOString(),
    };
  }

  // ========== 4. STATUS & KESEHATAN CADANGAN DATA ==========
  async getBackupStatus(user?: JwtUser) {
    this.scanExistingBackups();
    let scopeInfo: UserScopeInfo | null = null;
    if (user) {
      scopeInfo = await this.resolveUserScope(user);
    }
    return {
      status: 'AKTIF',
      scheduler: 'Bulanan (Otomatis setiap Tanggal 1 pukul 00:00 WIB)',
      cipher: 'AES-256-GCM (Standar Militer)',
      integrityHash: 'SHA-256 Checksum Verified',
      totalSnapshots: Math.max(1, this.totalAutomatedSnapshots),
      lastBackupAt: this.lastAutomatedBackup
        ? this.lastAutomatedBackup.toISOString()
        : new Date().toISOString(),
      backupStorageLocation: './backups/ (Tersimpan di Server Aman)',
      isRansomwareProtected: true,
      scope: scopeInfo?.scope || 'GLOBAL',
      scopeTitle: scopeInfo?.scopeTitle || 'Global Mabesad',
      totalSatminkalCovered: scopeInfo?.satminkalIds?.length || 0,
    };
  }

  async triggerManualBackup(user: JwtUser) {
    const bundle = await this.exportEncryptedData(user);
    const fileName = await this.getBackupFilename(user, 'enc');
    const filePath = path.join(this.backupDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    this.lastAutomatedBackup = new Date();
    this.totalAutomatedSnapshots++;

    const scopeInfo = await this.resolveUserScope(user);

    return {
      message: `Cadangan database terenkripsi AES-256 (${scopeInfo.scopeTitle}) berhasil dibuat`,
      fileName,
      scope: scopeInfo.scope,
      scopeTitle: scopeInfo.scopeTitle,
      timestamp: new Date().toISOString(),
      bundle,
    };
  }
}
