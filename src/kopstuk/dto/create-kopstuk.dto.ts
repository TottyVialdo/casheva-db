import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateKopstukDto {
  @IsOptional()
  @IsString()
  satminkalId?: string;

  @IsOptional()
  @IsString()
  namaSatuan?: string;

  @IsOptional()
  @IsString()
  namaBalak?: string;

  @IsOptional()
  @IsString()
  baris1?: string;

  @IsOptional()
  @IsString()
  baris2?: string;

  @IsOptional()
  @IsString()
  baris3?: string;

  @IsOptional()
  @IsString()
  alamat?: string;

  @IsOptional()
  @IsString()
  nomorTelepon?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  garisGanda?: boolean;

  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;
}
