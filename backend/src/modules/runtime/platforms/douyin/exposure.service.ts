import { Injectable } from '@nestjs/common';
import {
  type ExecutorContext,
  type ExecutorEvidence,
  type ExecutorTask,
  type RuntimeExecutionResult,
  rejectResult,
} from '../../executor.interface';
import type { PlatformInteractionService } from '../platform-interaction.interface';
import { DouyinExposureCollector } from './exposure-collector.service';

type DouyinExposureTaskType =
  | 'douyin-link-exposure'
  | 'douyin-search-account-exposure'
  | 'douyin-hot-video-exposure'
  | 'douyin-targeted-exposure'
  | 'douyin-retention-exposure';

const SUPPORTED_TASK_TYPES: readonly DouyinExposureTaskType[] = [
  'douyin-link-exposure',
  'douyin-search-account-exposure',
  'douyin-hot-video-exposure',
  'douyin-targeted-exposure',
  'douyin-retention-exposure',
] as const;

@Injectable()
export class DouyinExposureService implements PlatformInteractionService {
  readonly platformName = 'douyin';
  readonly taskType = 'douyin-exposure';

  constructor(private readonly collector: DouyinExposureCollector) {}

  canHandle(task: ExecutorTask): boolean {
    return task.platform === 'douyin' && this.isSupportedTaskType(task.type);
  }

  async execute(
    task: ExecutorTask,
    _ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    void _ctx;
    const payload = task.payload as {
      links?: string[];
      searchKeywords?: string[];
      targetAccounts?: string[];
      retentionSourceId?: string;
      filters?: Record<string, unknown>;
      messageTemplates?: string[];
      appendCommentTemplates?: string[];
      exposureExecutionKind?: string;
      exposureMode?: string;
    };

    if (!this.isSupportedTaskType(task.type)) {
      const evidence: ExecutorEvidence[] = [
        this.buildContractEvidence(task, payload),
      ];
      return {
        ok: false,
        status: 'blocked',
        reasonCode: 'not_integrated',
        userMessage:
          '这个入口还没有接入真实读取。请先使用爆款视频获客、链接曝光或搜索账号曝光。',
        technicalMessage: `Unsupported douyin exposure task type: ${task.type}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'browser-cdp',
          engineUrl: 'internal://runtime/douyin-exposure',
        },
        evidence,
      };
    }

    const requestedExecutionKind =
      payload.exposureExecutionKind ||
      (typeof payload.filters?.executionKind === 'string'
        ? payload.filters.executionKind
        : 'candidate_read');
    if (requestedExecutionKind !== 'candidate_read') {
      return {
        ok: false,
        status: 'blocked',
        reasonCode: 'not_integrated',
        userMessage:
          '曝光执行器只读取候选，不会评论、私信或发布。真实客户动作必须交给商业互动执行器。',
        technicalMessage: `Rejected exposureExecutionKind=${requestedExecutionKind} for ${task.type}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'browser-cdp',
          engineUrl: 'internal://runtime/douyin-exposure',
        },
        evidence: [this.buildContractEvidence(task, payload)],
      };
    }

    if (!task.accountId) {
      return rejectResult(
        'account_not_logged_in',
        '抖音曝光任务缺少账号',
        `task=${task.relatedId} type=${task.type} 缺 accountId`,
      );
    }

    const validationError = this.validatePayload(task.type, payload);
    if (validationError) {
      return rejectResult(
        'target_not_found',
        validationError,
        `task=${task.relatedId} type=${task.type} payload=${JSON.stringify(payload)}`,
      );
    }

    const collected = await this.collectReadOnlyExposure(task, payload);
    const evidence: ExecutorEvidence[] = [];
    if (collected.evidence) {
      evidence.push({
        type: 'screenshot',
        label: collected.evidence.label,
        path: collected.evidence.path,
        value: collected.evidence.url,
        createdAt: collected.evidence.capturedAt,
        raw: collected.raw,
      });
    }
    evidence.push(this.buildContractEvidence(task, payload));

    const openedHotVideos = Array.isArray(collected.raw?.openedVideos)
      ? collected.raw.openedVideos
      : [];
    const hasOpenedHotVideos =
      task.type === 'douyin-hot-video-exposure' && openedHotVideos.length > 0;

    if (!collected.ok && !hasOpenedHotVideos) {
      return {
        ok: false,
        status:
          collected.status === 'account_not_logged_in' ||
          collected.status === 'captcha_required'
            ? 'blocked'
            : 'failed',
        reasonCode:
          collected.status === 'account_not_logged_in'
            ? 'account_not_logged_in'
            : collected.status === 'captcha_required'
              ? 'captcha_required'
              : collected.status === 'platform_changed'
                ? 'platform_changed'
                : collected.status === 'target_not_found'
                  ? 'target_not_found'
                  : 'runtime_unavailable',
        userMessage: collected.message,
        technicalMessage: `${task.type} collector status=${collected.status}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'browser-cdp',
          engineUrl: 'internal://runtime/douyin-exposure',
        },
        evidence,
      };
    }

    if (!collected.evidence) {
      return {
        ok: false,
        status: 'failed',
        reasonCode: 'readback_failed',
        userMessage: '候选读取没有生成可核验的页面证据，本次未记为完成。',
        technicalMessage: `${task.type} collector returned no operational evidence`,
        runtime: {
          mode: 'local-runtime',
          executor: 'browser-cdp',
          engineUrl: 'internal://runtime/douyin-exposure',
        },
        evidence,
        readback: {
          expectedText: 'candidate-read-evidence',
          actualText: JSON.stringify(collected.candidates),
          matched: false,
        },
      };
    }

    return {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: collected.message,
      technicalMessage: hasOpenedHotVideos
        ? '抖音爆款视频已读取；未采集到可回复评论时，自动获客会改为视频直评。'
        : '抖音候选内容已读取；本步骤没有执行评论、私信或发布。',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
        engineUrl: 'internal://runtime/douyin-exposure',
      },
      evidence,
      readback: {
        expectedText:
          task.type === 'douyin-link-exposure'
            ? 'candidate-comments'
            : task.type === 'douyin-hot-video-exposure'
              ? 'candidate-hot-videos'
              : task.type === 'douyin-targeted-exposure'
                ? 'candidate-targeted-results'
                : task.type === 'douyin-retention-exposure'
                  ? 'candidate-retention-results'
                  : 'candidate-search-results',
        actualText: JSON.stringify(collected.candidates),
        matched: true,
      },
    };
  }

  private buildContractEvidence(
    task: ExecutorTask,
    payload: {
      links?: string[];
      searchKeywords?: string[];
      targetAccounts?: string[];
      retentionSourceId?: string;
      filters?: Record<string, unknown>;
      messageTemplates?: string[];
      appendCommentTemplates?: string[];
      exposureExecutionKind?: string;
      exposureMode?: string;
    },
  ): ExecutorEvidence {
    return {
      type: 'text',
      label: 'douyin-exposure-runtime-contract',
      value: JSON.stringify({
        taskType: task.type,
        executionKind: 'candidate_read',
        requestedExecutionKind:
          payload.exposureExecutionKind ??
          (typeof payload.filters?.executionKind === 'string'
            ? payload.filters.executionKind
            : 'candidate_read'),
        exposureMode: payload.exposureMode ?? '',
        platformAction: false,
        accountId: task.accountId,
        filters: payload.filters ?? {},
        linkCount: payload.links?.length ?? 0,
        searchKeywordCount: payload.searchKeywords?.length ?? 0,
        hotVideoMode: task.type === 'douyin-hot-video-exposure',
        targetedMode: task.type === 'douyin-targeted-exposure',
        retentionMode: task.type === 'douyin-retention-exposure',
        targetAccountCount: payload.targetAccounts?.length ?? 0,
        retentionSourceId: payload.retentionSourceId ?? '',
        messageTemplateCount: payload.messageTemplates?.length ?? 0,
        appendCommentTemplateCount: payload.appendCommentTemplates?.length ?? 0,
      }),
      createdAt: new Date().toISOString(),
    };
  }

  private isSupportedTaskType(
    taskType: ExecutorTask['type'],
  ): taskType is DouyinExposureTaskType {
    return SUPPORTED_TASK_TYPES.includes(taskType as DouyinExposureTaskType);
  }

  private async collectReadOnlyExposure(
    task: ExecutorTask,
    payload: {
      links?: string[];
      searchKeywords?: string[];
      filters?: Record<string, unknown>;
      targetAccounts?: string[];
      retentionSourceId?: string;
    },
  ) {
    const commentLimit = Number(payload.filters?.commentLimit ?? 20);
    const resultLimit = Number(
      payload.filters?.resultLimit ?? payload.filters?.commentLimit ?? 20,
    );

    if (task.type === 'douyin-link-exposure') {
      return this.collector.collectFromLinks({
        accountId: task.accountId as string | number,
        links: payload.links ?? [],
        limit:
          Number.isFinite(commentLimit) && commentLimit > 0 ? commentLimit : 20,
        filters: payload.filters,
      });
    }

    if (task.type === 'douyin-hot-video-exposure') {
      return this.collector.collectHotVideos({
        accountId: task.accountId as string | number,
        searchKeywords: payload.searchKeywords ?? [],
        limit:
          Number.isFinite(resultLimit) && resultLimit > 0 ? resultLimit : 20,
        filters: payload.filters,
      });
    }

    if (task.type === 'douyin-targeted-exposure') {
      return this.collector.collectTargetedComments({
        accountId: task.accountId as string | number,
        searchKeywords: this.normalizeTargetedSearchKeywords(payload),
        limit:
          Number.isFinite(resultLimit) && resultLimit > 0 ? resultLimit : 20,
        filters: {
          ...(payload.filters ?? {}),
          targetedMode: true,
          targetAccounts: payload.targetAccounts ?? [],
        },
      });
    }

    if (task.type === 'douyin-retention-exposure') {
      return this.collector.collectRetentionCandidates({
        accountId: task.accountId as string | number,
        searchKeywords: this.normalizeRetentionSearchKeywords(payload),
        retentionSourceId: payload.retentionSourceId,
        limit:
          Number.isFinite(resultLimit) && resultLimit > 0 ? resultLimit : 20,
        filters: {
          ...(payload.filters ?? {}),
          retentionMode: true,
          retentionSourceId: payload.retentionSourceId ?? '',
        },
      });
    }

    return this.collector.collectFromSearch({
      accountId: task.accountId as string | number,
      searchKeywords: payload.searchKeywords ?? [],
      limit: Number.isFinite(resultLimit) && resultLimit > 0 ? resultLimit : 20,
      filters: payload.filters,
    });
  }

  private validatePayload(
    taskType: ExecutorTask['type'],
    payload: {
      links?: string[];
      searchKeywords?: string[];
      targetAccounts?: string[];
      retentionSourceId?: string;
    },
  ): string | null {
    if (
      taskType === 'douyin-link-exposure' &&
      (!Array.isArray(payload.links) || payload.links.length === 0)
    ) {
      return '抖音链接曝光至少需要一条视频链接';
    }
    if (
      (taskType === 'douyin-search-account-exposure' ||
        taskType === 'douyin-hot-video-exposure') &&
      (!Array.isArray(payload.searchKeywords) ||
        payload.searchKeywords.length === 0)
    ) {
      return taskType === 'douyin-hot-video-exposure'
        ? '抖音爆款视频获客至少需要一个行业关键词'
        : '抖音搜索账号曝光至少需要一个搜索关键词';
    }
    if (
      taskType === 'douyin-targeted-exposure' &&
      (!Array.isArray(payload.targetAccounts) ||
        payload.targetAccounts.length === 0)
    ) {
      return '抖音定向曝光至少需要一个目标账号';
    }
    if (
      taskType === 'douyin-retention-exposure' &&
      !payload.retentionSourceId
    ) {
      return '抖音留资曝光至少需要一个线索来源';
    }
    return null;
  }

  private normalizeTargetedSearchKeywords(payload: {
    searchKeywords?: string[];
    targetAccounts?: string[];
  }): string[] {
    const keywords = [
      ...(payload.targetAccounts ?? []),
      ...(payload.searchKeywords ?? []),
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return Array.from(new Set(keywords));
  }

  private normalizeRetentionSearchKeywords(payload: {
    searchKeywords?: string[];
    retentionSourceId?: string;
  }): string[] {
    const keywords = [
      ...(payload.searchKeywords ?? []),
      payload.retentionSourceId ?? '',
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return Array.from(new Set(keywords));
  }
}
