import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  apiFetch,
  buildFrontendUrl,
  openExternalUrl,
  type ApiResult,
} from './client.js';
import {
  createKaypalAiContentAppMetadata,
  KAYPAL_AI_CONTENT_APP_URI,
} from './app-resource.js';
import { hasAuthCookie, type KaypalAiContentContext } from './context.js';

type ToolTextResult = { content: Array<{ type: 'text'; text: string }> };
type ServiceProbe = {
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
};

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_CONTENT_ROOT =
  process.env.KAYPAL_AI_CONTENT_ROOT?.trim() || resolve(__dirname, '../../..');
const LOCAL_SERVICE_ACTIONS = ['status', 'start', 'stop'] as const;

const PAGE_PATHS = {
  home: '/',
  accounts: '/distribution?tab=accounts',
  run_check: '/capabilities/account',
  runtime: '/local-engine',
  douyin_comments: '/workbench/douyin-comments',
  douyin_messages: '/workbench/douyin-messages',
  channel_comments: '/workbench/channel-comments',
  channel_messages: '/workbench/channel-messages',
  artifacts: '/artifacts',
  topics: '/topics',
  materials: '/materials',
} as const;

const BUSINESS_AREAS = [
  'comments',
  'messages',
  'channel-comments',
  'channel-messages',
  'wechat',
  'groups',
] as const;

const ENTRY_TYPES = [
  'douyin-comments',
  'douyin-messages',
  'channel-comments',
  'channel-messages',
] as const;

function textResult(value: unknown): ToolTextResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function collect(
  entries: Array<[string, Promise<ApiResult>]>,
): Promise<Record<string, ApiResult>> {
  const settled = await Promise.all(
    entries.map(async ([key, promise]) => [key, await promise] as const),
  );
  return Object.fromEntries(settled);
}

function authNote(ctx: KaypalAiContentContext) {
  if (hasAuthCookie(ctx)) {
    return ctx.authCookieSource === 'local-mcp-session'
      ? '已通过本机 MCP 会话桥恢复 3010 登录态并透传给 3011。'
      : '已向 3011 透传 KAYPAL_AI_CONTENT_COOKIE/KAYPAL_AI_CONTENT_SESSION。';
  }
  return `未拿到 3010 登录态；将尝试读取本机 MCP 会话桥文件：${ctx.localMcpAuthFile || '未配置'}`;
}

function requireConfirm(confirm: boolean | undefined, action: string): void {
  if (confirm !== true) {
    throw new Error(`${action} 需要显式传 confirm=true。`);
  }
}

async function probeUrl(url: string, timeoutMs = 3000): Promise<ServiceProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      ok: response.ok || response.status < 500,
      url,
      status: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      url,
      error:
        message === 'This operation was aborted'
          ? `请求超时：${url}`
          : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function listPortListeners(port: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { timeout: 3000, maxBuffer: 128 * 1024 },
    );
    return stdout.trim();
  } catch (error) {
    const err = error as { code?: number; stdout?: string; message?: string };
    if (err.code === 1) {
      return '';
    }
    return err.stdout?.trim() || err.message || 'lsof unavailable';
  }
}

async function localServiceStatus(ctx: KaypalAiContentContext) {
  const [frontend, backendSetup, localEngine, port3010, port3011] =
    await Promise.all([
      probeUrl(`${ctx.frontendBase}/`),
      probeUrl(`${ctx.apiBase}/auth/setup-status`),
      apiFetch(ctx, '/local-engine/health', { auth: false }),
      listPortListeners(3010),
      listPortListeners(3011),
    ]);
  return {
    frontend,
    backendSetup,
    localEngine,
    ports: {
      3010: port3010 || null,
      3011: port3011 || null,
    },
    online: Boolean(frontend.ok && (backendSetup.ok || localEngine.ok)),
  };
}

async function runLocalIntegrationScript(action: 'start' | 'stop') {
  if (process.platform === 'win32') {
    return {
      ok: false,
      unsupported: true,
      message:
        '当前启动脚本是 POSIX shell 版本，Windows 需要桌面打包启动编排或 PowerShell 版本。',
    };
  }
  const scriptPath = resolve(
    AI_CONTENT_ROOT,
    'scripts',
    `${action}-local-integration.sh`,
  );
  await access(scriptPath);
  try {
    const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
      cwd: AI_CONTENT_ROOT,
      timeout: action === 'start' ? 180_000 : 30_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      scriptPath,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    const err = error as {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      ok: false,
      scriptPath,
      code: err.code,
      signal: err.signal,
      stdout: err.stdout?.trim(),
      stderr: err.stderr?.trim(),
      error: err.message || 'script failed',
    };
  }
}

export function registerKaypalAiContentTools(
  server: McpServer,
  ctx: KaypalAiContentContext,
): void {
  server.registerTool(
    'kaypal_ai_content_open_app',
    {
      title: '打开 Kaypal AI Content 应用',
      description:
        '返回 Kaypal AI Content 的 Goose MCP 应用 UI 资源，作为本机 3010/3011 工作台入口。',
      inputSchema: {},
      _meta: {
        ui: {
          resourceUri: KAYPAL_AI_CONTENT_APP_URI,
        },
        'ui/resourceUri': KAYPAL_AI_CONTENT_APP_URI,
      },
    },
    async () =>
      textResult({
        ok: true,
        app: createKaypalAiContentAppMetadata(),
        message:
          '已返回 Kaypal AI Content Goose 应用入口；如果 Goose 没自动打开，请在对话里要求打开 kaypal_ai_content_open_app。',
      }),
  );

  server.registerTool(
    'kaypal_ai_content_local_services',
    {
      title: '本机 3010/3011 服务控制',
      description:
        '检查、启动或停止 Kaypal AI Content 本机 3010 前端和 3011 后端。start/stop 会改变本机进程状态，必须 confirm=true。',
      inputSchema: {
        action: z.enum(LOCAL_SERVICE_ACTIONS).default('status'),
        confirm: z
          .boolean()
          .default(false)
          .describe('start/stop 必须为 true；status 不需要'),
      },
    },
    async (args) => {
      if (args.action === 'status') {
        return textResult(await localServiceStatus(ctx));
      }
      requireConfirm(args.confirm, `本机服务 ${args.action}`);
      const before = await localServiceStatus(ctx);
      const command = await runLocalIntegrationScript(args.action);
      const after = await localServiceStatus(ctx);
      return textResult({
        action: args.action,
        root: AI_CONTENT_ROOT,
        before,
        command,
        after,
      });
    },
  );

  server.registerTool(
    'kaypal_ai_content_health_check',
    {
      title: 'Kaypal AI Content 健康检查',
      description:
        '检查本机 3011 后端、Agent-S、Playwright MCP、运行检查和当前 Goose 鉴权状态。',
      inputSchema: {},
    },
    async () => {
      const result = await collect([
        ['autoUpload', apiFetch(ctx, '/auto-upload/health', { auth: false })],
        ['agentS', apiFetch(ctx, '/agent-s/health', { auth: false })],
        ['mcp', apiFetch(ctx, '/mcp/status', { auth: false })],
        ['localEngine', apiFetch(ctx, '/local-engine/health')],
        ['me', apiFetch(ctx, '/auth/me')],
      ]);
      return textResult({
        ok: Object.values(result).some((item) => item.ok),
        apiBase: ctx.apiBase,
        frontendBase: ctx.frontendBase,
        auth: authNote(ctx),
        result,
      });
    },
  );

  server.registerTool(
    'kaypal_ai_content_open_page',
    {
      title: '打开 Kaypal AI Content 页面',
      description:
        '在系统浏览器打开 3010 的常用页面，如账号、运行检查、抖音评论、视频号私信。',
      inputSchema: {
        page: z
          .enum(Object.keys(PAGE_PATHS) as [keyof typeof PAGE_PATHS, ...(keyof typeof PAGE_PATHS)[]])
          .describe('预设页面'),
        customPath: z
          .string()
          .optional()
          .describe('可选自定义路径；传入后优先于 page，例如 /capabilities/account'),
      },
    },
    async (args) => {
      const path = args.customPath?.trim() || PAGE_PATHS[args.page];
      const url = buildFrontendUrl(ctx, path);
      const opened = await openExternalUrl(url);
      return textResult({ ok: opened.ok, url, opened });
    },
  );

  server.registerTool(
    'kaypal_ai_content_account_status',
    {
      title: '平台账号状态',
      description:
        '读取 3011 的平台账号和登录态，可选触发真实登录态校验。',
      inputSchema: {
        validate: z.boolean().default(false).describe('是否做真实登录态校验'),
        force: z.boolean().default(false).describe('是否强制刷新缓存'),
      },
    },
    async (args) => {
      const query = new URLSearchParams({
        validate: String(args.validate),
        force: String(args.force),
      });
      const result = await collect([
        ['accounts', apiFetch(ctx, `/auto-upload/accounts?${query}`)],
        ['health', apiFetch(ctx, `/auto-upload/accounts/health?${query}`)],
      ]);
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_kaypal_profile',
    {
      title: 'Kaypal 账户与权益',
      description:
        '读取当前 3010 登录用户、Kaypal 测试站账户、订阅套餐和积分/账单状态。',
      inputSchema: {},
    },
    async () => {
      const result = await collect([
        ['me', apiFetch(ctx, '/auth/me')],
        ['profile', apiFetch(ctx, '/kaypal/profile')],
        ['subscription', apiFetch(ctx, '/kaypal/subscription')],
        ['billing', apiFetch(ctx, '/kaypal/billing')],
      ]);
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_runtime_status',
    {
      title: '本机运行检查',
      description:
        '读取本机 Runtime、浏览器、执行器、桌面权限、文件访问和 MCP 工具状态。',
      inputSchema: {},
    },
    async () => {
      const result = await collect([
        ['health', apiFetch(ctx, '/local-engine/health')],
        ['readiness', apiFetch(ctx, '/local-engine/readiness')],
        ['browser', apiFetch(ctx, '/local-engine/browser/status')],
        ['executors', apiFetch(ctx, '/local-engine/executors/status')],
        ['desktop', apiFetch(ctx, '/local-engine/desktop/status')],
        ['files', apiFetch(ctx, '/local-engine/files/status')],
        ['mcpStatus', apiFetch(ctx, '/mcp/status', { auth: false })],
        ['mcpTools', apiFetch(ctx, '/mcp/tools', { auth: false })],
      ]);
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_list_tasks',
    {
      title: '查看互动任务',
      description:
        '查看抖音评论/私信、视频号评论/私信、微信等互动任务列表。',
      inputSchema: {
        area: z.enum(BUSINESS_AREAS).describe('任务业务区'),
        limit: z.number().int().min(1).max(100).default(20),
        status: z.string().optional().describe('可选状态过滤'),
      },
    },
    async (args) => {
      const query = new URLSearchParams({ limit: String(args.limit) });
      if (args.status) query.set('status', args.status);
      const result = await apiFetch(
        ctx,
        `/local-engine/${args.area}/tasks?${query}`,
      );
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_list_records',
    {
      title: '查看互动记录',
      description:
        '查看抖音评论/私信、视频号评论/私信、微信等执行记录和证据状态。',
      inputSchema: {
        area: z.enum(BUSINESS_AREAS).describe('记录业务区'),
        limit: z.number().int().min(1).max(100).default(20),
        status: z.string().optional().describe('可选状态过滤'),
      },
    },
    async (args) => {
      const query = new URLSearchParams({ limit: String(args.limit) });
      if (args.status) query.set('status', args.status);
      const result = await apiFetch(
        ctx,
        `/local-engine/${args.area}/records?${query}`,
      );
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_generate_reply',
    {
      title: 'AI 回复生成',
      description:
        '根据用户留言/私信文本生成建议回复；只生成文本，不发送到外部平台。',
      inputSchema: {
        sourceText: z.string().min(1).describe('用户评论或私信原文'),
        targetName: z.string().optional().describe('对方昵称'),
        accountName: z.string().optional().describe('平台账号名'),
      },
    },
    async (args) => {
      const result = await apiFetch(ctx, '/local-engine/reply/generate', {
        method: 'POST',
        body: args,
      });
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_open_interaction_entry',
    {
      title: '打开互动入口',
      description:
        '调用 3011 CDP 持久浏览器打开平台互动入口，并返回页面探测证据；不会发送消息。',
      inputSchema: {
        accountId: z.number().int().positive().describe('平台账号 ID'),
        entryType: z.enum(ENTRY_TYPES).describe('互动入口类型'),
        confirm: z.boolean().default(false).describe('必须为 true 才会启动 CDP 打开入口'),
      },
    },
    async (args) => {
      requireConfirm(args.confirm, '打开平台互动入口');
      const result = await apiFetch(ctx, '/auto-upload/interaction/open-entry', {
        method: 'POST',
        body: {
          accountId: args.accountId,
          entryType: args.entryType,
        },
      });
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_discover_topics',
    {
      title: '智能挖题',
      description:
        '调用 Kaypal AI Content 的智能挖题接口，会访问模型台并可能消耗积分。',
      inputSchema: {
        seed: z.string().min(1).describe('关键词、事件或选题描述'),
        confirm: z.boolean().default(false).describe('必须为 true 才会调用模型台'),
      },
    },
    async (args) => {
      requireConfirm(args.confirm, '智能挖题');
      const result = await apiFetch(ctx, '/topics/discover', {
        method: 'POST',
        body: { seed: args.seed },
        timeoutMs: 60_000,
      });
      return textResult({ auth: authNote(ctx), result });
    },
  );

  server.registerTool(
    'kaypal_ai_content_generate_article',
    {
      title: '按选题生成文章',
      description:
        '按已有 topicId 生成图文文章或小红书笔记，会访问模型台并可能消耗积分。',
      inputSchema: {
        topicId: z.string().min(1).describe('选题 ID'),
        contentType: z.enum(['article', 'xiaohongshu']).default('article'),
        force: z.boolean().default(false).describe('是否强制重新生成'),
        confirm: z.boolean().default(false).describe('必须为 true 才会调用模型台'),
      },
    },
    async (args) => {
      requireConfirm(args.confirm, '按选题生成文章');
      const query = new URLSearchParams({
        force: String(args.force),
        contentType: args.contentType,
      });
      const result = await apiFetch(
        ctx,
        `/articles/${encodeURIComponent(args.topicId)}/generate?${query}`,
        {
          method: 'POST',
          timeoutMs: 120_000,
        },
      );
      return textResult({ auth: authNote(ctx), result });
    },
  );
}
