/**
 * 云端 API 适配器
 * 
 * 在 Electron 环境中使用 window.electronAPI.cloudAPI
 * 在浏览器环境中直接调用云端 API（用于开发测试）
 */

interface GenerateReplyInput {
  platform: string;
  scene: 'comment' | 'direct_message' | 'wechat_session' | 'group';
  customerMessage: string;
  recentContext?: string[];
  businessProfile?: string;
}

interface GenerateReplyOutput {
  reply: string;
  shouldSend: boolean;
  confidence: number;
  reason?: string;
}

interface CheckContentInput {
  replyText: string;
  platform: string;
}

interface CheckContentOutput {
  canSend: boolean;
  blockedReason?: string;
}

interface CheckDedupInput {
  accountId: string;
  targetText: string;
  kind: 'comment' | 'message';
}

interface CheckDedupOutput {
  isDuplicate: boolean;
}

interface MarkSentInput {
  accountId: string;
  targetText: string;
  replyText: string;
  kind: 'comment' | 'message';
}

interface MarkSentOutput {
  ok: boolean;
}

interface CloudUser {
  id?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

interface UsageStats {
  [key: string]: unknown;
}

interface LoginOutput {
  token: string;
  user: CloudUser;
}

interface ElectronCloudAPI {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutput>;
  checkContent(input: CheckContentInput): Promise<CheckContentOutput>;
  checkDedup(input: CheckDedupInput): Promise<CheckDedupOutput>;
  markSent(input: MarkSentInput): Promise<MarkSentOutput>;
  getUserInfo(): Promise<CloudUser>;
  getUsageStats(): Promise<UsageStats>;
}

interface ElectronConfigAPI {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<unknown>;
}

interface ElectronServiceAPI {
  restart(): Promise<{ success: boolean }>;
  status(): Promise<{ python: { running: boolean; pid: number | null }; backend: { running: boolean; pid: number | null } }>;
}

interface ElectronAppAPI {
  getVersion(): Promise<string>;
  getPlatform(): Promise<NodeJS.Platform>;
  getDataPath(): Promise<string>;
  checkUpdate(): Promise<{ success: boolean }>;
  installUpdate(): Promise<void>;
  getUpdateStatus(): Promise<{
    configured?: boolean;
    phase?: string;
    hasUpdate?: boolean;
    downloaded?: boolean;
    version?: string | null;
    releaseDate?: string | null;
    releaseNotes?: string | null;
    progress?: number;
    error?: string | null;
    envUrl?: string | null;
  }>;
  downloadUpdate(): Promise<{ success: boolean }>;
  skipUpdate(version: string | null): Promise<{ success: boolean }>;
  getUpdateFeedInfo(): Promise<{ configured: boolean; envUrl: string | null }>;
}

interface ElectronShellAPI {
  openExternal(url: string): Promise<void>;
  showItemInFolder(fullPath: string): void;
}

export interface UpdateEventCallbacks {
  onUpdateState?: (cb: (state: Record<string, unknown>) => void) => string;
  onUpdateDownloadProgress?: (cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => string;
  onUpdateAvailable?: (cb: (info: { version: string; releaseDate?: string; releaseNotes?: string | string[] }) => void) => string;
  onUpdateDownloaded?: (cb: (info: { version: string; releaseDate?: string; releaseNotes?: string | string[] }) => void) => string;
  onUpdateNotAvailable?: (cb: () => void) => string;
  onUpdateError?: (cb: (err: { message: string }) => void) => string;
  onUpdateChecking?: (cb: () => void) => string;
  onServiceStatus?: (cb: (status: { python: { running: boolean }; backend: { running: boolean } }) => void) => string;
  removeListener?: (key: string) => void;
  removeAllListeners?: () => void;
}

interface ElectronWorkspaceTabsAPI {
  open(workspaceId?: string | null, title?: string): Promise<unknown>;
  openOctop(url?: string | null, token?: string | null): Promise<unknown>;
  switchTo(tabId: string): Promise<unknown>;
  switchBusiness(): Promise<unknown>;
  close(tabId: string): Promise<unknown>;
  setWorkspaceId(tabId: string, wsId: string | null): Promise<unknown>;
  list(): Promise<Array<{ id: string; title: string; workspaceId?: string | null; kind?: string; pinned?: boolean }>>;
  getActive(): Promise<{ id: string; title: string; workspaceId?: string | null; kind?: string; pinned?: boolean } | null>;
}

interface ElectronAPI {
  cloudAPI: ElectronCloudAPI;
  workspaceTabs: ElectronWorkspaceTabsAPI;
  config: ElectronConfigAPI;
  service: ElectronServiceAPI;
  app: ElectronAppAPI;
  shell: ElectronShellAPI;
  onUpdateState(cb: (state: Record<string, unknown>) => void): string;
  onUpdateDownloadProgress(cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): string;
  onUpdateAvailable(cb: (info: { version: string }) => void): string;
  onUpdateDownloaded(cb: (info: { version: string }) => void): string;
  onUpdateNotAvailable(cb: () => void): string;
  onUpdateError(cb: (err: { message: string }) => void): string;
  onUpdateChecking(cb: () => void): string;
  onServiceStatus(cb: (status: { python: { running: boolean }; backend: { running: boolean } }) => void): string;
  on(channel: string, cb: (...args: unknown[]) => void): string;
  removeListener(key: string): void;
  removeAllListeners(): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// 检测是否在 Electron 环境中
function isElectron(): boolean {
  return typeof window !== 'undefined' && 
         typeof window.electronAPI !== 'undefined';
}

// 浏览器环境的云端 API 调用（开发测试用）
// 浏览器端不再直连企业服务（P1 安全加固：凭据收敛后端，同源代理 /api/cloud-api/*）。
// 桌面端（Electron）仍可经 electronAPI 直连，由桌面自有凭据机制管理。

/**
 * P1 安全加固：浏览器端不再直连 enterprise 云服务、不再持有/存储
 * cloudApiToken（localStorage 明文凭据 = XSS 可盗）。统一走同源
 * 后端代理 /api/cloud-api/*（后端持有凭据与调用，前端零凭据）。
 * enterprise 路径（/api/v1/...）映射为代理路径（/api/cloud-api/...）。
 */
async function browserCloudRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const proxyPath = path.replace(/^\/api\/v1\//, '/api/cloud-api/');
  const url = proxyPath;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>)
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// 云端 API 适配器
export const cloudAPI = {
  // AI 生成回复
  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutput> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.generateReply(input);
    }

    return browserCloudRequest<GenerateReplyOutput>('/api/v1/generate-reply', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  // 检查内容是否可发送
  async checkContent(input: CheckContentInput): Promise<CheckContentOutput> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.checkContent(input);
    }

    return browserCloudRequest<CheckContentOutput>('/api/v1/check-content', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  // 检查是否重复
  async checkDedup(input: CheckDedupInput): Promise<CheckDedupOutput> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.checkDedup(input);
    }

    return browserCloudRequest<CheckDedupOutput>('/api/v1/check-dedup', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  // 标记已发送
  async markSent(input: MarkSentInput): Promise<MarkSentOutput> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.markSent(input);
    }

    return browserCloudRequest<MarkSentOutput>('/api/v1/mark-sent', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  // 用户登录
  async login(username: string, password: string): Promise<LoginOutput> {
    if (isElectron() && window.electronAPI) {
      // Electron 环境中，登录由主进程处理
      const result = await browserCloudRequest<LoginOutput>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      
      if (result.token) {
        await window.electronAPI.config.set('apiToken', result.token);
      }
      
      return result;
    }

    // 浏览器端不再直连企业登录/持有 token（P1 安全加固），
    // 业务能力统一走后端代理；保留方法签名兼容调用方。
    return browserCloudRequest<LoginOutput>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  // 获取用户信息
  async getUserInfo(): Promise<CloudUser> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.getUserInfo();
    }

    return browserCloudRequest<CloudUser>('/api/v1/auth/me');
  },

  // 获取使用统计
  async getUsageStats(): Promise<UsageStats> {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.cloudAPI.getUsageStats();
    }

    return browserCloudRequest<UsageStats>('/api/v1/usage/stats');
  }
};

// 导出类型
export type {
  GenerateReplyInput,
  GenerateReplyOutput,
  CheckContentInput,
  CheckContentOutput,
  CheckDedupInput,
  CheckDedupOutput,
  MarkSentInput,
  MarkSentOutput
};
