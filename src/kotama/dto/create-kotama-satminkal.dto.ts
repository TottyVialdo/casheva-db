import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKotamaSatminkalDto {
  @ApiProperty({ description: 'Kode Satminkal (contoh: 07.05 / 25.04)' })
  @IsString()
  @IsNotEmpty()
  kode: string;

  @ApiProperty({ description: 'Nama Satminkal (contoh: POMDAM IV/DIPONEGORO)' })
  @IsString()
  @IsNotEmpty()
  nama: string;

  @ApiPropertyOptional({ description: 'Username untuk Admin Satminkal baru' })
  @IsOptional()
  @IsString()
  adminUsername?: string;

  @ApiPropertyOptional({ description: 'Password untuk Admin Satminkal baru' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  adminPassword?: string;

  @ApiPropertyOptional({ description: 'Nama Lengkap Admin Satminkal' })
  @IsOptional()
  @IsString()
  adminNamaLengkap?: string;

  @ApiPropertyOptional({ description: 'NRP / NIP Admin Satminkal' })
  @IsOptional()
  @IsString()
  adminNrpNip?: string;
}

export class UpdateKotamaSatminkalDto {
  @ApiPropertyOptional({ description: 'Nama Satminkal' })
  @IsOptional()
  @IsString()
  nama?: string;

  @ApiPropertyOptional({ description: 'Status aktif' })
  @IsOptional()
  status?: boolean;
}

export class StartMonitoringDto {
  @ApiProperty({ description: 'ID Satminkal yang akan dimonitor' })
  @IsString()
  @IsNotEmpty()
  satminkalId: string;

  @ApiPropertyOptional({ description: 'Catatan monitoring' })
  @IsOptional()
  @IsString()
  catatan?: string;
}

export class StartKotamaMonitoringDto {
  @ApiProperty({ description: 'ID Kotama yang akan dimonitor' })
  @IsString()
  @IsNotEmpty()
  kotamaId: string;

  @ApiPropertyOptional({ description: 'Catatan monitoring' })
  @IsOptional()
  @IsString()
  catatan?: string;
}

