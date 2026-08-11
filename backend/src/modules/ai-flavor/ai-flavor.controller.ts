import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeFlavorService } from './de-flavor.service';
import { detectAIFlavor } from './ai-flavor-detector';

@ApiTags('去 AI 味')
@Controller('ai-flavor')
export class AiFlavorController {
  constructor(private readonly deFlavorService: DeFlavorService) {}

  @Post('detect')
  @ApiOperation({ summary: 'AI 味检测（规则评分 0-100）' })
  detect(@Body() dto: { text: string }) {
    return detectAIFlavor(dto?.text || '');
  }

  @Post('de-flavor')
  @ApiOperation({ summary: '去 AI 味改写（检测 → LLM 改写 → 复检）' })
  deFlavor(@Body() dto: { text: string }) {
    return this.deFlavorService.deFlavor(dto?.text || '');
  }
}
