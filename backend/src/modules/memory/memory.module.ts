import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { KaypalMemoryService } from './memory-kaypal.service';
import { MemoryController } from './memory.controller';

/**
 * 记忆层模块（B4，主文档 3.5）
 * 本地模式（UserMemory 表轻量抽取/召回）+ MemoryCore 远端（可选）。
 * 2026-08-20 新增 KaypalMemoryService：用户级长期记忆补充通道（kaypal.cn 统一记忆系统）。
 */
@Module({
  controllers: [MemoryController],
  providers: [MemoryService, KaypalMemoryService],
  exports: [MemoryService, KaypalMemoryService],
})
export class MemoryModule {}
