import { api, getApiBase } from "./client";
import type {
  AgentConfirmation,
  AgentSession,
  InteractionTask,
} from "./local-engine";
import type { RunIntelligenceSearchResult } from "./intelligence";

export type VoiceBillingStatus = {
  tenantId: string;
  user: {
    id: string;
    email: string;
    kaypalUserId?: string | null;
  };
  entitlement: {
    source: string;
    plan: string;
    status: string;
    commercialExecutionAllowed: boolean;
    externalSubscriptionId: string | null;
    periodEnd: string | null;
  } | null;
  latestSubscription: {
    provider: string;
    externalSubscriptionId: string;
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  latestInvoice: {
    provider: string;
    externalInvoiceId: string;
    externalSubscriptionId: string | null;
    status: string;
    amountDue: number;
    amountPaid: number;
    currency: string;
    paidAt: string | null;
    failedAt: string | null;
  } | null;
};

export type VoiceClientKind =
  | "bailongma-desktop"
  | "kaypal-web"
  | "external-client";

export type VoiceToolRisk = "low" | "medium" | "high";

export type VoicePairInput = {
  clientKind?: VoiceClientKind;
  clientName?: string;
  deviceId?: string;
  deviceName?: string;
  requestedTtlHours?: number;
};

export type VoicePairResult = {
  tokenType: "Bearer";
  accessToken: string;
  sessionId: string;
  expiresAt: string;
  scopes: string[];
  usage: {
    header: string;
    example: string;
  };
};

export type VoiceHeartbeatInput = {
  clientKind?: VoiceClientKind;
  clientName?: string;
  deviceId?: string;
  status?: "online" | "idle" | "busy";
};

export type VoiceToolDescriptor = {
  name: string;
  title: string;
  description: string;
  mode: "voice-assist" | "kaypal-business" | "hybrid";
  risk: VoiceToolRisk;
  requiresKaypalConnection: boolean;
};

export type VoiceState = {
  user: {
    id: string;
    name: string;
    email: string;
    kaypalUserId?: string | null;
    plan?: string;
    role?: string | null;
  };
  companion: {
    productName: string;
    mode: "embedded-3010-voice-module";
    embeddedIn3010: boolean;
    summary: string;
    generalCapabilities: string[];
  };
  kaypal: {
    connected: boolean;
    billing: VoiceBillingStatus | null;
    billingStatus: "ready" | "temporarily_unavailable";
    billingMessage?: string;
    pendingConfirmations: {
      count: number;
      items: AgentConfirmation[];
      status: "ready" | "temporarily_unavailable";
      message?: string;
    };
    recentWechatTasks: {
      count: number;
      items: InteractionTask[];
      status: "ready" | "temporarily_unavailable";
      message?: string;
    };
  };
  tools: {
    general: VoiceToolDescriptor[];
    kaypal: VoiceToolDescriptor[];
    hybrid: VoiceToolDescriptor[];
  };
};

export type VoiceCommandInput = {
  text?: string;
  source?: VoiceClientKind | string;
  locale?: string;
  platform?: "all" | "douyin" | "xiaohongshu" | "bilibili" | "wechat" | "gongzhonghao";
  target?: "all" | "post" | "account" | "comment" | "engagement";
  keyword?: string;
  limit?: number;
  confirmationId?: string;
  decision?: "approve" | "reject";
  context?: Record<string, unknown>;
};

export type VoiceConfirmInput = {
  confirmationId?: string;
  decision?: "approve" | "reject";
  spokenText?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
};

export type VoiceCommandResult = {
  intent:
    | "general_agent_fallback"
    | "get_state"
    | "get_billing"
    | "list_confirmations"
    | "decide_confirmation"
    | "open_page"
    | "search_intelligence"
    | "create_wechat_task";
  handledBy: "bailongma-general" | "kaypal-voice-bridge";
  risk: VoiceToolRisk;
  responseText: string;
  action?: {
    type: string;
    label: string;
    href?: string;
  };
  data?:
    | VoiceState
    | VoiceBillingStatus
    | AgentConfirmation[]
    | AgentSession
    | InteractionTask
    | RunIntelligenceSearchResult
    | Record<string, unknown>
    | null;
};

export const voiceApi = {
  state() {
    return api.get<VoiceState>("/voice/state");
  },

  pair(input: VoicePairInput = {}) {
    return api.post<VoicePairResult>("/voice/session/pair", input);
  },

  heartbeat(input: VoiceHeartbeatInput = {}) {
    return api.post<{
      connected: boolean;
      userId: string;
      clientKind: string;
      clientName: string;
      deviceId: string | null;
      status: string;
      serverTime: string;
    }>("/voice/session/heartbeat", input);
  },

  command(input: VoiceCommandInput) {
    return api.post<VoiceCommandResult>("/voice/command", input);
  },

  confirm(input: VoiceConfirmInput) {
    return api.post<VoiceCommandResult>("/voice/confirm", input);
  },

  // ── 云 ASR（语音转文字）──

  /** 上传整段 16kHz/16bit/mono PCM，返回识别文本 */
  async asrTranscribe(pcm: ArrayBuffer) {
    const res = await fetch(`${getApiBase()}/api/voice/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      credentials: "include",
      body: pcm,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        message = j.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    return res.json() as Promise<{ ok: boolean; text: string; provider: string; durationMs: number }>;
  },

  asrCapabilities() {
    return api.get<{
      provider: string;
      gateway: string;
      model: string;
      configured: boolean;
      billing: string;
    }>("/voice/asr/capabilities");
  },

  // ── 云 TTS（文字转语音）──

  /** 文本 → 音频 Blob（后端经 kaypal.cn 网关合成） */
  async ttsStream(text: string): Promise<Blob> {
    const res = await fetch(`${getApiBase()}/api/voice/tts/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        message = j.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    return res.blob();
  },

  ttsCapabilities() {
    return api.get<{
      providers: Array<{ id: string; label: string; streaming?: boolean }>;
      voices: Record<string, unknown>;
    }>("/voice/tts/capabilities");
  },
};
