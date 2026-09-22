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
import { KotamaService } from './kotama.service';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@ApiTags('Master — Kotama')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('master/kotama')
export class KotamaController {
  constructor(private readonly kotamaService: KotamaService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar Kotama (tb_kotama)' })
  @ApiQuery({ name: 'all', required: false, type: Boolean })
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('all') all?: string,
  ) {
    return this.kotamaService.findAll(user, all === 'true');
  }

  @Get(':kode')
  @ApiOperation({ summary: 'Detail Kotama beserta Satminkal' })
  @ApiParam({ name: 'kode', example: '02' })
  async findByKode(@Param('kode') kode: string) {
    const row = await this.kotamaService.findByKode(kode);
    if (!row) {
      throw new NotFoundException(`Kotama dengan kode ${kode} tidak ditemukan`);
    }
    return row;
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Tambah Kotama/Balakpus baru (Super Admin)' })
  create(@Body() body: { kode: string; nama: string; tipe?: string }) {
    return this.kotamaService.create(body);
  }

  @Post('with-admin')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Tambah Kotama/Balakpus baru beserta Admin (Super Admin)' })
  createWithAdmin(
    @Body()
    body: {
      kode: string;
      nama: string;
      tipe?: string;
      adminUsername: string;
      adminPassword: string;
      adminNamaLengkap: string;
    },
  ) {
    return this.kotamaService.createWithAdmin(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update Kotama/Balakpus (Super Admin)' })
  update(
    @Param('id') id: string,
    @Body() body: { nama?: string; tipe?: string; status?: boolean },
  ) {
    return this.kotamaService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Nonaktifkan Kotama/Balakpus (Super Admin)' })
  remove(@Param('id') id: string) {
    return this.kotamaService.remove(id);
  }
}
