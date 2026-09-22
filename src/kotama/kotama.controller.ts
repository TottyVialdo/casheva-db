import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { KotamaService } from './kotama.service';
import {
  CreateKotamaSatminkalDto,
  StartMonitoringDto,
  StartKotamaMonitoringDto,
  UpdateKotamaSatminkalDto,
} from './dto/create-kotama-satminkal.dto';
import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Admin Kotama / Balakpus')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('kotama')
export class KotamaController {
  constructor(private readonly kotamaService: KotamaService) {}

  @Get('dashboard/summary')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Ringkasan Dashboard Agregat Kotama' })
  @ApiQuery({ name: 'kotamaId', required: false, type: String })
  getDashboardSummary(
    @CurrentUser() user: JwtUser,
    @Query('kotamaId') kotamaId?: string,
  ) {
    return this.kotamaService.getSummary(user, kotamaId);
  }

  @Get('dashboard/charts')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Grafik Bulanan Agregat Kotama (Simpanan, Pinjaman, Angsuran)' })
  @ApiQuery({ name: 'tahun', required: false, type: Number })
  @ApiQuery({ name: 'kotamaId', required: false, type: String })
  getDashboardCharts(
    @CurrentUser() user: JwtUser,
    @Query('tahun') tahun?: string,
    @Query('kotamaId') kotamaId?: string,
  ) {
    const t = tahun ? parseInt(tahun, 10) : undefined;
    return this.kotamaService.getCharts(user, t, kotamaId);
  }

  @Get('satminkal')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Daftar Satminkal di bawah Kotama beserta status admin realtime' })
  @ApiQuery({ name: 'kotamaId', required: false, type: String })
  getSatminkalList(
    @CurrentUser() user: JwtUser,
    @Query('kotamaId') kotamaId?: string,
  ) {
    return this.kotamaService.getSatminkalList(user, kotamaId);
  }

  @Post('satminkal')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Tambah Satminkal baru di bawah Kotama (+ Akun Admin Satminkal)' })
  createSatminkal(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateKotamaSatminkalDto,
  ) {
    return this.kotamaService.createSatminkal(user, dto);
  }

  @Patch('satminkal/:id')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Perbarui data Satminkal' })
  updateSatminkal(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateKotamaSatminkalDto,
  ) {
    return this.kotamaService.updateSatminkal(user, id, dto);
  }

  @Post('monitoring/start')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Mulai sesi monitoring Satminkal (Mode Tamu / Read-Only)' })
  startMonitoring(
    @CurrentUser() user: JwtUser,
    @Body() dto: StartMonitoringDto,
  ) {
    return this.kotamaService.startMonitoring(user, dto.satminkalId, dto.catatan);
  }

  @Post('monitoring/end')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Selesaikan sesi monitoring Satminkal' })
  endMonitoring(
    @CurrentUser() user: JwtUser,
    @Body() dto: StartMonitoringDto,
  ) {
    return this.kotamaService.endMonitoring(user, dto.satminkalId);
  }

  @Get('monitoring/active/:satminkalId')
  @ApiOperation({ summary: 'Cek sesi monitoring aktif untuk notifikasi realtime Satminkal' })
  getActiveMonitoring(@Param('satminkalId') satminkalId: string) {
    return this.kotamaService.getActiveMonitoringForSatminkal(satminkalId);
  }

  @Post('monitoring/kotama/start')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Mulai sesi monitoring Komando Utama oleh Super Admin (Mode Tamu / Read-Only)' })
  startKotamaMonitoring(
    @CurrentUser() user: JwtUser,
    @Body() dto: StartKotamaMonitoringDto,
  ) {
    return this.kotamaService.startKotamaMonitoring(user, dto.kotamaId, dto.catatan);
  }

  @Post('monitoring/kotama/end')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Selesaikan sesi monitoring Komando Utama oleh Super Admin' })
  endKotamaMonitoring(
    @CurrentUser() user: JwtUser,
    @Body() dto: StartKotamaMonitoringDto,
  ) {
    return this.kotamaService.endKotamaMonitoring(user, dto.kotamaId);
  }

  @Get('monitoring/kotama/active/:kotamaId')
  @ApiOperation({ summary: 'Cek sesi monitoring aktif untuk notifikasi realtime Admin Kotama' })
  getActiveKotamaMonitoring(@Param('kotamaId') kotamaId: string) {
    return this.kotamaService.getActiveMonitoringForKotama(kotamaId);
  }

  @Get('audit-logs')
  @Roles(Role.ADMIN_KOTAMA, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Daftar Audit Log aktivitas Kotama' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getAuditLogs(
    @CurrentUser() user: JwtUser,
    @Query('limit') limit?: string,
  ) {
    const l = limit ? parseInt(limit, 10) : 50;
    return this.kotamaService.getAuditLogs(user, l);
  }
}
