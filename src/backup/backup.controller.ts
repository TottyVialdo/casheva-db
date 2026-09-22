import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { BackupService, type EncryptedBackupBundle } from './backup.service';

@ApiTags('Backup & Restore')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(
  Role.ADMIN_KOPERASI,
  Role.ADMIN_KOTAMA,
  Role.SUPER_ADMIN,
  Role.ADMIN_SATMINKAL,
)
@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status & riwayat jadwal cadangan data otomatis terenkripsi' })
  async getStatus(@CurrentUser() user: JwtUser) {
    return this.backupService.getBackupStatus(user);
  }

  @Get('export-encrypted')
  @ApiOperation({ summary: 'Unduh file cadangan database terenkripsi AES-256-GCM (.siskopad.enc)' })
  async exportEncryptedData(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const bundle = await this.backupService.exportEncryptedData(user);
    const filename = await this.backupService.getBackupFilename(user, 'enc');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(bundle, null, 2));
  }

  @Post('trigger-manual')
  @ApiOperation({ summary: 'Picukan pencadangan data manual terenkripsi instan' })
  async triggerManual(@CurrentUser() user: JwtUser) {
    return this.backupService.triggerManualBackup(user);
  }

  @Get('export')
  @ApiOperation({ summary: 'Ekspor database backup dalam format JSON mentah' })
  async exportData(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const backupJson = await this.backupService.exportRawData(user);
    const filename = await this.backupService.getBackupFilename(user, 'json');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(backupJson, null, 2));
  }

  @Post('restore-encrypted')
  @ApiOperation({ summary: 'Restore database dari file payload terenkripsi AES-256-GCM' })
  async restoreEncryptedData(
    @CurrentUser() user: JwtUser,
    @Body() payload: any,
  ) {
    return this.backupService.restoreEncryptedData(user, payload as EncryptedBackupBundle);
  }
}
