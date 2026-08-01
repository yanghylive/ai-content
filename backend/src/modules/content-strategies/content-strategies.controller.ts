import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ContentStrategiesService,
  type ContentStrategyPayload,
} from './content-strategies.service';

@Controller('content-strategies')
export class ContentStrategiesController {
  constructor(
    private readonly contentStrategiesService: ContentStrategiesService,
  ) {}

  @Get()
  findAll() {
    return this.contentStrategiesService.findAll();
  }

  @Get('default')
  getDefault() {
    return this.contentStrategiesService.getDefaultStrategy();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contentStrategiesService.findOne(id);
  }

  @Post()
  create(@Body() dto: ContentStrategyPayload) {
    return this.contentStrategiesService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<ContentStrategyPayload>,
  ) {
    return this.contentStrategiesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentStrategiesService.remove(id);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string) {
    return this.contentStrategiesService.setDefault(id);
  }
}
