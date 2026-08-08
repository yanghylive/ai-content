import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { safeText } from '../../common/text.utils';
import type {
  AutoReplySuggestion,
  WecomAssistantSettingsDto,
  WecomRiskLevel,
} from './wecom-assistant.types';

/** 企业微信集成 + settings + 最近发送记录（findLatestIntegration 的 include 形状） */
type WecomIntegrationWithState = {
  id: string;
  userId: string;
  name: string;
  encryptedWebhookUrl: string;
  maskedWebhookUrl: string | null;
  status: string;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    brandName?: string | null;
    storeName?: string | null;
    replyStyle?: string | null;
    transferKeywords?: unknown;
    sendToWecom?: boolean | null;
  } | null;
  outboundMessages: Array<{
    id: string;
    messageType: string;
    status: string;
    content: string;
    errorMessage: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }>;
};

const DEFAULT_TRANSFER_KEYWORDS = [
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

@Injectable()
export class WecomAssistantService {
  private readonly logger = new Logger(WecomAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getState(userId: string) {
    const integration = await this.findLatestIntegration(userId);
    if (!integration) return this.defaultState();
    return this.toState(integration);
  }

  async testWebhook(webhookUrl: string) {
    this.assertValidWebhookUrl(webhookUrl);
    await this.sendWecomText(
      webhookUrl,
      '企业微信连接成功，AI 客服助手已准备就绪。',
    );
    return {
      success: true,
      message: '测试消息发送成功',
      maskedWebhookUrl: this.maskWebhookUrl(webhookUrl),
    };
  }

  async install(
    userId: string,
    input: {
      name?: string;
      webhookUrl?: string;
      settings?: WecomAssistantSettingsDto;
    },
  ) {
    const webhookUrl = String(input.webhookUrl || '').trim();
    if (!webhookUrl)
      throw new BadRequestException('请填写企业微信 Webhook 地址');
    this.assertValidWebhookUrl(webhookUrl);
    await this.sendWecomText(
      webhookUrl,
      '企业微信 AI 客服助手已安装成功。后续客户提醒和 AI 回复建议会发送到这里。',
    );

    const existing = await this.findLatestIntegration(userId);
    const normalizedSettings = this.normalizeSettings(input.settings || {});
    const data = {
      name: this.normalizeName(input.name),
      encryptedWebhookUrl: this.encryptSecret(webhookUrl),
      maskedWebhookUrl: this.maskWebhookUrl(webhookUrl),
      status: 'active',
      lastTestedAt: new Date(),
      settings: {
        upsert: {
          create: { userId: userId, ...normalizedSettings },
          update: normalizedSettings,
        },
      },
    };

    const integration = existing
      ? await this.prisma.wecomAssistantIntegration.update({
          where: { id: existing.id },
          data,
          include: this.includeStateRelations(),
        })
      : await this.prisma.wecomAssistantIntegration.create({
          data: {
            userId: userId,
            name: this.normalizeName(input.name),
            encryptedWebhookUrl: this.encryptSecret(webhookUrl),
            maskedWebhookUrl: this.maskWebhookUrl(webhookUrl),
            status: 'active',
            lastTestedAt: new Date(),
            settings: { create: { userId: userId, ...normalizedSettings } },
          },
          include: this.includeStateRelations(),
        });

    await this.createMessageRecord(userId, integration.id, {
      messageType: 'install',
      content:
        '企业微信 AI 客服助手已安装成功。后续客户提醒和 AI 回复建议会发送到这里。',
      status: 'sent',
      sentAt: new Date(),
    });
    return this.getState(userId);
  }

  async retest(userId: string) {
    const integration = await this.getIntegrationOrThrow(userId);
    const webhookUrl = this.decryptSecret(integration.encryptedWebhookUrl);
    await this.sendWecomText(
      webhookUrl,
      '企业微信连接成功，AI 客服助手已准备就绪。',
    );
    await this.prisma.wecomAssistantIntegration.update({
      where: { id: integration.id },
      data: { status: 'active', lastTestedAt: new Date() },
    });
    await this.createMessageRecord(userId, integration.id, {
      messageType: 'test',
      content: '企业微信连接成功，AI 客服助手已准备就绪。',
      status: 'sent',
      sentAt: new Date(),
    });
    return this.getState(userId);
  }

  async updateSettings(userId: string, settings: WecomAssistantSettingsDto) {
    const integration = await this.getIntegrationOrThrow(userId);
    const normalizedSettings = this.normalizeSettings(settings);
    await this.prisma.wecomAssistantSetting.upsert({
      where: { integrationId: integration.id },
      create: {
        integrationId: integration.id,
        userId: userId,
        ...normalizedSettings,
      },
      update: normalizedSettings,
    });
    return this.getState(userId);
  }

  async setEnabled(userId: string, enabled: boolean) {
    const integration = await this.getIntegrationOrThrow(userId);
    await this.prisma.wecomAssistantIntegration.update({
      where: { id: integration.id },
      data: { status: enabled ? 'active' : 'disabled' },
    });
    return this.getState(userId);
  }

  async remove(userId: string) {
    const integration = await this.findLatestIntegration(userId);
    if (integration)
      await this.prisma.wecomAssistantIntegration.delete({
        where: { id: integration.id },
      });
    return this.defaultState();
  }

  async suggest(userId: string, customerMessage: string) {
    const integration = await this.getIntegrationOrThrow(userId);
    if (integration.status !== 'active')
      throw new BadRequestException('企业微信 AI 客服助手已暂停');

    const settings = this.settingsForSuggestion(integration.settings || null);
    const suggestion = this.generateAutoReplySuggestion(
      customerMessage,
      settings,
    );
    const content = this.formatSuggestionForWecom(suggestion);
    const messageType = suggestion.shouldTransfer
      ? 'risk_alert'
      : 'auto_reply_suggestion';

    if (!settings.sendToWecom) {
      await this.createMessageRecord(userId, integration.id, {
        messageType,
        content,
        status: 'skipped',
      });
      return {
        state: await this.getState(userId),
        suggestion,
        content,
        sent: false,
      };
    }

    try {
      const webhookUrl = this.decryptSecret(integration.encryptedWebhookUrl);
      await this.sendWecomMarkdown(webhookUrl, content);
      await this.createMessageRecord(userId, integration.id, {
        messageType,
        content,
        status: 'sent',
        sentAt: new Date(),
      });
    } catch (error) {
      await this.createMessageRecord(userId, integration.id, {
        messageType,
        content,
        status: 'failed',
        errorMessage: this.getErrorMessage(error),
      });
      throw error;
    }

    return {
      state: await this.getState(userId),
      suggestion,
      content,
      sent: true,
    };
  }

  generateAutoReplySuggestion(
    customerMessage: string,
    settings: ReturnType<WecomAssistantService['settingsForSuggestion']>,
  ): AutoReplySuggestion {
    const message = String(customerMessage || '').trim();
    if (!message) throw new BadRequestException('客户消息不能为空');

    const keywordSet = new Set([
      ...DEFAULT_TRANSFER_KEYWORDS,
      ...settings.transferKeywords,
    ]);
    const hitKeyword = [...keywordSet].find(
      (keyword) => keyword && message.includes(keyword),
    );
    if (hitKeyword) {
      return {
        customerMessage: message,
        suggestedReply:
          '非常抱歉给您带来不便。我先帮您转人工客服进一步核实处理，避免耽误您的问题。',
        shouldTransfer: true,
        transferReason: '命中转人工关键词：' + hitKeyword,
        riskLevel: 'high',
        action: '请人工客服优先跟进，不建议 AI 自动回复。',
      };
    }
    if (message.includes('预约')) {
      return {
        customerMessage: message,
        suggestedReply:
          '可以的，请问您想预约哪一天/哪个时间段？我帮您先登记确认。',
        shouldTransfer: false,
        riskLevel: 'low',
        action: '客服确认具体时间段后再回复客户。',
      };
    }
    if (
      message.includes('多少钱') ||
      message.includes('价格') ||
      message.includes('优惠')
    ) {
      return {
        customerMessage: message,
        suggestedReply:
          '这款价格我这边需要再确认一下，避免给您说错。我先帮您核实一下。',
        shouldTransfer: false,
        riskLevel: 'medium',
        action: '需要查询真实价格或活动后再回复客户。',
      };
    }
    if (
      message.includes('地址') ||
      message.includes('营业时间') ||
      message.includes('几点开门')
    ) {
      return {
        customerMessage: message,
        suggestedReply: '我先帮您确认门店地址和营业时间，避免您白跑一趟。',
        shouldTransfer: false,
        riskLevel: 'low',
        action: '补充门店地址和营业时间后回复客户。',
      };
    }
    if (
      message.includes('有货') ||
      message.includes('库存') ||
      message.includes('到货')
    ) {
      return {
        customerMessage: message,
        suggestedReply:
          '库存会实时变化，我先帮您确认一下门店现货情况，再给您准确回复。',
        shouldTransfer: false,
        riskLevel: 'medium',
        action: '需要查询真实库存后再回复客户。',
      };
    }
    return {
      customerMessage: message,
      suggestedReply:
        '收到，我帮您看一下。请问您主要想咨询价格、预约，还是售后问题？',
      shouldTransfer: false,
      riskLevel: 'low',
      action: '信息不足，建议先追问客户具体需求。',
    };
  }

  private formatSuggestionForWecom(suggestion: AutoReplySuggestion) {
    return [
      '## AI 客服建议',
      '',
      '**客户消息：**',
      '> ' + suggestion.customerMessage,
      '',
      '**建议回复：**',
      '> ' + suggestion.suggestedReply,
      '',
      '**是否转人工：** ' + (suggestion.shouldTransfer ? '是' : '否'),
      suggestion.transferReason ? '> 原因：' + suggestion.transferReason : '',
      '',
      '**风险等级：** ' + this.riskLabel(suggestion.riskLevel),
      '',
      '**处理建议：**',
      '> ' + suggestion.action,
    ]
      .filter(Boolean)
      .join(String.fromCharCode(10));
  }

  private async sendWecomText(webhookUrl: string, content: string) {
    return this.postWecom(webhookUrl, { msgtype: 'text', text: { content } });
  }

  private async sendWecomMarkdown(webhookUrl: string, content: string) {
    return this.postWecom(webhookUrl, {
      msgtype: 'markdown',
      markdown: { content },
    });
  }

  private async postWecom(
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<{ errcode?: number; errmsg?: string }> {
    this.assertValidWebhookUrl(webhookUrl);
    try {
      const response = await axios.post<{
        errcode?: number;
        errmsg?: string;
      }>(webhookUrl, payload, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = response.data || {};
      if (data.errcode !== 0)
        throw new BadRequestException(data.errmsg || '企业微信返回错误');
      return data;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn('企业微信消息发送失败: ' + this.getErrorMessage(error));
      throw new BadRequestException(
        '企业微信消息发送失败: ' + this.getErrorMessage(error),
      );
    }
  }

  private assertValidWebhookUrl(webhookUrl: string) {
    try {
      const parsed = new URL(String(webhookUrl || '').trim());
      const valid =
        parsed.protocol === 'https:' &&
        parsed.hostname === 'qyapi.weixin.qq.com' &&
        parsed.pathname === '/cgi-bin/webhook/send' &&
        Boolean(parsed.searchParams.get('key'));
      if (!valid) throw new Error('invalid');
    } catch {
      throw new BadRequestException('企业微信 Webhook 地址格式不正确');
    }
  }

  private maskWebhookUrl(webhookUrl: string) {
    try {
      const parsed = new URL(webhookUrl.trim());
      const key = parsed.searchParams.get('key') || '';
      parsed.searchParams.set(
        'key',
        key.length > 4 ? '****' + key.slice(-4) : '****',
      );
      return parsed.toString();
    } catch {
      return 'invalid_webhook_url';
    }
  }

  private encryptSecret(plainText: string) {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }

  private decryptSecret(payload: string) {
    try {
      const [ivBase64, authTagBase64, encryptedBase64] = payload.split('.');
      if (!ivBase64 || !authTagBase64 || !encryptedBase64)
        throw new Error('Invalid encrypted payload');
      const key = this.getEncryptionKey();
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivBase64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedBase64, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error(
        '企业微信 Webhook 解密失败: ' + this.getErrorMessage(error),
      );
      throw new InternalServerErrorException(
        '企业微信连接密钥解密失败，请重新安装连接器',
      );
    }
  }

  private getEncryptionKey() {
    const configured =
      this.config.get<string>('WECOM_INTEGRATION_SECRET_KEY') ||
      this.config.get<string>('INTEGRATION_SECRET_KEY') ||
      this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') ||
      this.config.get<string>('DATABASE_URL') ||
      'kaypalai-local-integration-secret';
    try {
      const decoded = Buffer.from(configured, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {
      // fall through
    }
    return crypto.createHash('sha256').update(configured).digest();
  }

  private normalizeName(name?: string) {
    const normalized = String(name || '').trim();
    return normalized || '企业微信客服群';
  }

  private normalizeSettings(settings: WecomAssistantSettingsDto) {
    return {
      brandName: this.optionalString(settings.brandName) || 'JIUZHANG AI',
      storeName: this.optionalString(settings.storeName) || '默认门店',
      replyStyle: this.optionalString(settings.replyStyle) || '礼貌专业',
      transferKeywords: this.normalizeKeywords(settings.transferKeywords),
      sendToWecom: settings.sendToWecom !== false,
      autoSendToCustomer: false,
    };
  }

  private normalizeKeywords(value: string | string[] | null | undefined) {
    if (Array.isArray(value))
      return value.map((item) => String(item).trim()).filter(Boolean);
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_TRANSFER_KEYWORDS;
    return raw
      .split(/[、,，]/)
      .flatMap((item) => item.split(String.fromCharCode(10)))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private optionalString(value: unknown) {
    const normalized = safeText(value ?? '').trim();
    return normalized || null;
  }

  private settingsForSuggestion(
    setting: {
      brandName?: string | null;
      storeName?: string | null;
      replyStyle?: string | null;
      transferKeywords?: unknown;
      sendToWecom?: boolean | null;
    } | null,
  ) {
    if (!setting) return this.normalizeSettings({});
    return {
      brandName: setting.brandName || 'JIUZHANG AI',
      storeName: setting.storeName || '默认门店',
      replyStyle: setting.replyStyle || '礼貌专业',
      transferKeywords: this.normalizeKeywords(
        (setting.transferKeywords as string[]) ?? [],
      ),
      sendToWecom: setting.sendToWecom !== false,
      autoSendToCustomer: false,
    };
  }

  private riskLabel(riskLevel: WecomRiskLevel) {
    const labels: Record<WecomRiskLevel, string> = {
      low: '低',
      medium: '中',
      high: '高',
    };
    return labels[riskLevel] || riskLevel;
  }

  private async findLatestIntegration(userId: string) {
    return this.prisma.wecomAssistantIntegration.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: this.includeStateRelations(),
    });
  }

  private async getIntegrationOrThrow(userId: string) {
    const integration = await this.findLatestIntegration(userId);
    if (!integration) throw new NotFoundException('尚未安装企业微信连接器');
    return integration;
  }

  private includeStateRelations() {
    return {
      settings: true,
      outboundMessages: { orderBy: { createdAt: 'desc' as const }, take: 30 },
    };
  }

  private defaultState() {
    return {
      status: 'not_installed',
      integration: null,
      settings: {
        brandName: 'JIUZHANG AI',
        storeName: '默认门店',
        replyStyle: '礼貌专业',
        transferKeywords: DEFAULT_TRANSFER_KEYWORDS.join('、'),
        sendToWecom: true,
        autoSendToCustomer: false,
      },
      records: [],
    };
  }

  private toState(integration: WecomIntegrationWithState) {
    const normalizedSettings = this.settingsForSuggestion(
      integration.settings || null,
    );
    return {
      status: integration.status,
      integration: {
        id: integration.id,
        name: integration.name,
        maskedWebhookUrl: integration.maskedWebhookUrl,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
        lastTestedAt: integration.lastTestedAt,
      },
      settings: {
        ...normalizedSettings,
        transferKeywords: normalizedSettings.transferKeywords.join('、'),
      },
      records: (integration.outboundMessages || []).map((message) => ({
        id: message.id,
        type: message.messageType,
        status: message.status,
        title: this.messageTitle(message.messageType, message.status),
        content: message.content,
        createdAt: message.createdAt,
        errorMessage: message.errorMessage,
      })),
    };
  }

  private messageTitle(messageType: string, status: string) {
    if (status === 'failed') return '发送失败';
    const titles: Record<string, string> = {
      install: '企业微信 AI 客服助手已安装',
      test: '企业微信连接测试成功',
      auto_reply_suggestion: 'AI 回复建议已发送',
      risk_alert: '需要人工处理',
    };
    return titles[messageType] || '企业微信消息';
  }

  private createMessageRecord(
    userId: string,
    integrationId: string,
    input: {
      messageType: string;
      content: string;
      status: string;
      sentAt?: Date;
      errorMessage?: string;
    },
  ) {
    return this.prisma.wecomOutboundMessage.create({
      data: {
        userId,
        integrationId,
        channel: 'wecom',
        messageType: input.messageType,
        content: input.content,
        status: input.status,
        sentAt: input.sentAt,
        errorMessage: input.errorMessage,
      },
    });
  }

  private getErrorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as
        | { errmsg?: string; message?: string }
        | undefined;
      return data?.errmsg || data?.message || error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
