import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CloudApiService } from './cloud-api.service';
import type {
  CheckContentInput,
  CheckContentOutput,
  CheckDedupInput,
  CheckDedupOutput,
  GenerateReplyInput,
  GenerateReplyOutput,
  MarkSentInput,
  MarkSentOutput,
} from './cloud-api.service';

/**
 * 企业云端能力代理（P1 安全加固）：
 * 前端不再直连 enterprise.kaypal.cn（不再持有/存储 cloudApiToken），
 * 统一经本控制器同源代理调用，凭据与调用全部收敛在后端。
 */
@ApiTags('云端能力')
@Controller('cloud-api')
export class CloudApiController {
  constructor(private readonly cloudApi: CloudApiService) {}

  @Post('generate-reply')
  @ApiOperation({ summary: 'AI 生成回复（代理企业服务）' })
  generateReply(
    @Body() input: GenerateReplyInput,
  ): Promise<GenerateReplyOutput> {
    return this.cloudApi.generateReply(input);
  }

  @Post('check-content')
  @ApiOperation({ summary: '内容可发送检查（代理企业服务）' })
  checkContent(@Body() input: CheckContentInput): Promise<CheckContentOutput> {
    return this.cloudApi.checkContent(input);
  }

  @Post('check-dedup')
  @ApiOperation({ summary: '去重检查（代理企业服务）' })
  checkDedup(@Body() input: CheckDedupInput): Promise<CheckDedupOutput> {
    return this.cloudApi.checkDedup(input);
  }

  @Post('mark-sent')
  @ApiOperation({ summary: '标记已发送（代理企业服务）' })
  markSent(@Body() input: MarkSentInput): Promise<MarkSentOutput> {
    return this.cloudApi.markSent(input);
  }

  @Get('health')
  @ApiOperation({ summary: '企业服务连通性探活' })
  async health(): Promise<{ ok: boolean; checkedAt: string }> {
    const ok = await this.cloudApi.healthCheck();
    return { ok, checkedAt: new Date().toISOString() };
  }
}
