import type { BillingStatus } from '../billing/billing.types';
import type {
  AgentConfirmationListItem,
  InteractionTask,
} from '../local-engine/local-engine.types';

export type VoiceToolRisk = 'low' | 'medium' | 'high';

export type VoiceToolDescriptor = {
  name: string;
  title: string;
  description: string;
  mode: 'voice-assist' | 'kaypal-business' | 'hybrid';
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
    mode: 'embedded-3010-voice-module';
    embeddedIn3010: boolean;
    summary: string;
    generalCapabilities: string[];
  };
  kaypal: {
    connected: boolean;
    billing: BillingStatus | null;
    billingStatus: 'ready' | 'temporarily_unavailable';
    billingMessage?: string;
    pendingConfirmations: {
      count: number;
      items: AgentConfirmationListItem[];
      status: 'ready' | 'temporarily_unavailable';
      message?: string;
    };
    recentWechatTasks: {
      count: number;
      items: InteractionTask[];
      status: 'ready' | 'temporarily_unavailable';
      message?: string;
    };
  };
  tools: {
    general: VoiceToolDescriptor[];
    kaypal: VoiceToolDescriptor[];
    hybrid: VoiceToolDescriptor[];
  };
};

export type VoiceCommandIntent =
  | 'general_agent_fallback'
  | 'get_state'
  | 'get_billing'
  | 'list_confirmations'
  | 'decide_confirmation'
  | 'open_page'
  | 'search_intelligence'
  | 'create_wechat_task';

export type VoiceCommandResult = {
  intent: VoiceCommandIntent;
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

export type VoicePairResult = {
  tokenType: 'Bearer';
  accessToken: string;
  sessionId: string;
  expiresAt: string;
  scopes: string[];
  usage: {
    header: string;
    example: string;
  };
};

export type VoiceChatResult = {
  content: string;
  account: {
    kaypalUserId: string;
    plan?: string;
  };
  usageMode: 'kaypal-subscription-credits';
};

export type VoiceMediaImageResult = {
  urls: string[];
  account: {
    kaypalUserId: string;
    plan?: string;
  };
  usageMode: 'kaypal-subscription-credits';
};

export type VoiceAsrMeterResult = {
  accepted: true;
  account: {
    kaypalUserId: string;
    plan?: string;
  };
  usageMode: 'kaypal-subscription-credits';
  service: 'voice_recognition';
  sessionId?: string;
};
