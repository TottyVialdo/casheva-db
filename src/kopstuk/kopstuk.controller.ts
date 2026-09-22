import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KopstukService } from './kopstuk.service';
import { CreateKopstukDto } from './dto/create-kopstuk.dto';
import { Role } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtUser } from 'src/common/interfaces/jwt-user.interface';

@ApiTags('Kopstuk')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('kopstuk')
export class KopstukController {
  constructor(private readonly kopstukService: KopstukService) {}

  @ApiOperation({ summary: 'Ambil kopstuk untuk Satminkal / Kotama user session' })
  @Get()
  async getActiveKopstuk(
    @CurrentUser() user: JwtUser,
    @Query('satminkalId') satminkalId?: string,
  ) {
    if (satminkalId) {
      return this.kopstukService.getBySatminkal(satminkalId);
    }
    if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      return this.kopstukService.getByKotama(user.kotamaId);
    }
    return this.kopstukService.getBySatminkal(user.satminkalId, user.kotamaId || undefined);
  }

  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
  )
  @ApiOperation({ summary: 'Simpan kopstuk untuk Satminkal / Kotama user session' })
  @Post()
  async saveActiveKopstuk(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateKopstukDto,
  ) {
    if (dto.satminkalId) {
      return this.kopstukService.upsertBySatminkal(dto.satminkalId, dto);
    }
    if (user.role === Role.ADMIN_KOTAMA && user.kotamaId) {
      return this.kopstukService.upsertByKotama(user.kotamaId, dto);
    }
    if (user.satminkalId) {
      return this.kopstukService.upsertBySatminkal(user.satminkalId, dto);
    }
    throw new Error('Satminkal ID atau Kotama ID tidak ditemukan');
  }

  @ApiOperation({ summary: 'Ambil kopstuk spesifik berdasarkan satminkalId' })
  @Get(':satminkalId')
  async getKopstuk(@Param('satminkalId') satminkalId: string) {
    return this.kopstukService.getBySatminkal(satminkalId);
  }

  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
  )
  @ApiOperation({ summary: 'Simpan kopstuk spesifik berdasarkan satminkalId' })
  @Post(':satminkalId')
  async saveKopstuk(
    @Param('satminkalId') satminkalId: string,
    @Body() dto: CreateKopstukDto,
  ) {
    return this.kopstukService.upsertBySatminkal(satminkalId, dto);
  }
}
