import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @MinLength(6, { message: 'Password minimal 6 karakter' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&._-]{6,30}$/, {
    message:
      'Password harus mengandung kombinasi huruf besar, huruf kecil, dan angka (minimal 6-12 karakter).',
  })
  password!: string;

  @IsString()
  @IsNotEmpty()
  namaLengkap!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  kotamaId?: string;

  @IsOptional()
  @IsString()
  satminkalId?: string;

  @IsOptional()
  @IsString()
  pangkatId?: string;

  @IsOptional()
  @IsString()
  korpsId?: string;

  @IsOptional()
  @IsString()
  nrpNip?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
