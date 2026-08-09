import { api } from "./client";

// ============ 企业微信客户联系（wecom-crm）API ============

export interface WecomCorpConfig {
  id: string;
  name: string;
  corpId: string;
  agentId: string | null;
  status: string;
  maskedSecret: string;
  callbackVerified: boolean;
  callbackUrl: string | null;
  lastTokenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WecomState {
  configs: WecomCorpConfig[];
  apiBase: string;
}

export type WecomMsgType = "text" | "image" | "link" | "miniprogram";

export interface WecomGroupMsgTask {
  id: string;
  configId: string;
  msgType: WecomMsgType;
  content: Record<string, unknown>;
  externalUserIds: string[];
  senderIds: string[];
  wecomMsgId: string | null;
  status: string;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WecomMomentTask {
  id: string;
  configId: string;
  text: string | null;
  attachments: Array<Record<string, unknown>> | null;
  wecomJobId: string | null;
  status: string;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WecomContact {
  externalUserId: string;
  memberUserId: string;
  name: string;
}

export const wecomCrmApi = {
  state: () => api.get<WecomState>("/wecom-crm/state"),

  saveConfig: (body: {
    id?: string;
    name?: string;
    corpId?: string;
    corpSecret?: string;
    agentId?: string;
    callbackToken?: string;
    callbackEncodingAesKey?: string;
  }) => api.post<WecomCorpConfig>("/wecom-crm/configs", body),

  testConfig: (configId: string) =>
    api.post<{ ok: boolean; tokenPrefix?: string }>("/wecom-crm/configs/test", {
      configId,
    }),

  deleteConfig: (configId: string) =>
    api.delete<{ ok: boolean }>(`/wecom-crm/configs/${configId}`),

  listContacts: (configId: string, memberUserId?: string) => {
    const qs = memberUserId
      ? `?memberUserId=${encodeURIComponent(memberUserId)}`
      : "";
    return api.get<{ count: number; contacts: WecomContact[] }>(
      `/wecom-crm/configs/${configId}/contacts${qs}`,
    );
  },

  createGroupMsg: (body: {
    configId: string;
    msgType: WecomMsgType;
    content: Record<string, unknown>;
    externalUserIds: string[];
    senderIds: string[];
  }) => api.post<WecomGroupMsgTask>("/wecom-crm/group-msgs", body),

  listGroupMsgs: () => api.get<WecomGroupMsgTask[]>("/wecom-crm/group-msgs"),

  queryGroupMsgResult: (taskId: string) =>
    api.post<{ status: string; sendCount: number; failCount: number }>(
      `/wecom-crm/group-msgs/${taskId}/result`,
    ),

  createMoment: (body: {
    configId: string;
    text?: string;
    attachments?: Array<Record<string, unknown>>;
    visibleRange?: Record<string, unknown>;
  }) => api.post<WecomMomentTask>("/wecom-crm/moments", body),

  listMoments: () => api.get<WecomMomentTask[]>("/wecom-crm/moments"),

  queryMomentResult: (taskId: string) =>
    api.post<{ status: string; result: Record<string, unknown> }>(
      `/wecom-crm/moments/${taskId}/result`,
    ),
};
