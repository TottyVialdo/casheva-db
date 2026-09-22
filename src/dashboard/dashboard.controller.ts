import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'))
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Mendapatkan statistik ringkasan dashboard' })
  getSummary(@CurrentUser() user: JwtUser) {
    return this.dashboardService.getSummary(user);
  }

  @Get('charts')
  @ApiOperation({ summary: 'Mendapatkan data grafik bulanan (simpanan, pinjaman, angsuran)' })
  @ApiQuery({ name: 'tahun', required: false, type: Number })
  getCharts(
    @CurrentUser() user: JwtUser,
    @Query('tahun') tahun?: string,
  ) {
    const t = tahun ? parseInt(tahun, 10) : undefined;
    return this.dashboardService.getCharts(user, t);
  }

  @Get('kotama')
  @ApiOperation({ summary: 'Mendapatkan data agregat seluruh Satminkal dalam Kotama' })
  getKotamaSummary(@CurrentUser() user: JwtUser) {
    return this.dashboardService.getKotamaSummary(user);
  }

  @Get('kotama/:kotamaId')
  @ApiOperation({ summary: 'Mendapatkan data agregat Satminkal berdasarkan Kotama ID tertentu' })
  getKotamaSummaryById(
    @CurrentUser() user: JwtUser,
    @Param('kotamaId') kotamaId: string,
  ) {
    return this.dashboardService.getKotamaSummary(user, kotamaId);
  }
}

