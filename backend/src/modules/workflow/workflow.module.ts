// 工作流模块（Sprint 3 action-contract/approval-gate + Sprint 5 approval 端点挂载）
// 审批中心：高风险动作（首次私信/批量评论/批量触达/商机阶段变化）强制人工审批。
import { Module } from '@nestjs/common';
import { ApprovalGateService } from './approval-gate.service';
import { ApprovalController } from './approval.controller';

@Module({
  controllers: [ApprovalController],
  providers: [ApprovalGateService],
  exports: [ApprovalGateService],
})
export class WorkflowModule {}
