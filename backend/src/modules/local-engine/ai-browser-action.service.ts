import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { LocalBrowserEngine } from './local-browser-engine.service';

/**
 * AI 网页代操作（对标炼刀 midscene 网页代操作，第一阶段：接口层）
 *
 * POST /api/browser/ai-action
 *   { instruction: '打开 https://example.com 然后点击 登录', url?, timeoutMs? }
 *
 * 流程：自然语言指令 → 动作序列（规则解析；AI 解析为后续增强）→ 真实浏览器执行（LocalBrowserEngine + Playwright）→ 每步截图证据。
 *
 * 安全约束：
 * - DISPATCH_MOCK=true 时硬失败（不能伪造成功），与社媒互动 executor 一致
 * - 动作白名单：goto/type/click/screenshot/extract/wait，非法动作拒绝
 * - 通用网页会话（platform: 'general-web'），不碰社媒登录态
 */

export type AiBrowserAction =
  | { action: 'goto'; url: string }
  | { action: 'type'; selector: string; text: string }
  | { action: 'click'; selector: string }
  | { action: 'screenshot'; name?: string }
  | { action: 'extract'; selector: string }
  | { action: 'wait'; ms: number };

export interface AiBrowserRunInput {
  instruction: string;
  url?: string;
  timeoutMs?: number;
  /** P4：会话独立 accountId（缺省回落 ai-agent 保兼容）——真正用会话自己的 Profile 执行 */
  accountId?: string;
  /** P4：执行前策略门——每步动作执行前调用，allowed=false 阻断该步（不执行） */
  policyGate?: (action: AiBrowserAction) => Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
  }>;
  /**
   * P4：已获用户确认的精确动作（绑定 action+target+url，避免放行整类工具）。
   * requiresConfirmation 的动作须有精确匹配的确认项才放行。
   */
  confirmedTools?: Array<{
    action: string;
    target?: string;
    url?: string;
  }>;
  /** §14.2 最大动作数（超过截断） */
  maxActions?: number;
  /** §14.2 失败重试次数 */
  maxRetries?: number;
}

/** 精确确认匹配：action 必匹配，target/url 提供则必须一致 */
export function matchesConfirmedAction(
  confirmed: { action: string; target?: string; url?: string },
  step: AiBrowserAction,
): boolean {
  if (confirmed.action !== step.action) return false;
  if ('url' in step && confirmed.url && confirmed.url !== step.url) return false;
  if ('selector' in step && confirmed.target && confirmed.target !== step.selector) return false;
  return true;
}

export interface AiBrowserStepResult {
  index: number;
  action: string;
  ok: boolean;
  message?: string;
  evidenceUrl?: string;
  extractText?: string;
  /** §7.4 执行前被策略阻断（未执行） */
  blocked?: boolean;
}

interface RawAiActionItem {
  action?: unknown;
  url?: unknown;
  selector?: unknown;
  text?: unknown;
  name?: unknown;
  ms?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ACTIONS = 12;

@Injectable()
export class AiBrowserActionService {
  private readonly logger = new Logger(AiBrowserActionService.name);
  private readonly mockMode = process.env.DISPATCH_MOCK === 'true';

  constructor(
    private readonly browser: LocalBrowserEngine,
    private readonly prisma?: PrismaService,
    private readonly aiClient?: AiClientService,
  ) {}

  /**
   * AI-LLM 动作解析（二期）：LLM 输出结构化动作 JSON → 白名单校验
   * 需要后台配置 purpose='ai_browser_action' 的默认模型；未配置/失败返回 null（降级规则解析）
   */
  async parseWithAi(instruction: string): Promise<AiBrowserAction[] | null> {
    const prisma = this.prisma;
    const aiClient = this.aiClient;
    if (!prisma || !aiClient) return null;
    try {
      const config = await prisma.defaultModelConfig.findFirst({
        where: { purpose: 'ai_browser_action' },
      });
      if (!config?.modelId) return null;
      const raw = await aiClient.generate(
        config.modelId,
        [
          {
            role: 'system',
            content: `你是浏览器自动化助手。把用户的中文指令转换成浏览器动作 JSON 数组。
动作 schema（只能是这些）：
{"action":"goto","url":"https://..."}
{"action":"type","selector":"CSS选择器","text":"要输入的文字"}
{"action":"click","selector":"CSS选择器或 text=文本"}
{"action":"screenshot","name":"可选名称"}
{"action":"extract","selector":"CSS选择器"}
{"action":"wait","ms":毫秒}
要求：最多 12 个动作；selector 用 text=文本 匹配可见文本；只返回 JSON 数组，不要 Markdown 代码块或解释。`,
          },
          { role: 'user', content: instruction },
        ],
        { temperature: 0.1, maxTokens: 1200 },
      );
      return this.validateAiActions(raw);
    } catch (error) {
      this.logger.warn(`AI 动作解析失败，降级规则解析: ${error}`);
      return null;
    }
  }

  /** 校验 LLM 输出：JSON 数组 + 动作白名单 + 数量上限，非法项过滤 */
  private validateAiActions(raw: string): AiBrowserAction[] | null {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const allowed = new Set([
      'goto',
      'type',
      'click',
      'screenshot',
      'extract',
      'wait',
    ]);
    const actions: AiBrowserAction[] = [];
    for (const item of parsed as RawAiActionItem[]) {
      if (actions.length >= 12) break;
      const action = item.action;
      if (typeof action !== 'string' || !allowed.has(action)) continue;
      switch (action) {
        case 'goto':
          if (typeof item.url === 'string' && /^https?:\/\//.test(item.url)) {
            actions.push({ action: 'goto', url: item.url });
          }
          break;
        case 'type':
          if (
            typeof item.selector === 'string' &&
            typeof item.text === 'string'
          ) {
            actions.push({
              action: 'type',
              selector: item.selector,
              text: String(item.text).slice(0, 500),
            });
          }
          break;
        case 'click':
          if (typeof item.selector === 'string') {
            actions.push({ action: 'click', selector: item.selector });
          }
          break;
        case 'screenshot':
          actions.push({
            action: 'screenshot',
            name: typeof item.name === 'string' ? item.name : undefined,
          });
          break;
        case 'extract':
          if (typeof item.selector === 'string') {
            actions.push({
              action: 'extract',
              selector: item.selector,
            });
          }
          break;
        case 'wait': {
          const ms = Math.floor(Number(item.ms));
          if (Number.isFinite(ms) && ms >= 0) {
            actions.push({ action: 'wait', ms: Math.min(ms, 60_000) });
          }
          break;
        }
      }
    }
    return actions.length > 0 ? actions : null;
  }

  /**
   * 自然语言指令 → 动作序列（规则解析，确定性可测；AI 解析后续增强）
   */
  /** P1-4 解析指令为动作序列（供逐步 re-observe 循环使用） */
  async parseActions(instruction: string): Promise<AiBrowserAction[]> {
    const actions =
      (await this.parseWithAi(instruction)) ??
      this.parseInstruction(instruction);
    return actions;
  }

  parseInstruction(instruction: string): AiBrowserAction[] {
    const text = instruction?.trim();
    if (!text) {
      throw new BadRequestException('指令不能为空');
    }
    const actions: AiBrowserAction[] = [];
    // 分段：按 然后/接着/并且/逗号/分号 切分
    const steps = text
      .split(/然后|接着|并且|之后|[,，;；。]/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const step of steps) {
      let matched = false;
      // 1. 打开/访问/进入 URL
      let m = step.match(
        /^(?:打开|访问|进入|前往|跳转到?|导航到?|goto)\s*(?:网址|链接|页面)?\s*(https?:\/\/[^\s]+)/i,
      );
      if (m) {
        actions.push({ action: 'goto', url: m[1] });
        matched = true;
      }
      // 2. 等待 N 秒/毫秒
      if (!matched) {
        m = step.match(/^等待\s*(\d+)\s*(秒|毫秒|ms|s)?/i);
        if (m) {
          const value = Number(m[1]);
          const unit = (m[2] ?? '').toLowerCase();
          const ms = unit === '秒' || unit === 's' ? value * 1000 : value;
          actions.push({ action: 'wait', ms });
          matched = true;
        }
      }
      // 3. 点击 <目标>（文本优先）
      if (!matched) {
        m = step.match(
          /^(?:点击|点|按下|单击|click)\s*(?:按钮|链接|元素)?\s*[:：]?\s*(.+)/i,
        );
        if (m && m[1].trim()) {
          actions.push({ action: 'click', selector: `text=${m[1].trim()}` });
          matched = true;
        }
      }
      // 4. 输入/填写 <文字>（到输入框）
      if (!matched) {
        m = step.match(
          /^(?:输入|填写|填入|键入|type)\s*(?:内容|文字|文本)?\s*[:：]?\s*(.+)/i,
        );
        if (m && m[1].trim()) {
          actions.push({
            action: 'type',
            selector:
              'input[type="search"], input[type="text"], input[type="email"], input[type="password"], textarea, [contenteditable="true"]',
            text: m[1].trim(),
          });
          matched = true;
        }
      }
      // 5. 截图（可选名称）
      if (!matched) {
        m = step.match(/^(?:截图|截屏|screenshot)(?:\s*(.+))?$/i);
        if (m) {
          actions.push({
            action: 'screenshot',
            name: m[1]?.trim() || undefined,
          });
          matched = true;
        }
      }
      // 6. 提取/读取 <选择器> 内容
      if (!matched) {
        m = step.match(
          /^(?:提取|读取|获取|extract)\s*(?:内容|文字)?\s*[:：]?\s*(.+)/i,
        );
        if (m && m[1].trim()) {
          actions.push({ action: 'extract', selector: m[1].trim() });
          matched = true;
        }
      }
      if (!matched) {
        throw new BadRequestException(`无法解析指令步骤：${step}`);
      }
    }

    if (actions.length === 0) {
      throw new BadRequestException('未识别到可执行动作');
    }
    if (actions.length > MAX_ACTIONS) {
      throw new BadRequestException(
        `动作过多（${actions.length} > ${MAX_ACTIONS}），请拆分成多次指令`,
      );
    }
    return actions;
  }

  /**
   * 执行 AI 网页代操作：指令 → 动作 → 真实浏览器执行 + 每步截图证据
   */
  async run(input: AiBrowserRunInput): Promise<{
    ok: boolean;
    status: 'success' | 'partial_success' | 'failed';
    instruction: string;
    actions: AiBrowserAction[];
    results: AiBrowserStepResult[];
    sessionKey: string;
  }> {
    if (this.mockMode) {
      throw new Error(
        'DISPATCH_MOCK=true：已阻断 AI 网页代操作，不能跳过真实浏览器执行后返回成功。请关闭 DISPATCH_MOCK。',
      );
    }
    const actions =
      (await this.parseWithAi(input.instruction)) ??
      this.parseInstruction(input.instruction);
    if (input.url && actions[0]?.action !== 'goto') {
      actions.unshift({ action: 'goto', url: input.url });
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const session = await this.browser.getOrCreateSession({
      platform: 'general-web',
      accountId: input.accountId ?? 'ai-agent',
    });
    const results: AiBrowserStepResult[] = [];

    try {
      // §14.2 maxActions：截断超出上限的动作
      const cappedActions = input.maxActions
        ? actions.slice(0, input.maxActions)
        : actions;
      for (let i = 0; i < cappedActions.length; i++) {
        const step = cappedActions[i];
        const maxRetries = Math.max(0, input.maxRetries ?? 0);
        try {
          // §7.4 执行前策略拦截：policyGate 拒绝则跳过该步（不执行）
          if (input.policyGate) {
            const gate = await input.policyGate(step);
            // 确认闸门：requiresConfirmation 的动作须精确匹配确认项（action+target+url）
            const confirmed = gate.requiresConfirmation
              ? (input.confirmedTools ?? []).some((c) =>
                  matchesConfirmedAction(c, step),
                )
              : true;
            if (!gate.allowed || !confirmed) {
              this.logger.warn(
                `ai-action step ${i} (${step.action}) 被策略阻断: ${gate.requiresConfirmation && !confirmed ? '需用户确认' : (gate.reason ?? '不在白名单')}`,
              );
              results.push({
                index: i,
                action: step.action,
                ok: false,
                message: gate.requiresConfirmation && !confirmed
                  ? `需用户确认后执行（高风险动作）`
                  : `策略阻断：${gate.reason ?? '不在白名单'}`,
                blocked: true,
              });
              continue;
            }
          }
          // §14.2 maxRetries：单步失败重试
          let stepResult: Awaited<ReturnType<typeof this.executeStep>> | undefined;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              stepResult = await this.executeStep(
                session.key,
                session.page,
                step,
                timeoutMs,
              );
              break;
            } catch (error) {
              if (attempt >= maxRetries) throw error;
              this.logger.warn(
                `ai-action step ${i} (${step.action}) 第 ${attempt + 1} 次重试`,
              );
            }
          }
          results.push({
            index: i,
            action: step.action,
            ok: true,
            ...stepResult,
          });
        } catch (error) {
          this.logger.warn(
            `ai-action step ${i} (${step.action}) 失败: ${error}`,
          );
          results.push({
            index: i,
            action: step.action,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
          // 单步失败不中断后续（截图等步骤仍可执行）
        }
      }
    } finally {
      session.lastActivityAt = new Date().toISOString();
    }

    // §7.4 状态语义：全部成功=success、部分失败=partial_success、全失败=failed
    const succeeded = results.filter((r) => r.ok).length;
    const ok = succeeded === results.length && results.length > 0;
    const status: 'success' | 'partial_success' | 'failed' =
      results.length === 0
        ? 'failed'
        : succeeded === results.length
          ? 'success'
          : 'partial_success';
    return {
      ok,
      status,
      instruction: input.instruction,
      actions,
      results,
      sessionKey: session.key,
    };
  }

  /**
   * P1-4 单动作执行（逐步循环：每步单独执行+验证）：
   * 创建/复用会话，执行单个动作并返回证据结果。
   */
  async executeSingle(input: {
    action: AiBrowserAction;
    accountId?: string;
    timeoutMs?: number;
  }): Promise<{ index: number; action: string; ok: boolean; message?: string; evidenceUrl?: string; extractText?: string }> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const session = await this.browser.getOrCreateSession({
      platform: 'general-web',
      accountId: input.accountId ?? 'ai-agent',
    });
    try {
      const stepResult = await this.executeStep(
        session.key,
        session.page,
        input.action,
        timeoutMs,
      );
      return {
        index: 0,
        action: input.action.action,
        ok: true,
        ...stepResult,
      };
    } catch (error) {
      this.logger.warn(
        `ai-action single (${input.action.action}) 失败: ${error}`,
      );
      return {
        index: 0,
        action: input.action.action,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeStep(
    sessionKey: string,
    page: Page,
    step: AiBrowserAction,
    timeoutMs: number,
  ): Promise<{ evidenceUrl?: string; extractText?: string }> {
    const waitOptions = { timeout: timeoutMs };
    let extractText: string | undefined;
    switch (step.action) {
      case 'goto':
        await page.goto(step.url, waitOptions).catch(() => undefined);
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        break;
      case 'type':
        await page.locator(step.selector).first().fill(step.text, waitOptions);
        break;
      case 'click':
        await page.locator(step.selector).first().click(waitOptions);
        break;
      case 'extract': {
        const text = await page
          .locator(step.selector)
          .first()
          .textContent()
          .catch(() => '');
        extractText = (text ?? '').trim().slice(0, 2000);
        break;
      }
      case 'wait':
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(step.ms, 30_000)),
        );
        break;
      case 'screenshot':
        break;
    }
    // 每步执行后截图证据
    let evidenceUrl: string | undefined;
    try {
      const evidence = await this.browser.captureEvidence({
        sessionKey,
        label: `ai-action-${step.action}-${Date.now()}`,
      });
      evidenceUrl = evidence.url;
    } catch {
      evidenceUrl = undefined;
    }
    return { evidenceUrl, extractText };
  }
}
