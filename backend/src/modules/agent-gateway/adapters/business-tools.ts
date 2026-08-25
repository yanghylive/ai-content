import {
  EvidenceRef,
  TenantContext,
  ToolRequest,
  ToolResultStatus,
  UsageInfo,
} from '../core/types';
import { genId, hashJson } from '../core/util';

export interface ToolArtifact {
  type: string;
  uri: string;
  checksum: string;
  version: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecution {
  data?: Record<string, unknown>;
  evidence: EvidenceRef[];
  usage: UsageInfo;
  status: ToolResultStatus;
  artifacts?: ToolArtifact[];
}

export type ToolExecutor = (
  ctx: TenantContext,
  request: ToolRequest,
  checkpoint?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ToolExecution>;

/** 生成一次模型调用的用量；usageId 唯一，供计费去重 */
function usage(
  model: string,
  modelTokens: number,
  computeUnits: number,
  inputTokens: number = Math.ceil(modelTokens * 0.5),
): UsageInfo {
  return {
    model,
    inputTokens,
    modelTokens,
    computeUnits,
    usageId: genId('usage'),
  };
}

function screenshot(taskId: string): EvidenceRef {
  return {
    type: 'screenshot',
    uri: `/evidence/${taskId}/shot_${genId('s')}.png`,
    checksum: hashJson(genId('c')),
  };
}

/**
 * 业务工具注册表（mock 实现）—— 对齐《整合 PRD》7 / 《补充包》5.2。
 * 真实实现需路由到 3010 内容/发布/互动/线索/CRM/复盘服务与 RPA 执行器。
 */
export class BusinessToolRegistry {
  private execs = new Map<string, ToolExecutor>();

  register(name: string, exec: ToolExecutor): void {
    this.execs.set(name, exec);
  }

  get(name: string): ToolExecutor | undefined {
    return this.execs.get(name);
  }

  has(name: string): boolean {
    return this.execs.has(name);
  }

  /** 已注册工具名列表（合并多个真实工具集时用） */
  list(): string[] {
    return [...this.execs.keys()];
  }
}

// ---------------------------------------------------------------------------
// 代表性 mock 执行器（覆盖六步闭环）
// ---------------------------------------------------------------------------

export const leadDiscover: ToolExecutor = async (ctx, req) => {
  const platform = String((req.payload.platform as string) ?? 'xiaohongshu');
  const count = Number(req.payload.limit ?? 18);
  const leadIds = Array.from({ length: count }, () => genId('lead'));
  return {
    data: { count, leadIds, platform, tenantId: ctx.tenantId },
    evidence: [
      screenshot(req.taskId),
      { type: 'platform_url', uri: `https://${platform}.com/search` },
    ],
    usage: usage('kaypal-crawler', 1200, 3),
    status: 'succeeded',
  };
};

export const contentGenerate: ToolExecutor = async (_ctx, req) => {
  const title = String((req.payload.title as string) ?? '未命名草稿');
  const contentId = genId('content');
  return {
    data: { contentId, title, body: `（由模型生成的示例文案）${title}` },
    evidence: [screenshot(req.taskId)],
    usage: usage('kaypal-writer', 2400, 6),
    status: 'succeeded',
    artifacts: [
      {
        type: 'content_draft',
        uri: `/artifacts/${contentId}.md`,
        checksum: hashJson({ contentId, title }),
        version: 1,
        metadata: { title },
      },
    ],
  };
};

export const publishExecute: ToolExecutor = async (_ctx, req) => {
  const platform = String((req.payload.platform as string) ?? 'douyin');
  return {
    data: {
      platform,
      url: `https://${platform}.com/post/${genId('p')}`,
      status: 'published',
    },
    evidence: [
      screenshot(req.taskId),
      { type: 'platform_url', uri: `https://${platform}.com/post` },
    ],
    usage: usage('kaypal-publisher', 800, 2),
    status: 'succeeded',
  };
};

export const crmCreate: ToolExecutor = async (ctx, req) => {
  const contactId = genId('contact');
  return {
    data: {
      contactId,
      name: req.payload.name ?? '未知',
      tenantId: ctx.tenantId,
    },
    evidence: [screenshot(req.taskId)],
    usage: usage('kaypal-crm', 400, 1),
    status: 'succeeded',
  };
};

export const reportGenerate: ToolExecutor = async (_ctx, req) => {
  const reportId = genId('report');
  return {
    data: {
      reportId,
      range: req.payload.range ?? 'week',
      funnel: { lead: 120, crm: 30, deal: 5 },
    },
    evidence: [screenshot(req.taskId)],
    usage: usage('kaypal-analyst', 1600, 4),
    status: 'succeeded',
    artifacts: [
      {
        type: 'report',
        uri: `/artifacts/${reportId}.json`,
        checksum: hashJson(reportId),
        version: 1,
      },
    ],
  };
};

export const interactionReplyExecute: ToolExecutor = async (_ctx, req) => {
  return {
    data: { platform: req.payload.platform ?? 'wechat', sent: true },
    evidence: [screenshot(req.taskId)],
    usage: usage('kaypal-writer', 600, 1),
    status: 'succeeded',
  };
};

/** 注册全部 mock 业务工具 */
export function buildBusinessTools(): BusinessToolRegistry {
  const r = new BusinessToolRegistry();
  r.register('lead_discover', leadDiscover);
  r.register('content_generate', contentGenerate);
  r.register('publish_execute', publishExecute);
  r.register('crm_create', crmCreate);
  r.register('report_generate', reportGenerate);
  r.register('interaction_reply_execute', interactionReplyExecute);
  return r;
}
