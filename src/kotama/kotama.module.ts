import { Module } from '@nestjs/common';
import { KotamaService } from './kotama.service';
import { KotamaController } from './kotama.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [KotamaController],
  providers: [KotamaService],
  exports: [KotamaService],
})
export class KotamaModule {}
