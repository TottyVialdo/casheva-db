import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/interfaces/jwt-user.interface';

@ApiTags('Autentikasi & Session')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Login Pengurus / Pimpinan' })
  @ApiResponse({
    status: 200,
    description:
      'Login berhasil dan mengembalikan token JWT berserta session Kotama/Satminkal.',
  })
  @ApiResponse({ status: 401, description: 'Kredensial tidak valid.' })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    try {
      return await this.authService.login(dto);
    } catch (err: any) {
      console.error('--- AUTH LOGIN ERROR ---', err);
      throw err;
    }
  }

  @ApiOperation({ summary: 'Mendapatkan profil & session user aktif' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  getProfile(@CurrentUser() user: JwtUser) {
    return this.authService.getProfile(user);
  }

  @ApiOperation({ summary: 'Periksa status session aktif (Heartbeat single-device)' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(AuthGuard('jwt'))
  @Get('session-check')
  checkSession(@CurrentUser() user: JwtUser) {
    return { valid: true, userId: user.userId, username: user.username };
  }

  @ApiOperation({ summary: 'Logout & Invalidasi Session Token' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@CurrentUser() user: JwtUser) {
    await this.authService.logout(user.userId);
    return { message: 'Logout berhasil, sesi telah dihapus.' };
  }
}
