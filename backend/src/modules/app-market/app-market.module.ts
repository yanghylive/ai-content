import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AppMarketController } from './app-market.controller';
import { AppMarketService } from './app-market.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [AppMarketController],
  providers: [AppMarketService],
  exports: [AppMarketService],
})
export class AppMarketModule {}
