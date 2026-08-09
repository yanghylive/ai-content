import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

/**
 * 记忆层模块（B4，主文档 3.5）
 * 当前为本地模式（UserMemory 表轻量抽取/召回）；MemoryCore 容器部署后在此扩展远端能力。
 */
@Module({
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
