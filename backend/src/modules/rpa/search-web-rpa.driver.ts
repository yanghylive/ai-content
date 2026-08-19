import { createHash, randomUUID } from 'node:crypto';
import type { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import type { DiscoveryItem } from '../discovery/discovery.types';
import { BaseRpaDriver } from './base-rpa.driver';
import type {
  RpaCapability,
  RpaReasonCode,
  RpaSession,
  RpaSessionContext,
  RpaStepResult,
} from './rpa.types';

type SearchPlatform = 'douyin' | 'xiaohongshu' | 'kuaishou';

/**
 * 网页搜索类 RPA 驱动（抖音/快手/小红书，§7.3）。
 *
 * 包装 DiscoveryBrowserRunner（用户已登录浏览器会话）实现 keyword/account-works
 * 发现和读评论；回复评论仅允许工作台逐条人工确认，私信触达保持 unsupported。
 */
export class SearchWebRpaDriver extends BaseRpaDriver {
  readonly platform: string;
  readonly displayName: string;
  readonly driverVersion = '1.0.0';

  constructor(
    platform: SearchPlatform,
    displayName: string,
    private readonly runner: DiscoveryBrowserRunner,
  ) {
    super();
    this.platform = platform;
    this.displayName = displayName;
  }

  protected runtimeReady(): boolean {
    return Boolean(this.runner);
  }

  /**
   * P0-1 复核：把发现候选映射为 RPA items 前先做「真实外部 ID/URL 门禁」。
   * - 缺 sourceContent.externalContentId 或 url 的条目直接剔除（禁止 randomUUID 充当平台 ID）；
   * - 保留条目若 rawHash 缺失，用真实 externalContentId+url 派生 sha256（内容指纹可复现，
   *   不是伪造平台 ID）；返回剔除数量供调用方决定 parse_failed/partial。
   */
  private mapDiscoveryItems(
    items: Array<{
      sourceContent?: DiscoveryItem['sourceContent'];
      identityHint?: DiscoveryItem['identityHint'];
      interactionEvents?: DiscoveryItem['interactionEvents'];
      recommendedFallback?: boolean;
    }>,
  ): { mapped: RpaStepResult['items']; dropped: number } {
    const mapped: RpaStepResult['items'] = [];
    let dropped = 0;
    for (const item of items) {
      const externalContentId = item.sourceContent?.externalContentId;
      const url = item.sourceContent?.url;
      if (!externalContentId || !url) {
        dropped += 1;
        continue;
      }
      mapped.push({
        externalContentId,
        url,
        contentType: item.sourceContent?.contentType ?? 'video',
        title: item.sourceContent?.title,
        // read-comments 场景评论文本在 interactionEvents[0].text，优先于内容文本
        text: item.interactionEvents?.[0]?.text ?? item.sourceContent?.text,
        authorName: item.identityHint?.nickname,
        externalUserId: item.identityHint?.externalUserId,
        profileUrl: item.identityHint?.profileUrl,
        externalEventId: item.interactionEvents?.[0]?.externalEventId,
        occurredAt: item.interactionEvents?.[0]?.occurredAt,
        recommendedFallback: item.recommendedFallback === true,
        rawHash:
          item.sourceContent?.rawHash ??
          createHash('sha256')
            .update(`${externalContentId}:${url}`)
            .digest('hex')
            .slice(0, 24),
      });
    }
    return { mapped, dropped };
  }

  /**
   * P1-1 账号级能力：带 accountId 时附加账号 preflight（登录态/验证码/风控）。
   * 未带 accountId 时保持原有"运行时就绪"语义（兼容旧调用）。
   */
  async capabilities(input?: {
    accountId?: string | number;
  }): Promise<RpaCapability> {
    const base = {
      platform: this.platform as RpaCapability['platform'],
      displayName: this.displayName,
      runtimeReady: this.runtimeReady(),
      actions: this.declareActions(),
      driverVersion: this.driverVersion,
    };
    if (input?.accountId == null) return base;
    const probe = await this.runner.probeAccount(
      this.platform,
      input.accountId,
    );
    return {
      ...base,
      accountProbe: {
        accountId: String(input.accountId),
        browserReady: probe.browserReady,
        loggedIn: probe.loggedIn,
        pageInteractive: probe.pageInteractive,
        captchaRequired: probe.captchaRequired,
        riskControl: probe.riskControl,
        checkedAt: new Date().toISOString(),
        reasonCode: probe.reasonCode,
      },
    };
  }

  protected declareActions() {
    const ready = this.runtimeReady();
    const unavailable = ready
      ? {}
      : {
          unavailableReason: `${this.displayName}浏览器会话未就绪（需登录平台账号）`,
          unavailableReasonCode: 'no_browser_session' as const,
        };
    // 复核：小红书账号主页浏览行为未实现（XhsBehavior.listAccountWorks 抛 unsupported），
    // 能力声明必须与真实实现一致 → 小红书暂不支持 discover-account-works。
    const accountWorksSupported = ready && this.platform !== 'xiaohongshu';
    const accountWorksUnavailable = ready
      ? this.platform === 'xiaohongshu'
        ? {
            unavailableReason:
              '小红书账号主页作品浏览尚未实现（详情页反爬限制）；请使用关键词/视频链接模式',
            unavailableReasonCode: 'unsupported' as const,
          }
        : {}
      : unavailable;
    return [
      { action: 'discover-keyword' as const, supported: ready, ...unavailable },
      {
        action: 'discover-account-works' as const,
        supported: accountWorksSupported,
        ...accountWorksUnavailable,
      },
      {
        action: 'read-comments' as const,
        supported: ready,
        ...unavailable,
      },
      {
        // Sprint 5：快手推荐流独立动作（与关键词搜索解耦）
        action: 'discover-recommended' as const,
        supported: ready && this.platform === 'kuaishou',
        ...(ready && this.platform !== 'kuaishou'
          ? {
              unavailableReason:
                '推荐流发现仅快手支持（其他平台无独立推荐流入口）',
              unavailableReasonCode: 'unsupported' as const,
            }
          : unavailable),
      },
      {
        action: 'reply-comment' as const,
        supported: ready,
        ...(ready
          ? {
              unavailableReason: `${this.displayName}回复评论为真实平台操作，需人工确认后执行（dry-run 验证不发送）`,
            }
          : {
              unavailableReason: `${this.displayName}浏览器会话未就绪（需登录平台账号）`,
              unavailableReasonCode: 'no_browser_session' as const,
            }),
      },
      {
        action: 'send-direct-message' as const,
        supported: false,
        unavailableReason: `${this.displayName}私信 RPA 尚未实现（真实触达高风险，需逐 action 确认 + 实测接入）`,
        unavailableReasonCode: 'unsupported' as const,
      },
    ];
  }

  /** 安全取字符串（unknown 仅接受 string，避免对象隐式转 [object Object]） */
  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  /**
   * 复核 #1：真实绑定引擎会话。openSession 先调用引擎 getOrCreateSession
   *（真实创建/复用浏览器会话），engineSessionKey 与引擎会话一对一；
   * 后续 runner 操作复用同一引擎会话，sessionId 不再是纯合成串。
   */
  async openSession(ctx: RpaSessionContext): Promise<RpaSession> {
    if (!this.runtimeReady()) {
      return Promise.reject(
        new Error(
          `unsupported: ${this.displayName} 浏览器会话未就绪，无法执行 RPA（请确认已登录平台账号）`,
        ),
      );
    }
    await this.runner.acquireEngineSession(this.platform, ctx.accountId);
    const engineSessionKey = `${this.platform}-${ctx.accountId}`;
    return {
      sessionId: `${engineSessionKey}-${ctx.runId}-${randomUUID().slice(0, 8)}`,
      engineSessionKey,
      platform: this.platform as RpaSession['platform'],
      accountId: ctx.accountId,
      pageAvailable: true,
    };
  }

  /**
   * 真实关闭浏览器会话（P0-2）：暂停/取消/人工接管时调用，
   * 关闭 runner 打开的持久浏览器页面与进程，防止后台继续自动操作。
   * 关闭失败抛出 close_failed，由调用方记录，不静默当成功。
   */
  async closeSession(session: RpaSession): Promise<void> {
    const accountId = this.text(session.accountId);
    if (!accountId) return;
    // P1 复核（前端审计第 6 项）：显式确认会话归属——用 openSession 回填的
    // engineSessionKey 校验，不再隐式重算 key。若引擎当前会话已被替换
    // （engineSessionKey 与当前 key 不一致，非本任务创建），跳过关闭防误杀新会话，
    // 由调用方 reconcile 标注（不静默当关闭成功）。
    const engineKey = this.text(session.engineSessionKey);
    const expectedKey = `${this.platform}-${accountId}`;
    if (engineKey && engineKey !== expectedKey) {
      throw new Error(
        `close_failed: 会话 ${engineKey} 与任务创建会话 ${expectedKey} 不一致（会话已被替换），已中止关闭防误杀`,
      );
    }
    await this.runner.closeSession(this.platform, accountId);
  }

  protected async runStep(
    session: RpaSession,
    action: string,
    input: Record<string, unknown>,
  ): Promise<RpaStepResult> {
    const startedAt = Date.now();
    const userId = this.text(input.userId);
    if (action === 'discover-keyword') {
      const keyword = this.text(input.keyword).trim();
      if (!keyword) {
        return this.stepResult(
          'discover-keyword',
          'failed',
          'parse_failed',
          startedAt,
          { message: '缺少关键词' },
        );
      }
      const userId = this.text(input.userId);
      const items = await this.runner.searchByKeyword({
        platform: this.platform as SearchPlatform,
        accountId: session.accountId,
        keyword,
        limit: Number(input.limit ?? 20),
        userId: userId || undefined,
      });
      // §7.4：页面未找到 ≠ 空结果，无结果进 partial（不吞成 success+空）
      if (!items.length) {
        return this.stepResult(
          'discover-keyword',
          'failed',
          'parse_failed',
          startedAt,
          { message: '搜索页未解析到结果（页面结构变化或未加载）' },
        );
      }
      // P0-2 复核：快手真实搜索不渲染时不再降级推荐流冒充关键词结果。
      // 推荐流候选必须走独立 discover-recommended 动作（用户明确选择推荐流模式），
      // 关键词请求出现 recommendedFallback 视为失败，避免来源/意图/报表归因错乱。
      if (items.some((item) => item.recommendedFallback === true)) {
        return this.stepResult(
          'discover-keyword',
          'failed',
          'search_not_rendered',
          startedAt,
          {
            message:
              '快手关键词搜索页未渲染，已阻断（不降级推荐流冒充关键词结果）；如需推荐流请单独使用推荐流模式',
          },
        );
      }
      // P0-1 复核：缺真实 externalContentId/url 的候选剔除，禁止 randomUUID 伪造平台 ID。
      const { mapped, dropped } = this.mapDiscoveryItems(items);
      if (!mapped?.length) {
        return this.stepResult(
          'discover-keyword',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `解析到 ${items.length} 条内容但均缺少真实内容 ID/URL（无法证明候选真实存在），已判失败`,
          },
        );
      }
      if (dropped > 0) {
        return this.stepResult(
          'discover-keyword',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `解析到 ${items.length} 条内容，其中 ${dropped} 条缺少真实内容 ID/URL（可能为重复占位或解析不完整），已整体判失败待人工核对`,
          },
        );
      }
      return this.stepResult('discover-keyword', 'success', 'ok', startedAt, {
        items: mapped,
      });
    }
    if (action === 'discover-recommended') {
      // 推荐流不需要关键词（空则用默认值，仅用于配额/审计标识）
      const keyword = this.text(input.keyword) || 'recommended';
      const items = await this.runner.searchRecommended({
        platform: this.platform as SearchPlatform,
        accountId: session.accountId,
        keyword,
        limit: Number(input.limit ?? 20),
        userId: userId || undefined,
      });
      if (!items.length) {
        return this.stepResult(
          'discover-recommended',
          'failed',
          'parse_failed',
          startedAt,
          { message: '推荐流未解析到结果' },
        );
      }
      // P0-1 复核：缺真实内容 ID/URL 的推荐流候选同样剔除，禁止 UUID 伪造
      const { mapped: recoMapped, dropped: recoDropped } =
        this.mapDiscoveryItems(items);
      if (!recoMapped?.length) {
        return this.stepResult(
          'discover-recommended',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `推荐流解析到 ${items.length} 条内容但均缺少真实内容 ID/URL，已判失败`,
          },
        );
      }
      if (recoDropped > 0) {
        return this.stepResult(
          'discover-recommended',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `推荐流解析到 ${items.length} 条内容，其中 ${recoDropped} 条缺少真实内容 ID/URL，已整体判失败待人工核对`,
          },
        );
      }
      return this.stepResult(
        'discover-recommended',
        'success',
        'ok',
        startedAt,
        {
          items: recoMapped,
        },
      );
    }
    if (action === 'discover-account-works') {
      const targetId = this.text(input.targetId).trim();
      if (!targetId) {
        return this.stepResult(
          'discover-account-works',
          'failed',
          'parse_failed',
          startedAt,
          { message: '缺少目标账号标识' },
        );
      }
      const userId = this.text(input.userId);
      const items = await this.runner.listAccountWorks({
        platform: this.platform as SearchPlatform,
        accountId: session.accountId,
        targetId,
        limit: Number(input.limit ?? 20),
        userId: userId || undefined,
      });
      if (!items.length) {
        return this.stepResult(
          'discover-account-works',
          'failed',
          'parse_failed',
          startedAt,
          { message: '账号主页未解析到作品' },
        );
      }
      // P0-1 复核：缺真实内容 ID/URL 的候选剔除，禁止 UUID 伪造
      const { mapped: acctMapped, dropped: acctDropped } =
        this.mapDiscoveryItems(items);
      if (!acctMapped?.length) {
        return this.stepResult(
          'discover-account-works',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `账号主页解析到 ${items.length} 条作品但均缺少真实内容 ID/URL，已判失败`,
          },
        );
      }
      if (acctDropped > 0) {
        return this.stepResult(
          'discover-account-works',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `账号主页解析到 ${items.length} 条作品，其中 ${acctDropped} 条缺少真实内容 ID/URL，已整体判失败待人工核对`,
          },
        );
      }
      return this.stepResult(
        'discover-account-works',
        'success',
        'ok',
        startedAt,
        {
          items: acctMapped,
        },
      );
    }
    if (action === 'read-comments') {
      const contentUrl = this.text(input.contentUrl).trim();
      if (!contentUrl) {
        return this.stepResult(
          'read-comments',
          'failed',
          'parse_failed',
          startedAt,
          { message: '缺少内容页 URL' },
        );
      }
      const userId = this.text(input.userId);
      const items = await this.runner.readComments({
        platform: this.platform as SearchPlatform,
        accountId: session.accountId,
        contentUrl,
        // 小红书详情页需从搜索页真实点击进入（直开 404），需来源关键词
        keyword: this.text(input.keyword) || undefined,
        limit: Number(input.limit ?? 20),
        userId: userId || undefined,
      });
      // §7.4：页面未找到 ≠ 空结果，无评论进 parse_failed（不吞成 success+空）
      if (!items.length) {
        return this.stepResult(
          'read-comments',
          'failed',
          'parse_failed',
          startedAt,
          { message: '评论区未解析到评论（页面结构变化、未加载或无评论）' },
        );
      }
      // P0-1 复核：评论候选缺真实内容 ID/URL（评论所属内容）→ 剔除，禁止 UUID 伪造
      const { mapped: commentMapped, dropped: commentDropped } =
        this.mapDiscoveryItems(items);
      if (!commentMapped?.length) {
        return this.stepResult(
          'read-comments',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `解析到 ${items.length} 条评论但均缺少真实内容 ID/URL（无法证明评论真实存在），已判失败`,
          },
        );
      }
      if (commentDropped > 0) {
        return this.stepResult(
          'read-comments',
          'failed',
          'parse_failed',
          startedAt,
          {
            message: `解析到 ${items.length} 条评论，其中 ${commentDropped} 条缺少真实内容 ID/URL，已整体判失败待人工核对`,
          },
        );
      }
      return this.stepResult('read-comments', 'success', 'ok', startedAt, {
        items: commentMapped,
      });
    }
    if (action === 'reply-comment') {
      // 触达动作（人工确认式）：定位目标评论 → hover 回复入口 → 填话术 → 发送
      const targetText = this.text(input.targetText);
      const replyText = this.text(input.replyText);
      if (!targetText || !replyText) {
        return this.stepResult(
          'reply-comment',
          'failed',
          'parse_failed',
          startedAt,
          { message: '缺少目标评论或回复话术' },
        );
      }
      const userId = this.text(input.userId);
      try {
        const result = await this.runner.replyComment({
          platform: this.platform as SearchPlatform,
          accountId: session.accountId,
          contentUrl: this.text(input.sourceUrl) || this.text(input.contentUrl),
          keyword: this.text(input.keyword) || undefined,
          targetText,
          replyText,
          dryRun: input.dryRun === true,
          userId: userId || undefined,
        });
        return this.stepResult(
          'reply-comment',
          result.ok ? 'success' : 'failed',
          result.ok ? 'ok' : 'page_not_found',
          startedAt,
          {
            message: result.message,
            // P0 复核（全面审查）：回复成功回传真实截图证据（URL），
            // finalize 证据门禁据此判定 success；无证据时如实降级不冒充
            evidenceUrl: result.evidenceUrl,
          },
        );
      } catch (error) {
        const reason =
          error instanceof Error && 'reasonCode' in error
            ? String((error as { reasonCode?: string }).reasonCode)
            : 'network_error';
        return this.stepResult(
          'reply-comment',
          'failed',
          reason as RpaReasonCode,
          startedAt,
          { message: error instanceof Error ? error.message : '回复评论失败' },
        );
      }
    }
    return this.stepResult('unknown', 'failed', 'unsupported', startedAt, {
      message: `${this.displayName}不支持的动作 ${action}`,
    });
  }

  collectEvidence(session: RpaSession): Promise<RpaStepResult | null> {
    const startedAt = Date.now();
    return Promise.resolve(
      this.stepResult('collect-evidence', 'success', 'ok', startedAt, {
        rawHash: createHash('sha256')
          .update(`${session.sessionId}-${Date.now()}`)
          .digest('hex'),
        message: `${this.displayName}会话存活探针`,
      }),
    );
  }
}
