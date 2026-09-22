import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { SatminkalService } from './satminkal.service';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@ApiTags('Master — Satminkal (Satker)')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('master/satminkal')
export class SatminkalController {
  constructor(private readonly satminkalService: SatminkalService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar Satminkal / tb_satker' })
  @ApiQuery({
    name: 'kotamaKode',
    required: false,
    description: 'Filter berdasarkan kd_Kotama',
    example: '02',
  })
  @ApiQuery({ name: 'all', required: false, type: Boolean })
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('kotamaKode') kotamaKode?: string,
    @Query('all') all?: string,
  ) {
    return this.satminkalService.findAll(user, kotamaKode, all === 'true');
  }

  @Get(':kode')
  @ApiOperation({ summary: 'Detail Satminkal by kd_Satker' })
  @ApiParam({ name: 'kode', example: '684672' })
  async findByKode(@Param('kode') kode: string) {
    const row = await this.satminkalService.findByKode(kode);
    if (!row) {
      throw new NotFoundException(
        `Satminkal dengan kode ${kode} tidak ditemukan`,
      );
    }
    return row;
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN_KOTAMA)
  @ApiOperation({ summary: 'Tambah Satminkal baru (Super Admin / Admin Kotama)' })
  create(@Body() body: { kode: string; nama: string; kotamaId: string }) {
    return this.satminkalService.create(body);
  }

  @Post('with-admin')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Tambah Satminkal baru beserta Admin (Super Admin)' })
  createWithAdmin(
    @Body()
    body: {
      kode: string;
      nama: string;
      kotamaId: string;
      adminUsername: string;
      adminPassword: string;
      adminNamaLengkap: string;
    },
  ) {
    return this.satminkalService.createWithAdmin(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN_KOTAMA)
  @ApiOperation({ summary: 'Update Satminkal (Super Admin / Admin Kotama)' })
  update(
    @Param('id') id: string,
    @Body() body: { nama?: string; kotamaId?: string; status?: boolean },
  ) {
    return this.satminkalService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN_KOTAMA)
  @ApiOperation({ summary: 'Nonaktifkan Satminkal (Super Admin / Admin Kotama)' })
  remove(@Param('id') id: string) {
    return this.satminkalService.remove(id);
  }
}
