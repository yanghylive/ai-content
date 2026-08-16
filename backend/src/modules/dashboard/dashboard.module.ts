import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { VideoWorkshopModule } from '../video-workshop/video-workshop.module';

@Module({
  imports: [VideoWorkshopModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
