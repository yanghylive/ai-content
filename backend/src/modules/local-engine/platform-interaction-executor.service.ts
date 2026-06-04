/**
 * PlatformInteractionExecutor - 4 个 platform service 共用的真实浏览器执行器
 *
 * 替代 5409 main.py 12 /interaction/star/send|draft HTTP endpoints.
 * 走 PlaywrightMcpService (microsoft/playwright-mcp) 调 browser_* MCP 工具.
 *
 * 架构:
 *   platform service -> PlatformInteractionExecutor.dispatch()
 *     -> PlaywrightMcpService.rpcCall('browser_navigate', {url})
 *        -> npx @playwright/mcp 子进程 -> Chrome
 *     -> browser_snapshot() 拿 a11y tree
 *     -> browser_fill_form / browser_type / browser_click (按需)
 *     -> browser_take_screenshot() 拿证据
 *
 * 价值:
 * - 走 MCP 标准: 同样调用可以给 Claude/Cursor/Agent-S 用
 * - browser_snapshot 给 Agent 可读的 a11y tree, 比 CSS selector 稳
 * - 一处实现, 多处复用 (4 个 platform service 共用 + 外部 MCP 客户端)
 *
 * 设计:
 * 1. 每个 platform service 调 dispatch(input) 即可
 * 2. 真实失败返 clear error + screenshot 证据
 * 3. Mock 模式: DISPATCH_MOCK=true 跳真实操作
 */

import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { LocalBrowserEngine } from './local-browser-engine.service';

export type PlatformDispatchInput = {
  platform: 'douyin' | 'wechat-channel';
  taskType: 'comment-reply' | 'direct-message-reply';
  action: 'send' | 'draft';
  accountId: number | string;
  targetText: string;
  replyText: string;
};

export type PlatformDispatchResult = {
  status: 'sent' | 'drafted' | 'failed';
  message: string;
  evidencePath?: string;
  evidenceUrl?: string;
  nextAction?: string;
};

const PLATFORM_URLS: Record<
  PlatformDispatchInput['platform'],
  Record<PlatformDispatchInput['taskType'], string>
> = {
  douyin: {
    'comment-reply': 'https://creator.douyin.com/creator-micro/interactive/comment',
    'direct-message-reply': 'https://creator.douyin.com/creator-micro/data/following/chat',
  },
  'wechat-channel': {
    'comment-reply': 'https://channels.weixin.qq.com/platform/post/comment',
    'direct-message-reply': 'https://channels.weixin.qq.com/platform/post/message',
  },
};

@Injectable()
export class PlatformInteractionExecutor {
  private readonly logger = new Logger(PlatformInteractionExecutor.name);
  private readonly mockMode = process.env.DISPATCH_MOCK === 'true';

  constructor(
    private readonly mcp: PlaywrightMcpService,
    private readonly browser: LocalBrowserEngine,
  ) {}

  async dispatch(input: PlatformDispatchInput): Promise<PlatformDispatchResult> {
    if (this.mockMode) {
      this.logger.warn('DISPATCH_MOCK=true - skip real MCP dispatch');
      return {
        status: input.action === 'send' ? 'sent' : 'drafted',
        message: 'mock 模式: 跳过真实操作',
        nextAction: '关闭 DISPATCH_MOCK 走真实 MCP',
      };
    }

    const targetUrl = PLATFORM_URLS[input.platform][input.taskType];
    this.logger.log(
      `MCP dispatch ${input.platform}/${input.taskType} account=${input.accountId} action=${input.action} url=${targetUrl}`,
    );

    try {
      // 1. Navigate to platform page
      const navResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: { url: targetUrl },
        },
      });
      this.logger.log(`browser_navigate done: ${JSON.stringify(navResult?.result)?.slice(0, 120)}`);

      // Check login state from page snapshot/URL
      const snapshotResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_snapshot',
          arguments: {},
        },
      });
      const snapshotText = JSON.stringify(snapshotResult?.result ?? {});
      this.logger.debug(`browser_snapshot for ${input.platform}: len=${snapshotText.length}, first200=${snapshotText.slice(0, 200).replace(/\n/g, ' ')}`);
      if (/login|signin|登录|扫码|未登录|please log in/i.test(snapshotText)) {
        const screenshot = await this.captureScreenshot(`${input.platform}-not-logged-in`);
        return {
          status: 'failed',
          message: `${input.platform} 账号未登录 (页面包含 login 关键字)`,
          ...screenshot,
          nextAction: '请在浏览器中完成登录，cookies 自动持久化到 profile',
        };
      }

      // 2. 用 browser_snapshot 拿 a11y tree 找评论框 / 私信输入框 ref
      // 2026-06-04: 走 MCP 真实 click/fill (从 a11y tree 解析 ref)
      // 抖音评论页：ref 通常是 "[contenteditable]" 或 "textarea[placeholder*='回复']"
      // 视频号评论页：ref 通常是 "textarea[placeholder*='回复']"
      const editorSelectors: Record<string, string> = {
        'douyin-comment-reply': 'textarea[placeholder*="回复"], [contenteditable="true"]',
        'douyin-direct-message-reply': 'textarea, [contenteditable="true"]',
        'wechat-channel-comment-reply': 'textarea[placeholder*="回复"], [contenteditable="true"]',
        'wechat-channel-direct-message-reply': 'textarea, [contenteditable="true"]',
      };
      const editorSelector = editorSelectors[input.taskType] || 'textarea';
      const submitSelector = 'button:has-text("发送"), button:has-text("回复")';

      // 2026-06-04: MCP tools/call 不抛 isError=true, 需自己检查 result.isError
      const fillResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_fill_form',
          arguments: {
            fields: [{ name: 'reply', type: 'textbox', value: input.replyText, target: editorSelector }],
          },
        },
      });
      const fillOk = !fillResult?.isError;
      if (!fillOk) {
        const errText = (fillResult?.content?.[0]?.text ?? '').slice(0, 120);
        this.logger.warn(`browser_fill_form 失败: ${errText}`);
      }

      let clickOk = true;
      if (fillOk && input.action === 'send') {
        const clickResult = await this.mcp.rpcCall({
          jsonrpc: '2.0',
          id: this.nextId(),
          method: 'tools/call',
          params: { name: 'browser_click', arguments: { element: '发送按钮', target: submitSelector } },
        });
        clickOk = !clickResult?.isError;
        if (!clickOk) {
          this.logger.warn(`browser_click submit 失败: ${(clickResult?.content?.[0]?.text ?? '').slice(0, 120)}`);
        }
      }

      // 3. 截图
      const screenshot = await this.captureScreenshot(`${input.platform}-${input.action}`);

      const finalStatus = fillOk && clickOk
        ? (input.action === 'send' ? 'sent' : 'drafted')
        : 'failed';
      const finalMessage = fillOk && clickOk
        ? `通过 playwright-mcp 已 fill 编辑器${input.action === 'send' ? ' + click 发送' : ''}（${input.platform} ${input.taskType}）`
        : `MCP fill/click 失败: 编辑器未找到 (账号可能未登录或页面结构变了)`;
      this.logger.warn(`dispatch final: ${input.platform}/${input.taskType} fillOk=${fillOk} clickOk=${clickOk} status=${finalStatus}`);
      return {
        status: finalStatus,
        message: finalMessage,
        ...screenshot,
        nextAction: fillOk && clickOk
          ? (input.action === 'send' ? '已通过 MCP 真实发评论/私信' : '草稿已填入')
          : '检查 playwright-mcp 状态 + 平台账号登录态',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP dispatch failed: ${message}`);
      return {
        status: 'failed',
        message: `MCP dispatch 失败: ${message}`,
        nextAction: '检查 playwright-mcp sidecar 状态 (/api/mcp/status)',
      };
    }
  }

  private nextId(): number {
    return Math.floor(Math.random() * 1e9) + 1;
  }

  private async captureScreenshot(label: string): Promise<{ evidencePath?: string; evidenceUrl?: string }> {
    try {
      const sessionKey = `${label}-${Date.now()}`;
      const result = await this.browser.captureEvidence({ sessionKey, label });
      return { evidencePath: result.path, evidenceUrl: result.url };
    } catch {
      return {};
    }
  }
}
