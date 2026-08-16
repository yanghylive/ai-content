/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Patch,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { StylesService } from './styles.service';

@Controller('styles')
export class StylesController {
  constructor(private readonly stylesService: StylesService) {}

  @Post()
  create(
    @Body()
    createStyleDto: {
      name: string;
      description?: string;
      promptTemplate: string;
      isDefault?: boolean;
      type?: string;
      parameters?: Record<string, any>;
    },
  ) {
    return this.stylesService.create(createStyleDto);
  }

  @Get()
  findAll(@Req() request: Request) {
    const type =
      typeof request.query.type === 'string' ? request.query.type : undefined;
    return this.stylesService.findAll(type);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stylesService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body()
    updateStyleDto: {
      name?: string;
      description?: string;
      promptTemplate?: string;
      isDefault?: boolean;
      type?: string;
      parameters?: Record<string, any>;
    },
  ) {
    return this.stylesService.update(id, updateStyleDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stylesService.remove(id);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string) {
    return this.stylesService.setDefault(id);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.stylesService.listVersions(id);
  }

  @Post(':id/rollback')
  rollback(
    @Param('id') id: string,
    @Body() body: { versionNo: number },
  ) {
    return this.stylesService.rollback(id, body.versionNo);
  }
}
