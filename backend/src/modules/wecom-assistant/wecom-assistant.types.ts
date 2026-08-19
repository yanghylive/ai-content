export type WecomAssistantStatus =
  'not_installed' | 'active' | 'test_failed' | 'disabled';
export type WecomRiskLevel = 'low' | 'medium' | 'high';
export type WecomOutboundStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface WecomAssistantSettingsDto {
  brandName?: string | null;
  storeName?: string | null;
  replyStyle?: string | null;
  transferKeywords?: string | string[] | null;
  sendToWecom?: boolean | null;
  autoSendToCustomer?: boolean | null;
}

export interface AutoReplySuggestion {
  customerMessage: string;
  suggestedReply: string;
  shouldTransfer: boolean;
  transferReason?: string;
  riskLevel: WecomRiskLevel;
  action: string;
}
