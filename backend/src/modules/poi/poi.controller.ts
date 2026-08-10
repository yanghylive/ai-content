import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PoiService } from './poi.service';

/**
 * 门店 POI（对标炼刀 /poi 5 端点：create / edit / pages / delete / report）
 * 本地生活门店点位管理；report 输出按城市/分类聚合 + 探店统计。
 */
@Controller('poi')
export class PoiController {
  constructor(private readonly poi: PoiService) {}

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      address?: string;
      city?: string;
      category?: string;
      poiId?: string;
      lng?: number;
      lat?: number;
      tags?: string;
      note?: string;
    },
  ) {
    const scope = await this.poi.resolveScope();
    return this.poi.create({ ...scope, ...body });
  }

  @Patch(':id')
  async edit(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      address?: string;
      city?: string;
      category?: string;
      poiId?: string;
      lng?: number;
      lat?: number;
      tags?: string;
      status?: string;
      note?: string;
    },
  ) {
    const scope = await this.poi.resolveScope();
    return this.poi.update(id, { ...scope, ...body });
  }

  @Get()
  async pages(
    @Query('city') city?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const scope = await this.poi.resolveScope();
    return this.poi.list({
      ...scope,
      city,
      category,
      status,
      keyword,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('report')
  async report() {
    const scope = await this.poi.resolveScope();
    return this.poi.report(scope);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const scope = await this.poi.resolveScope();
    return this.poi.remove(id, scope);
  }
}
