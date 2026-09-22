import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(
  Role.SUPER_ADMIN,
  Role.ADMIN_KOTAMA,
  Role.ADMIN_SATMINKAL,
  Role.ADMIN_KOPERASI,
)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Buat user baru' })
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @ApiOperation({ summary: 'Daftar semua user' })
  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.usersService.findAll(user);
  }

  @ApiOperation({ summary: 'Status realtime online/offline seluruh user' })
  @Get('realtime-status')
  getRealtimeStatus(@CurrentUser() user: JwtUser) {
    return this.usersService.getRealtimeStatus(user);
  }

  @ApiOperation({ summary: 'Daftar sesi user yang sedang aktif' })
  @Get('active-sessions')
  getActiveSessions(@CurrentUser() user: JwtUser) {
    return this.usersService.getActiveSessions(user);
  }

  @ApiOperation({ summary: 'Ubah role user secara dinamis (Admin)' })
  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body('role') role: Role) {
    return this.usersService.updateRole(id, role);
  }

  @ApiOperation({ summary: 'Akhiri sesi user tertentu (Admin)' })
  @Post('terminate-session/:id')
  terminateSession(@Param('id') id: string) {
    return this.usersService.terminateSession(id);
  }

  @ApiOperation({ summary: 'Detail user by ID' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Update user' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @ApiOperation({ summary: 'Nonaktifkan user (Soft Delete)' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}

