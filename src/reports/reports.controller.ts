import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { ReportsService } from './reports.service';

import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Reports / Cetakan')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('anggota')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Laporan Cetak Daftar Anggota Koperasi (Lampiran II)' })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getReportAnggota(
    @CurrentUser() user: JwtUser,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.reportsService.getReportAnggota(user, satminkalId);
  }

  @Get('brosur-pinjaman')
  @ApiOperation({ summary: 'Brosur Matriks Pinjaman Koperasi (Lampiran III)' })
  getBrosurPinjaman() {
    return this.reportsService.getBrosurPinjaman();
  }

  @Get('rekap-simpanan')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Laporan Rekap Simpanan Anggota (Lampiran IV)' })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getRekapSimpanan(
    @CurrentUser() user: JwtUser,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.reportsService.getRekapSimpanan(user, satminkalId);
  }

  @Get('pinjaman-anggota')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Daftar Anggota Meminjam (Lampiran V)' })
  @ApiQuery({ name: 'tahun', required: false, type: Number })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getPinjamanAnggota(
    @CurrentUser() user: JwtUser,
    @Query('tahun') tahun?: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    const t = tahun ? parseInt(tahun, 10) : undefined;
    return this.reportsService.getPinjamanAnggota(user, t, satminkalId);
  }

  @Get('akad-kredit/:pinjamanId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Resume / Akad Kredit Pinjaman (Lampiran VI)' })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getAkadKredit(
    @CurrentUser() user: JwtUser,
    @Param('pinjamanId') pinjamanId: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.reportsService.getAkadKredit(user, pinjamanId, satminkalId);
  }

  @Get('kwitansi/:angsuranId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
    Role.JURU_BAYAR,
    Role.ANGGOTA,
  )
  @ApiOperation({ summary: 'Kwitansi / Invoice Pembayaran Angsuran (Lampiran VII)' })
  getKwitansi(
    @CurrentUser() user: JwtUser,
    @Param('angsuranId') angsuranId: string,
  ) {
    return this.reportsService.getKwitansi(user, angsuranId);
  }

  @Get('rekap-kwitansi-bulanan')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Rekap Kwitansi Bulanan (Lampiran VIII)' })
  @ApiQuery({ name: 'tahun', required: false, type: Number })
  @ApiQuery({ name: 'bulan', required: false, type: Number })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getRekapKwitansiBulanan(
    @CurrentUser() user: JwtUser,
    @Query('tahun') tahun?: string,
    @Query('bulan') bulan?: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    const t = tahun ? parseInt(tahun, 10) : undefined;
    const b = bulan ? parseInt(bulan, 10) : undefined;
    return this.reportsService.getRekapKwitansiBulanan(user, t, b, satminkalId);
  }

  @Get('shu-anggota/:tahun')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
    Role.KEPRIM,
    Role.PIMPINAN,
    Role.PENGAWAS,
  )
  @ApiOperation({ summary: 'Laporan SHU Anggota Koperasi (Lampiran IX)' })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  getShuAnggota(
    @CurrentUser() user: JwtUser,
    @Param('tahun') tahun: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.reportsService.getShuAnggota(user, parseInt(tahun, 10), satminkalId);
  }
}
