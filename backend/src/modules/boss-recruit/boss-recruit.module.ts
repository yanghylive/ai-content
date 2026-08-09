import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlaywrightBrowserRuntimeService } from '../local-engine/playwright-browser-runtime.service';
import { BossRecruitController } from './boss-recruit.controller';
import { BossRecruitService } from './boss-recruit.service';
import { BossPlaywrightClient } from './boss-recruit.playwright.client';

@Module({
  imports: [PrismaModule],
  controllers: [BossRecruitController],
  providers: [BossRecruitService, BossPlaywrightClient, PlaywrightBrowserRuntimeService],
  exports: [BossRecruitService],
})
export class BossRecruitModule {}
