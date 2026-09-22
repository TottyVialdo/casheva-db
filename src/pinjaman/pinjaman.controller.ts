import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role, StatusPinjaman } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  BayarAngsuranDinamisDto,
  CairkanPinjamanDto,
  CreatePinjamanDto,
  PelunasanDipercepatDto,
  UpdateBungaDto,
  UpdateStatusPinjamanDto,
} from './dto/pinjaman.dto';
import { PinjamanService } from './pinjaman.service';

@ApiTags('Pinjaman & Angsuran')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('pinjaman')
export class PinjamanController {
  constructor(private readonly pinjamanService: PinjamanService) {}

  // -------------------------------------------------------------
  // 1. QUERY / LIST & CREATE ROOT ROUTES
  // -------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Daftar pinjaman Satminkal / Kotama' })
  @ApiQuery({ name: 'status', required: false, enum: StatusPinjaman })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: StatusPinjaman,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.pinjamanService.findAll(user, status, satminkalId);
  }

  @Post()
  @ApiOperation({ summary: 'Ajukan pinjaman baru' })
  @ApiResponse({
    status: 201,
    description: 'Pengajuan pinjaman berhasil dibuat',
  })
  @ApiResponse({
    status: 400,
    description: 'Validasi gagal / Anggota memiliki pinjaman aktif',
  })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePinjamanDto) {
    return this.pinjamanService.create(user, dto);
  }

  // -------------------------------------------------------------
  // 2. RUTE AKSI KHUSUS / NESTED PARAM (Ditaruh sebelum :id umum)
  // -------------------------------------------------------------

  @Get('pengaturan-bunga')
  @ApiOperation({ summary: 'Lihat suku bunga pinjaman aktif Satminkal & riwayatnya' })
  @ApiResponse({ status: 200, description: 'Suku bunga aktif Satminkal' })
  getPengaturanBunga(@CurrentUser() user: JwtUser) {
    return this.pinjamanService.getPengaturanBunga(user);
  }

  @Patch('pengaturan-bunga')
  @Post('pengaturan-bunga')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.KEPRIM)
  @ApiOperation({ summary: 'Ubah suku bunga pinjaman aktif Satminkal (oleh Bendahara)' })
  @ApiResponse({ status: 200, description: 'Suku bunga berhasil diperbarui' })
  updatePengaturanBunga(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateBungaDto,
  ) {
    return this.pinjamanService.updatePengaturanBunga(user, dto);
  }

  @Get('plafond/:anggotaId')
  @ApiOperation({ summary: 'Cek sisa kuota plafond pinjaman anggota (berdasarkan pangkat)' })
  @ApiResponse({ status: 200, description: 'Info plafond pinjaman anggota' })
  getPlafondInfo(
    @CurrentUser() user: JwtUser,
    @Param('anggotaId') anggotaId: string,
  ) {
    return this.pinjamanService.getPlafondInfo(user, anggotaId);
  }

  @Get('rekap-angsuran-bulanan')
  @ApiOperation({ summary: 'Rekap angsuran bulanan (filter bulan & tahun) untuk ekspor' })
  @ApiQuery({ name: 'bulan', required: true, type: Number })
  @ApiQuery({ name: 'tahun', required: true, type: Number })
  @ApiQuery({ name: 'satminkalId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'List angsuran bulanan' })
  rekapAngsuranBulanan(
    @CurrentUser() user: JwtUser,
    @Query('bulan') bulan: string,
    @Query('tahun') tahun: string,
    @Query('satminkalId') satminkalId?: string,
  ) {
    return this.pinjamanService.rekapAngsuranBulanan(user, +bulan, +tahun, satminkalId);
  }

  @Post('angsuran/:angsuranId/bayar')
  @ApiOperation({ summary: 'Bayar angsuran + terbitkan no invoice/kwitansi' })
  @ApiResponse({ status: 200, description: 'Angsuran berhasil dibayar' })
  @ApiResponse({ status: 400, description: 'Angsuran sudah dibayar' })
  @ApiResponse({ status: 404, description: 'Angsuran tidak ditemukan' })
  bayarAngsuran(
    @CurrentUser() user: JwtUser,
    @Param('angsuranId') angsuranId: string,
  ) {
    return this.pinjamanService.bayarAngsuran(user, angsuranId);
  }

  // -------------------------------------------------------------
  // 3. RUTE BERDASARKAN ID PARAMETER (:id)
  // -------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Detail pinjaman + jadwal angsuran' })
  @ApiResponse({ status: 200, description: 'Detail pinjaman ditemukan' })
  @ApiResponse({ status: 404, description: 'Pinjaman tidak ditemukan' })
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.pinjamanService.findOne(user, id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.KEPRIM, Role.PIMPINAN)
  @ApiOperation({ summary: 'Ubah status alur persetujuan pinjaman' })
  @ApiResponse({
    status: 200,
    description: 'Status pinjaman berhasil diperbarui',
  })
  @ApiResponse({
    status: 400,
    description: 'Transisi status tidak valid',
  })
  updateStatus(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusPinjamanDto,
  ) {
    return this.pinjamanService.updateStatus(user, id, dto);
  }

  @Post(':id/cairkan')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.JURU_BAYAR)
  @ApiOperation({ summary: 'Cairkan pinjaman & buat jadwal angsuran' })
  @ApiResponse({
    status: 201,
    description: 'Pinjaman berhasil dicairkan',
  })
  @ApiResponse({
    status: 400,
    description: 'Pinjaman belum siap dicairkan / Jadwal sudah ada',
  })
  cairkan(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto?: CairkanPinjamanDto,
  ) {
    return this.pinjamanService.cairkan(user, id, dto);
  }

  @Post(':id/pelunasan-dipercepat')
  @Roles(Role.ADMIN_KOPERASI, Role.BENDAHARA, Role.JURU_BAYAR)
  @ApiOperation({ summary: 'Pelunasan dipercepat untuk sisa seluruh angsuran' })
  @ApiResponse({
    status: 200,
    description: 'Pelunasan dipercepat berhasil diproses',
  })
  @ApiResponse({
    status: 400,
    description: 'Pinjaman belum dicairkan / sisa pokok 0',
  })
  pelunasanDipercepat(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto?: PelunasanDipercepatDto,
  ) {
    return this.pinjamanService.pelunasanDipercepat(user, id, dto);
  }

  @Get(':id/kalkulasi-dinamis')
  @ApiOperation({ summary: 'Kalkulasi dinamis angsuran, sisa pokok, 2x bunga pelunasan, toleransi 2 bulan & status blacklist' })
  @ApiResponse({ status: 200, description: 'Rincian kalkulasi dinamis' })
  getKalkulasiDinamis(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.pinjamanService.getKalkulasiDinamis(user, id);
  }

  @Post(':id/bayar-dinamis')
  @ApiOperation({ summary: 'Bayar angsuran dinamis (prioritas bunga, sisa ke pokok, opsi 2x bunga pelunasan)' })
  @ApiResponse({ status: 200, description: 'Pembayaran angsuran dinamis berhasil diproses' })
  bayarDinamis(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: BayarAngsuranDinamisDto,
  ) {
    return this.pinjamanService.bayarDinamis(user, id, dto);
  }
}
