import { Module } from '@nestjs/common';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

/**
 * 统一互动契约模块。一期只提供注册表（按平台注册/查询互动 adapter），
 * 现有执行器的适配（实现 InteractionAdapter）为渐进迁移。
 */
@Module({
  providers: [InteractionAdapterRegistry],
  exports: [InteractionAdapterRegistry],
})
export class InteractionModule {}
