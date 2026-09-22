import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TajukTtdService } from './tajuk-ttd.service';
import { CreateTajukTtdDto } from './dto/create-tajuk-ttd.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role, TajukTandaTangan } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtUser } from 'src/common/interfaces/jwt-user.interface';

@ApiTags('Tajuk TTD')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('tajuk-ttd')
export class TajukTtdController {
  constructor(private readonly tajukTtdService: TajukTtdService) {}

  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
  )
  @ApiOperation({ summary: 'Buat tajuk tanda tangan baru' })
  @Post()
  async create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateTajukTtdDto,
  ): Promise<TajukTandaTangan> {
    return await this.tajukTtdService.create(user, dto);
  }

  @ApiOperation({ summary: 'Daftar semua tajuk tanda tangan sesuai Satminkal session' })
  @Get()
  async findAll(@CurrentUser() user: JwtUser): Promise<TajukTandaTangan[]> {
    return await this.tajukTtdService.findAll(user);
  }

  @ApiOperation({ summary: 'Daftar tajuk tanda tangan aktif' })
  @Get('active')
  async findActive(
    @CurrentUser() user: JwtUser,
    @Query('kategori') kategori?: string,
  ): Promise<TajukTandaTangan[]> {
    return await this.tajukTtdService.findActive(user, kategori);
  }

  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
    Role.BENDAHARA,
  )
  @ApiOperation({ summary: 'Update tajuk tanda tangan' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateTajukTtdDto>,
  ): Promise<TajukTandaTangan> {
    return await this.tajukTtdService.update(id, dto);
  }

  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN_KOTAMA,
    Role.ADMIN_SATMINKAL,
    Role.ADMIN_KOPERASI,
  )
  @ApiOperation({ summary: 'Hapus tajuk tanda tangan' })
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<TajukTandaTangan> {
    return await this.tajukTtdService.delete(id);
  }
}
