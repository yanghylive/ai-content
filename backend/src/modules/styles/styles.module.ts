import { Module } from '@nestjs/common';
import { StylesService } from './styles.service';
import { StylesController } from './styles.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContentStrategiesModule } from '../content-strategies/content-strategies.module';

@Module({
  imports: [PrismaModule, ContentStrategiesModule],
  controllers: [StylesController],
  providers: [StylesService],
})
export class StylesModule {}
