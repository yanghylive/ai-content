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
}

export interface AiBrowserStepResult {
  index: number;
  action: string;
  ok: boolean;
  message?: string;
  evidenceUrl?: string;
  extractText?: string;
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
      accountId: 'ai-agent',
    });
    const results: AiBrowserStepResult[] = [];

    try {
      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        try {
          const stepResult = await this.executeStep(
            session.key,
            session.page,
            step,
            timeoutMs,
          );
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

    const ok = results.some((r) => r.ok);
    return {
      ok,
      instruction: input.instruction,
      actions,
      results,
      sessionKey: session.key,
    };
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
