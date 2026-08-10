export type VoiceClientKind =
  | 'bailongma-desktop'
  | 'kaypal-web'
  | 'external-client';

export type VoiceToolRisk = 'low' | 'medium' | 'high';

export type VoiceCommandInput = {
  text: string;
  source?: VoiceClientKind | string;
  locale?: string;
  platform?:
    | 'all'
    | 'douyin'
    | 'xiaohongshu'
    | 'bilibili'
    | 'wechat'
    | 'gongzhonghao';
  target?: 'all' | 'post' | 'account' | 'comment' | 'engagement';
  keyword?: string;
  limit?: number;
  confirmationId?: string;
  decision?: 'approve' | 'reject';
  context?: Record<string, unknown>;
};

export type VoiceConfirmInput = {
  confirmationId?: string;
  decision?: 'approve' | 'reject';
  spokenText?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
};

export type VoiceCommandResult = {
  intent:
    | 'general_agent_fallback'
    | 'get_state'
    | 'get_billing'
    | 'list_confirmations'
    | 'decide_confirmation'
    | 'open_page'
    | 'search_intelligence'
    | 'create_wechat_task';
  handledBy: 'bailongma-general' | 'kaypal-voice-bridge';
  risk: VoiceToolRisk;
  responseText: string;
  action?: {
    type: string;
    label: string;
    href?: string;
  };
  data?: unknown;
};

export type VoiceState = {
  companion: {
    productName: string;
    mode: 'general-agent-plus-kaypal-connector';
    independentAgentAvailable: boolean;
    summary: string;
    generalCapabilities: string[];
  };
  kaypal: {
    connected: boolean;
    pendingConfirmations: {
      count: number;
      items: unknown[];
      error?: string;
    };
    recentWechatTasks: {
      count: number;
      items: unknown[];
      error?: string;
    };
  };
  tools: Record<string, unknown>;
};

export type KaypalVoiceConnectorOptions = {
  baseUrl?: string;
  accessToken: string;
  clientName?: string;
  clientKind?: VoiceClientKind;
  deviceId?: string;
  fetchImpl?: typeof fetch;
};

export type DispatchResult =
  | {
      route: 'kaypal';
      response: VoiceCommandResult;
    }
  | {
      route: 'general-agent';
      fallbackText: string;
      response: VoiceCommandResult;
    };

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:3011/api/voice';

export function createKaypalVoiceConnector(
  options: KaypalVoiceConnectorOptions,
) {
  return new KaypalVoiceConnector(options);
}

export class KaypalVoiceConnector {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly clientName: string;
  private readonly clientKind: VoiceClientKind;
  private readonly deviceId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KaypalVoiceConnectorOptions) {
    if (!options.accessToken?.trim()) {
      throw new Error('KAYPAL voice access token is required');
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
    this.accessToken = options.accessToken.trim();
    this.clientName = options.clientName || 'BaiLongma';
    this.clientKind = options.clientKind || 'bailongma-desktop';
    this.deviceId = options.deviceId;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('A fetch implementation is required');
    }
  }

  state() {
    return this.request<VoiceState>('/state');
  }

  heartbeat(status: 'online' | 'idle' | 'busy' = 'online') {
    return this.request<{
      connected: boolean;
      userId: string;
      clientKind: string;
      clientName: string;
      deviceId: string | null;
      status: string;
      serverTime: string;
    }>('/session/heartbeat', {
      method: 'POST',
      body: {
        clientKind: this.clientKind,
        clientName: this.clientName,
        deviceId: this.deviceId,
        status,
      },
    });
  }

  command(input: string | VoiceCommandInput) {
    const body =
      typeof input === 'string'
        ? { text: input, source: this.clientKind }
        : { source: this.clientKind, ...input };
    return this.request<VoiceCommandResult>('/command', {
      method: 'POST',
      body,
    });
  }

  confirm(input: VoiceConfirmInput) {
    return this.request<VoiceCommandResult>('/confirm', {
      method: 'POST',
      body: input,
    });
  }

  async dispatchVoiceCommand(input: string | VoiceCommandInput) {
    const response = await this.command(input);
    if (response.handledBy === 'kaypal-voice-bridge') {
      return {
        route: 'kaypal',
        response,
      } satisfies DispatchResult;
    }
    return {
      route: 'general-agent',
      fallbackText:
        typeof input === 'string' ? input : input.text || response.responseText,
      response,
    } satisfies DispatchResult;
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const payload = parseJson<ApiResponse<T>>(text);
    if (!response.ok || payload?.success === false) {
      throw new Error(
        payload?.message || `KAYPAL voice request failed: ${response.status}`,
      );
    }

    if (payload && 'data' in payload) {
      return payload.data as T;
    }
    return parseJson<T>(text) as T;
  }
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/api/voice')) return trimmed;
  if (trimmed.endsWith('/voice')) return trimmed;
  if (trimmed.endsWith('/api')) return `${trimmed}/voice`;
  return `${trimmed}/api/voice`;
}

function parseJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
