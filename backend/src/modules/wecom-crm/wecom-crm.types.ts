// wecom-crm：企业微信客户联系（Customer Contact）官方 API 通道
// 商用能力：外部联系人管理 / 客户群发 / 客户朋友圈发表

export type WecomCorpStatus = 'active' | 'disabled' | 'test_failed';

export interface WecomCorpConfigDto {
  corpId?: string;
  corpSecret?: string; // 仅在保存时传入，读取时返回 masked
  agentId?: string;
  callbackToken?: string;
  callbackEncodingAesKey?: string;
}

export type WecomMsgType = 'text' | 'image' | 'link' | 'miniprogram';

export interface WecomGroupMsgTaskCreateDto {
  configId: string;
  msgType: WecomMsgType;
  /** text: 文本内容；image: media_id；link: {title,url,picurl,desc}；miniprogram: {title,pic_media_id,appid,page} */
  content: Record<string, unknown>;
  /** 目标客户 external_userid 列表 */
  externalUserIds: string[];
  /** 执行发送的企业成员 userid 列表 */
  senderIds: string[];
}

export type WecomTaskStatus =
  | 'pending'
  | 'creating'
  | 'created'
  | 'sending'
  | 'sent'
  | 'partial_failed'
  | 'failed'
  | 'cancelled';

export interface WecomMomentTaskCreateDto {
  configId: string;
  /** 朋友圈文案 */
  text?: string;
  /** 附件：{type:'image'|'video'|'link', mediaId?, title?, url?, picUrl?, desc?} */
  attachments?: Array<Record<string, unknown>>;
  /** 可见范围：{users:[], departments:[], tagList:[], externalTags:[]}，空 = 全部可见 */
  visibleRange?: Record<string, unknown>;
}

export interface WecomContactDto {
  configId: string;
  /** 企业成员 userid，不传则拉全企业 */
  userId?: string;
}
