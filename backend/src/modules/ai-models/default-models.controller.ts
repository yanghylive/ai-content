import { Controller, Get, Put, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DefaultModelsService } from './default-models.service';
import { UpdateDefaultsDto } from './dto/update-defaults.dto';

@ApiTags('默认模型配置')
@Controller('ai-models/defaults')
export class DefaultModelsController {
  constructor(private readonly service: DefaultModelsService) {}

  @Get()
  @ApiOperation({ summary: '获取默认模型配置' })
  getDefaults() {
    return this.service.getDefaults();
  }

  @Put()
  @ApiOperation({ summary: '更新默认模型配置' })
  updateDefaults(@Body() dto: UpdateDefaultsDto) {
    return this.service.updateDefaults(dto);
  }
}
