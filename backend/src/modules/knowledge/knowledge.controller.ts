import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  KnowledgeService,
  type UploadBrandKnowledgeInput,
} from './knowledge.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  private requireUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return request.authUser;
  }

  /** 上传品牌/产品知识条目（文本直接提交） */
  @Post('upload')
  upload(
    @Req() request: AuthenticatedRequest,
    @Body() input: UploadBrandKnowledgeInput,
  ) {
    return this.knowledge.upload(this.requireUser(request), input);
  }

  /** 知识库列表（可按类型过滤） */
  @Get('list')
  list(@Req() request: AuthenticatedRequest, @Query('type') type?: string) {
    return this.knowledge.list(this.requireUser(request), {
      type: type?.trim() || undefined,
    });
  }

  /** 删除知识条目 */
  @Delete(':id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.knowledge.remove(this.requireUser(request), id);
  }

  /** 按选题召回知识（供前端预检 / AI 工具内部调用，仅调试用） */
  @Get('recall')
  recall(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const query = q?.trim() || '';
    if (!query) return [];
    return this.knowledge.recall(
      this.requireUser(request),
      query,
      limit ? Number(limit) : undefined,
    );
  }
}
