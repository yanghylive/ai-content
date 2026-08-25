import { Approval } from './types';
import { makeError } from '../contracts/error-codes';
import { genId, hashJson, nowIso } from './util';

/**
 * 审批服务 —— 对齐《整合 PRD》8.1 approval_required / 《补充包》3.2/3.4。
 * 确认必须绑定预览 hash；预览变化后失效；过期后不可确认。
 */
export class ApprovalService {
  private store = new Map<string, Approval>();

  /** 计算待确认内容的预览哈希（规范化 JSON） */
  static previewHashOf(preview: unknown): string {
    return hashJson(preview);
  }

  create(
    taskId: string,
    toolCallId: string,
    preview: unknown,
    ttlMs: number,
    nowMs = Date.now(),
  ): Approval {
    const approval: Approval = {
      id: genId('apr'),
      taskId,
      toolCallId,
      previewHash: ApprovalService.previewHashOf(preview),
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      status: 'pending',
      consumed: false,
      createdAt: nowIso(),
    };
    this.store.set(approval.id, approval);
    return approval;
  }

  get(id: string): Approval | undefined {
    return this.store.get(id);
  }

  /**
   * 校验确认：先绑定校验（taskId/toolCallId 必须匹配当前请求），再过期/预览校验，
   * 最后一次性消费。任一项不符 → APPROVAL_MISMATCH / APPROVAL_EXPIRED / PREVIEW_CHANGED。
   */
  validate(
    approvalId: string,
    currentPreview: unknown,
    currentTaskId: string,
    currentToolCallId: string,
    nowMs = Date.now(),
  ): Approval {
    const apr = this.store.get(approvalId);
    if (!apr)
      throw makeError('APPROVAL_MISMATCH', {
        details: { approvalId, reason: '未知审批' },
      });
    if (apr.status === 'rejected') {
      throw makeError('PREVIEW_CHANGED', {
        details: { approvalId, reason: '审批已被拒绝' },
      });
    }
    if (apr.consumed) {
      throw makeError('APPROVAL_MISMATCH', {
        details: { approvalId, reason: '审批已被一次性消费' },
      });
    }
    // 绑定校验：阻止跨任务 / 跨请求复用审批
    if (apr.taskId !== currentTaskId) {
      throw makeError('APPROVAL_MISMATCH', {
        details: {
          approvalId,
          expectedTaskId: apr.taskId,
          gotTaskId: currentTaskId,
        },
      });
    }
    if (apr.toolCallId !== currentToolCallId) {
      throw makeError('APPROVAL_MISMATCH', {
        details: {
          approvalId,
          expectedToolCall: apr.toolCallId,
          gotToolCall: currentToolCallId,
        },
      });
    }
    if (Date.parse(apr.expiresAt) <= nowMs) {
      apr.status = 'expired';
      throw makeError('APPROVAL_EXPIRED', { details: { approvalId } });
    }
    const currentHash = ApprovalService.previewHashOf(currentPreview);
    if (currentHash !== apr.previewHash) {
      throw makeError('PREVIEW_CHANGED', {
        details: {
          approvalId,
          approvedPreviewHash: apr.previewHash,
          currentPreviewHash: currentHash,
        },
      });
    }
    apr.status = 'approved';
    apr.approvedBy = 'user';
    return apr;
  }

  /** 审批通过后调用，置 consumed=true，禁止同一审批 ID 再次使用 */
  consume(approvalId: string): void {
    const apr = this.store.get(approvalId);
    if (apr) apr.consumed = true;
  }

  reject(approvalId: string): Approval {
    const apr = this.store.get(approvalId);
    if (!apr)
      throw makeError('APPROVAL_MISMATCH', {
        details: { approvalId, reason: '未知审批' },
      });
    apr.status = 'rejected';
    return apr;
  }
}
