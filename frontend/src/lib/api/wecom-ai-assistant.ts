import { api } from './client';

export type WecomAssistantStatus = 'not_installed' | 'active' | 'test_failed' | 'disabled';
export type WecomOutboundStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type WecomRiskLevel = 'low' | 'medium' | 'high';

export interface WecomAssistantIntegration {
  id: string;
  name: string;
  maskedWebhookUrl: string;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
}

export interface WecomAssistantSettings {
  brandName: string;
  storeName: string;
  replyStyle: string;
  transferKeywords: string;
  sendToWecom: boolean;
  autoSendToCustomer: boolean;
}

export interface WecomMessageRecord {
  id: string;
  type: 'test' | 'auto_reply_suggestion' | 'risk_alert' | 'install' | string;
  status: WecomOutboundStatus;
  title: string;
  content: string;
  createdAt: string;
  errorMessage?: string;
}

export interface WecomAssistantState {
  status: WecomAssistantStatus;
  integration: WecomAssistantIntegration | null;
  settings: WecomAssistantSettings;
  records: WecomMessageRecord[];
}

export interface AutoReplySuggestion {
  customerMessage: string;
  suggestedReply: string;
  shouldTransfer: boolean;
  transferReason?: string;
  riskLevel: WecomRiskLevel;
  action: string;
}

export interface SendAutoReplySuggestionResult {
  state: WecomAssistantState;
  suggestion: AutoReplySuggestion;
  content: string;
  sent: boolean;
}

export const replyStyleOptions = [
  { key: '礼貌专业', label: '礼貌专业' },
  { key: '简短自然', label: '简短自然' },
  { key: '亲切热情', label: '亲切热情' },
  { key: '克制正式', label: '克制正式' },
];

export const defaultTransferKeywords = [
  '退款',
  '投诉',
  '差评',
  '赔偿',
  '人工',
  '客服',
  '支付失败',
  '扣款',
  '退货',
  '换货',
  '发票',
];

export function createDefaultWecomAssistantState(): WecomAssistantState {
  return {
    status: 'not_installed',
    integration: null,
    settings: {
      brandName: 'JIUZHANG AI',
      storeName: '默认门店',
      replyStyle: '礼貌专业',
      transferKeywords: defaultTransferKeywords.join('、'),
      sendToWecom: true,
      autoSendToCustomer: false,
    },
    records: [],
  };
}

export function validateWecomWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'qyapi.weixin.qq.com' &&
      parsed.pathname === '/cgi-bin/webhook/send' &&
      Boolean(parsed.searchParams.get('key'))
    );
  } catch {
    return false;
  }
}

function parseKeywords(value: string) {
  return value
    .split(/[、,，]/)
    .flatMap((item) => item.split(String.fromCharCode(10)))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function generateAutoReplySuggestion(input: {
  customerMessage: string;
  settings: WecomAssistantSettings;
}): AutoReplySuggestion {
  const message = input.customerMessage.trim();
  const keywords = [...defaultTransferKeywords, ...parseKeywords(input.settings.transferKeywords)];
  const hitKeyword = keywords.find((keyword) => keyword && message.includes(keyword));

  if (hitKeyword) {
    return {
      customerMessage: message,
      suggestedReply: '非常抱歉给您带来不便。我先帮您转人工客服进一步核实处理，避免耽误您的问题。',
      shouldTransfer: true,
      transferReason: '命中转人工关键词：' + hitKeyword,
      riskLevel: 'high',
      action: '请人工客服优先跟进，不建议 AI 自动回复。',
    };
  }

  if (message.includes('预约')) {
    return {
      customerMessage: message,
      suggestedReply: '可以的，请问您想预约哪一天/哪个时间段？我帮您先登记确认。',
      shouldTransfer: false,
      riskLevel: 'low',
      action: '客服确认具体时间段后再回复客户。',
    };
  }

  if (message.includes('多少钱') || message.includes('价格') || message.includes('优惠')) {
    return {
      customerMessage: message,
      suggestedReply: '这款价格我这边需要再确认一下，避免给您说错。我先帮您核实一下。',
      shouldTransfer: false,
      riskLevel: 'medium',
      action: '需要查询真实价格或活动后再回复客户。',
    };
  }

  if (message.includes('地址') || message.includes('营业时间') || message.includes('几点开门')) {
    return {
      customerMessage: message,
      suggestedReply: '我先帮您确认门店地址和营业时间，避免您白跑一趟。',
      shouldTransfer: false,
      riskLevel: 'low',
      action: '补充门店地址和营业时间后回复客户。',
    };
  }

  if (message.includes('有货') || message.includes('库存') || message.includes('到货')) {
    return {
      customerMessage: message,
      suggestedReply: '库存会实时变化，我先帮您确认一下门店现货情况，再给您准确回复。',
      shouldTransfer: false,
      riskLevel: 'medium',
      action: '需要查询真实库存后再回复客户。',
    };
  }

  return {
    customerMessage: message,
    suggestedReply: '收到，我帮您看一下。请问您主要想咨询价格、预约，还是售后问题？',
    shouldTransfer: false,
    riskLevel: 'low',
    action: '信息不足，建议先追问客户具体需求。',
  };
}

export async function getWecomAssistantState(): Promise<WecomAssistantState> {
  return api.get<WecomAssistantState>('/wecom-assistant');
}

export async function testWecomWebhook(webhookUrl: string) {
  return api.post<{ success: boolean; message: string; maskedWebhookUrl: string }>('/wecom-assistant/test', {
    webhookUrl,
  });
}

export async function installWecomAssistant(input: {
  name: string;
  webhookUrl: string;
  settings: WecomAssistantSettings;
}) {
  return api.post<WecomAssistantState>('/wecom-assistant/install', input);
}

export async function retestWecomAssistant() {
  return api.post<WecomAssistantState>('/wecom-assistant/retest', {});
}

export async function updateWecomAssistantSettings(settings: WecomAssistantSettings) {
  return api.patch<WecomAssistantState>('/wecom-assistant/settings', settings);
}

export async function setWecomAssistantEnabled(enabled: boolean) {
  return api.patch<WecomAssistantState>('/wecom-assistant/status', { enabled });
}

export async function deleteWecomAssistant() {
  return api.delete<WecomAssistantState>('/wecom-assistant');
}

export async function sendAutoReplySuggestion(customerMessage: string) {
  return api.post<SendAutoReplySuggestionResult>('/wecom-assistant/suggest', {
    customerMessage,
  });
}
