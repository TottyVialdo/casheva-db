import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JenisSimpanan, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SimpananMassalDto } from './dto/simpanan-massal.dto';
import { BatchSimpananGolonganDto } from './dto/batch-simpanan.dto';
import { SimpananService } from './simpanan.service';

@ApiTags('Simpanan')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('simpanan')
export class SimpananController {
  constructor(private readonly simpananService: SimpananService) {}

  @Get('rekap')
  @ApiOperation({ summary: 'Rekap simpanan per anggota aktif (Satminkal / Kotama)' })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  rekap(
    @CurrentUser() user: JwtUser,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.simpananService.rekapSatminkal(user, satminkalId);
  }

  @Get('pengaturan')
  @ApiOperation({ summary: 'Lihat pengaturan nominal simpanan pokok/wajib/khusus aktif' })
  getPengaturanSimpanan(@CurrentUser() user: JwtUser) {
    return this.simpananService.getPengaturanSimpanan(user);
  }

  @Patch('pengaturan')
  @Post('pengaturan')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA)
  @ApiOperation({ summary: 'Ubah nominal simpanan pokok/wajib/khusus (oleh Bendahara/Admin)' })
  updatePengaturanSimpanan(
    @CurrentUser() user: JwtUser,
    @Body() dto: { nominalPokok?: number; nominalWajib?: number; nominalKhusus?: number },
  ) {
    return this.simpananService.updatePengaturanSimpanan(user, dto);
  }

  @Get('rekap-bulanan')
  @ApiOperation({ summary: 'Rekap simpanan bulanan (filter bulan & tahun) untuk ekspor' })
  @ApiQuery({ name: 'bulan', required: true, type: Number })
  @ApiQuery({ name: 'tahun', required: true, type: Number })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  rekapBulanan(
    @CurrentUser() user: JwtUser,
    @Query('bulan') bulan: string,
    @Query('tahun') tahun: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.simpananService.rekapSimpananBulanan(user, +bulan, +tahun, satminkalId);
  }

  @Get('anggota/:anggotaId')
  @ApiOperation({ summary: 'Riwayat simpanan satu anggota' })
  byAnggota(
    @CurrentUser() user: JwtUser,
    @Param('anggotaId') anggotaId: string,
  ) {
    return this.simpananService.listByAnggota(user, anggotaId);
  }

  @Post('pokok-wajib/:anggotaId')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.JURU_BAYAR)
  @ApiOperation({
    summary: 'Catat simpanan pokok & wajib pertama kali (nominal dinamis)',
  })
  pokokWajib(
    @CurrentUser() user: JwtUser,
    @Param('anggotaId') anggotaId: string,
  ) {
    return this.simpananService.setPokokWajib(user, anggotaId);
  }

  @Post('sukarela/massal')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.JURU_BAYAR)
  @ApiOperation({
    summary: 'Input simpanan sukarela serempak seluruh anggota aktif',
  })
  sukarelaMassal(@CurrentUser() user: JwtUser, @Body() dto: SimpananMassalDto) {
    return this.simpananService.sukarelaMassal(user, dto);
  }

  @Post('setor')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.JURU_BAYAR)
  @ApiOperation({
    summary: 'Setor simpanan anggota (Sukarela/Khusus/Pokok/Wajib) oleh Bendahara',
  })
  setorSimpanan(
    @CurrentUser() user: JwtUser,
    @Body() dto: { anggotaId: string; jenis: JenisSimpanan; nominal: number; keterangan?: string },
  ) {
    return this.simpananService.setorSimpanan(user, dto);
  }

  @Post('batch-golongan')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA)
  @ApiOperation({
    summary: 'Catat simpanan pokok & wajib serempak berdasarkan golongan dari file Excel',
  })
  batchGolongan(
    @CurrentUser() user: JwtUser,
    @Body() dto: BatchSimpananGolonganDto,
  ) {
    return this.simpananService.batchSimpananGolongan(user, dto);
  }
}
