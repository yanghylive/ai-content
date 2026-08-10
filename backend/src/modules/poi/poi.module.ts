import { Module } from '@nestjs/common';
import { PoiController } from './poi.controller';
import { PoiService } from './poi.service';

/**
 * 门店 POI 数据层（对标炼刀 /poi）：本地生活门店点位管理
 */
@Module({
  controllers: [PoiController],
  providers: [PoiService],
  exports: [PoiService],
})
export class PoiModule {}
