import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageConfigController } from './storage-config.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StorageConfigController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
