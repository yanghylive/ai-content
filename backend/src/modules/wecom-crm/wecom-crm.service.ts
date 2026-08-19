import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { safeText } from '../../common/text.utils';
import { verifyWecomSignature, decryptWecomMsg } from './wecom-crm.crypto';
import type {
  WecomCorpConfigDto,
  WecomGroupMsgTaskCreateDto,
  WecomMomentTaskCreateDto,
  WecomTaskStatus,
} from './wecom-crm.types';

const WECOM_API = 'https://qyapi.weixin.qq.com/cgi-bin';
const TOKEN_TTL_MS = 7200_000; // access_token 有效期 7200s
const TOKEN_REFRESH_MARGIN_MS = 300_000; // 提前 5 分钟刷新
const MAX_TARGETS_PER_GROUP_MSG = 500; // 单次群发任务上限（官方接口限制）

@Injectable()
export class WecomCrmService {
  private readonly logger = new Logger('WecomCrmService');
  /** configId → { token, expiresAt } 内存缓存 */
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ============ 企业配置 CRUD ============

  async getState(userId: string) {
    const configs = await this.prisma.wecomCorpConfig.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      configs: configs.map((c) => ({
        id: c.id,
        name: c.name,
        corpId: c.corpId,
        agentId: c.agentId,
        status: c.status,
        maskedSecret: this.maskSecret(c.encryptedCorpSecret),
        callbackVerified: Boolean(c.callbackUrlVerifiedAt),
        callbackUrl: c.callbackUrl,
        lastTokenAt: c.lastTokenAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      apiBase: `${WECOM_API}`,
    };
  }

  async saveConfig(
    userId: string,
    dto: WecomCorpConfigDto & { id?: string; name?: string },
  ) {
    if (!dto.corpId) throw new BadRequestException('缺少 corpid');
    const existing = dto.id
      ? await this.prisma.wecomCorpConfig.findFirst({
          where: { id: dto.id, userId },
        })
      : undefined;
    if (dto.id && !existing) throw new NotFoundException('企业微信配置不存在');

    const data: Record<string, unknown> = {
      name: safeText(dto.name || dto.corpId) || '企业微信',
      corpId: dto.corpId.trim(),
      agentId: dto.agentId?.trim() || null,
    };
    if (dto.corpSecret) {
      data.encryptedCorpSecret = this.encryptSecret(dto.corpSecret.trim());
      // 凭据变更后失效 token 缓存
      if (existing) this.tokenCache.delete(existing.id);
    }
    if (dto.callbackToken)
      data.callbackToken = this.encryptSecret(dto.callbackToken.trim());
    if (dto.callbackEncodingAesKey) {
      data.callbackEncodingAesKey = this.encryptSecret(
        dto.callbackEncodingAesKey.trim(),
      );
      data.callbackUrlVerifiedAt = null;
    }

    const saved = existing
      ? await this.prisma.wecomCorpConfig.update({
          where: { id: existing.id },
          data: data as never,
        })
      : await this.prisma.wecomCorpConfig.create({
          data: { userId, ...data } as never,
        });

    return this.sanitizeConfig(saved);
  }

  async deleteConfig(userId: string, configId: string) {
    const existing = await this.prisma.wecomCorpConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!existing) throw new NotFoundException('企业微信配置不存在');
    this.tokenCache.delete(configId);
    await this.prisma.wecomCorpConfig.delete({ where: { id: configId } });
    return { ok: true };
  }

  /** 用 gettoken 验证凭据有效性 */
  async testConfig(userId: string, configId: string) {
    const cfg = await this.getOwnedConfig(userId, configId);
    const secret = this.decryptSecret(cfg.encryptedCorpSecret);
    const token = await this.fetchAccessToken(cfg.corpId, secret);
    await this.prisma.wecomCorpConfig.update({
      where: { id: cfg.id },
      data: { status: 'active', lastTokenAt: new Date() },
    });
    return { ok: true, tokenPrefix: token.slice(0, 8) + '…' };
  }

  /** 回调 URL 验证 + 事件处理入口（无鉴权，供企业微信服务器调用） */
  async handleCallback(params: {
    configId: string;
    query: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<string> {
    const { configId, query, rawBody } = params;
    const cfg = await this.prisma.wecomCorpConfig.findUnique({
      where: { id: configId },
    });
    if (!cfg || !cfg.callbackToken || !cfg.callbackEncodingAesKey) {
      throw new BadRequestException('回调配置不完整');
    }
    const token = this.decryptSecret(cfg.callbackToken);
    const aesKey = this.decryptSecret(cfg.callbackEncodingAesKey);
    const msgSignature = query.msg_signature || '';
    const timestamp = query.timestamp || '';
    const nonce = query.nonce || '';

    // 1. 验签（GET 验证时 echostr 即为密文；POST 时先解外层 XML 取 Encrypt）
    if (query.echostr) {
      if (
        !verifyWecomSignature({
          token,
          timestamp,
          nonce,
          encryptMsg: query.echostr,
          msgSignature,
        })
      ) {
        throw new BadRequestException('回调签名校验失败');
      }
      const decrypted = decryptWecomMsg(query.echostr, aesKey, cfg.corpId);
      if (decrypted.receiveId !== cfg.corpId) {
        throw new BadRequestException('回调 receiveid 与 corpid 不匹配');
      }
      await this.prisma.wecomCorpConfig.update({
        where: { id: cfg.id },
        data: { callbackUrlVerifiedAt: new Date() },
      });
      return decrypted.message; // echostr 明文
    }

    // 2. 事件推送：解析外层 XML → Encrypt 密文
    const encryptMatch = /<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/.exec(
      rawBody,
    );
    if (!encryptMatch) throw new BadRequestException('缺少 Encrypt 字段');
    const encryptMsg = encryptMatch[1];
    if (
      !verifyWecomSignature({
        token,
        timestamp,
        nonce,
        encryptMsg,
        msgSignature,
      })
    ) {
      throw new BadRequestException('回调签名校验失败');
    }
    const { message } = decryptWecomMsg(encryptMsg, aesKey, cfg.corpId);
    // 异步处理事件，立即回包避免企业微信超时重试
    void this.processCallbackEvent(cfg.id, message).catch((e) =>
      this.logger.error('回调事件处理失败: ' + this.getErrorMessage(e)),
    );
    return 'success';
  }

  private async processCallbackEvent(configId: string, xmlMessage: string) {
    const event =
      /<Event><!\[CDATA\[([\s\S]*?)\]\]><\/Event>/.exec(xmlMessage)?.[1] ||
      /<Event>([\s\S]*?)<\/Event>/.exec(xmlMessage)?.[1] ||
      'unknown';
    const msgId =
      /<MsgID><!\[CDATA\[([\s\S]*?)\]\]><\/MsgID>/.exec(xmlMessage)?.[1] ||
      /<MsgID>([\s\S]*?)<\/MsgID>/.exec(xmlMessage)?.[1];
    const jobId =
      /<JobID><!\[CDATA\[([\s\S]*?)\]\]><\/JobID>/.exec(xmlMessage)?.[1] ||
      /<JobID>([\s\S]*?)<\/JobID>/.exec(xmlMessage)?.[1];
    this.logger.log(
      `企业微信回调事件: ${event}${msgId ? ' msgId=' + msgId : ''}${jobId ? ' jobId=' + jobId : ''}`,
    );
    if (event === 'change_external_contact') {
      // 客户添加/删除事件 → 触发联系人增量同步
      void this.syncContactsForConfig(configId).catch(() => undefined);
    }
    if (event === 'group_msg_send_finish' && msgId) {
      await this.prisma.wecomGroupMsgTask.updateMany({
        where: { configId, wecomMsgId: msgId },
        data: { status: 'sent', updatedAt: new Date() },
      });
    }
    if (event === 'moment_send_finish' && jobId) {
      await this.prisma.wecomMomentTask.updateMany({
        where: { configId, wecomJobId: jobId },
        data: { status: 'sent', updatedAt: new Date() },
      });
    }
  }

  // ============ 外部联系人 ============

  async listContacts(userId: string, configId: string, memberUserId?: string) {
    const cfg = await this.getOwnedConfig(userId, configId);
    const token = await this.getAccessToken(cfg);
    // 拉取全部企业成员（需通讯录读取权限），逐个拉客户
    const members = await this.wecomGet(
      '/externalcontact/get_follow_user_list',
      token,
      {},
    );
    const memberIds = Array.isArray(members?.follow_user)
      ? (members.follow_user as string[])
      : memberUserId
        ? [memberUserId]
        : [];
    const targets = memberUserId ? [memberUserId] : memberIds.slice(0, 20);
    const contacts: Array<Record<string, unknown>> = [];
    for (const uid of targets) {
      const res = await this.wecomGet('/externalcontact/list', token, {
        userid: uid,
      });
      const ids = Array.isArray(res?.external_userid)
        ? res.external_userid
        : [];
      for (const extId of ids.slice(0, 50)) {
        contacts.push({
          externalUserId: extId,
          memberUserId: uid,
          name: extId,
        });
      }
    }
    // 落库缓存
    if (contacts.length > 0) {
      await this.prisma.$transaction(
        contacts.map((c) =>
          this.prisma.wecomContact.upsert({
            where: {
              configId_externalUserId: {
                configId,
                externalUserId: c.externalUserId as string,
              },
            },
            create: {
              configId,
              externalUserId: c.externalUserId as string,
              userId: c.memberUserId as string,
              name: c.name as string,
            },
            update: { userId: c.memberUserId as string, updatedAt: new Date() },
          }),
        ),
      );
    }
    return { count: contacts.length, contacts };
  }

  private async syncContactsForConfig(configId: string) {
    const cfg = await this.prisma.wecomCorpConfig.findUnique({
      where: { id: configId },
    });
    if (!cfg) return;
    try {
      const token = await this.getAccessToken(cfg);
      const members = await this.wecomGet(
        '/externalcontact/get_follow_user_list',
        token,
        {},
      );
      const memberIds = Array.isArray(members?.follow_user)
        ? (members.follow_user as string[])
        : [];
      for (const uid of memberIds.slice(0, 10)) {
        const res = await this.wecomGet('/externalcontact/list', token, {
          userid: uid,
        });
        const ids = Array.isArray(res?.external_userid)
          ? (res.external_userid as string[])
          : [];
        for (const extId of ids) {
          await this.prisma.wecomContact.upsert({
            where: {
              configId_externalUserId: { configId, externalUserId: extId },
            },
            create: {
              configId,
              externalUserId: extId,
              userId: uid,
              name: extId,
            },
            update: { updatedAt: new Date() },
          });
        }
      }
    } catch (e) {
      this.logger.warn('联系人增量同步失败: ' + this.getErrorMessage(e));
    }
  }

  // ============ 客户群发 ============

  async createGroupMsgTask(userId: string, dto: WecomGroupMsgTaskCreateDto) {
    const cfg = await this.getOwnedConfig(userId, dto.configId);
    if (!dto.externalUserIds?.length || !dto.senderIds?.length) {
      throw new BadRequestException('群发需要指定目标客户与发送成员');
    }
    if (dto.externalUserIds.length > MAX_TARGETS_PER_GROUP_MSG) {
      throw new BadRequestException(
        `单次群发最多 ${MAX_TARGETS_PER_GROUP_MSG} 个客户，当前 ${dto.externalUserIds.length}`,
      );
    }
    const task = await this.prisma.wecomGroupMsgTask.create({
      data: {
        userId,
        configId: cfg.id,
        msgType: dto.msgType,
        content: dto.content as never,
        externalUserIds: dto.externalUserIds as never,
        senderIds: dto.senderIds as never,
        status: 'creating',
      },
    });
    try {
      const token = await this.getAccessToken(cfg);
      const body = this.buildGroupMsgBody(dto);
      const res = await this.wecomPost(
        '/externalcontact/add_msg_template',
        token,
        body,
      );
      const rawMsgId = res?.msgid;
      const msgId =
        typeof rawMsgId === 'string' || typeof rawMsgId === 'number'
          ? String(rawMsgId)
          : '';
      await this.prisma.wecomGroupMsgTask.update({
        where: { id: task.id },
        data: { wecomMsgId: msgId, status: 'created' },
      });
      return this.sanitizeTask(task.id, {
        wecomMsgId: msgId,
        status: 'created',
      });
    } catch (error) {
      await this.prisma.wecomGroupMsgTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorMessage: this.getErrorMessage(error) },
      });
      throw new BadRequestException(
        '群发任务创建失败: ' + this.getErrorMessage(error),
      );
    }
  }

  async queryGroupMsgResult(userId: string, taskId: string) {
    const task = await this.prisma.wecomGroupMsgTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new NotFoundException('群发任务不存在');
    if (!task.wecomMsgId)
      throw new BadRequestException('任务尚未创建（无 msgid）');
    const cfg = await this.getOwnedConfig(userId, task.configId);
    const token = await this.getAccessToken(cfg);
    const res = await this.wecomPost(
      '/externalcontact/get_group_msg_result',
      token,
      {
        msgid: task.wecomMsgId,
      },
    );
    const status: WecomTaskStatus =
      res?.status === 1
        ? 'sending'
        : res?.status === 2
          ? 'sent'
          : (task.status as WecomTaskStatus);
    const sendList = Array.isArray(res?.send_list) ? res.send_list : [];
    const failCount = sendList.filter(
      (s: Record<string, unknown>) => (s as { status?: number }).status !== 1,
    ).length;
    await this.prisma.wecomGroupMsgTask.update({
      where: { id: task.id },
      data: {
        status,
        result: { sendList } as never,
        errorMessage: failCount > 0 ? `失败 ${failCount} 条` : null,
        updatedAt: new Date(),
      },
    });
    return { status, sendCount: sendList.length, failCount };
  }

  async listGroupMsgTasks(userId: string) {
    const tasks = await this.prisma.wecomGroupMsgTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return tasks.map((t) => this.sanitizeTask(t.id, t as never));
  }

  // ============ 客户朋友圈 ============

  async createMomentTask(userId: string, dto: WecomMomentTaskCreateDto) {
    const cfg = await this.getOwnedConfig(userId, dto.configId);
    if (!dto.text && (!dto.attachments || dto.attachments.length === 0)) {
      throw new BadRequestException('朋友圈需要文案或附件');
    }
    const task = await this.prisma.wecomMomentTask.create({
      data: {
        userId,
        configId: cfg.id,
        text: dto.text || null,
        attachments: (dto.attachments || []) as never,
        visibleRange: (dto.visibleRange || null) as never,
        status: 'creating',
      },
    });
    try {
      const token = await this.getAccessToken(cfg);
      const body: Record<string, unknown> = {};
      if (dto.text) body.text = { content: dto.text };
      if (dto.attachments?.length) {
        body.attachments = dto.attachments.map((a) =>
          this.buildMomentAttachment(a),
        );
      }
      if (dto.visibleRange)
        body.visible_range = this.buildVisibleRange(dto.visibleRange);
      const res = await this.wecomPost(
        '/externalcontact/add_moment_task',
        token,
        body,
      );
      const rawJobId = res?.jobid;
      const jobId =
        typeof rawJobId === 'string' || typeof rawJobId === 'number'
          ? String(rawJobId)
          : '';
      await this.prisma.wecomMomentTask.update({
        where: { id: task.id },
        data: { wecomJobId: jobId, status: 'created' },
      });
      return this.sanitizeTask(task.id, {
        wecomJobId: jobId,
        status: 'created',
      });
    } catch (error) {
      await this.prisma.wecomMomentTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorMessage: this.getErrorMessage(error) },
      });
      throw new BadRequestException(
        '朋友圈任务创建失败: ' + this.getErrorMessage(error),
      );
    }
  }

  async queryMomentResult(userId: string, taskId: string) {
    const task = await this.prisma.wecomMomentTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new NotFoundException('朋友圈任务不存在');
    if (!task.wecomJobId)
      throw new BadRequestException('任务尚未创建（无 jobid）');
    const cfg = await this.getOwnedConfig(userId, task.configId);
    const token = await this.getAccessToken(cfg);
    const res = await this.wecomPost(
      '/externalcontact/get_moment_task_result',
      token,
      {
        jobid: task.wecomJobId,
      },
    );
    const status: WecomTaskStatus =
      res?.status === 1
        ? 'sending'
        : res?.status === 2
          ? 'sent'
          : (task.status as WecomTaskStatus);
    const result =
      res?.result && typeof res.result === 'object' ? res.result : {};
    await this.prisma.wecomMomentTask.update({
      where: { id: task.id },
      data: { status, result: result as never, updatedAt: new Date() },
    });
    return { status, result };
  }

  async listMomentTasks(userId: string) {
    const tasks = await this.prisma.wecomMomentTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return tasks.map((t) => this.sanitizeTask(t.id, t as never));
  }

  // ============ 内部工具 ============

  /** 把 unknown 安全转成字符串：非 string/number 一律空串，避免把对象拼成 [object Object] */
  private asString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
  }

  private buildGroupMsgBody(
    dto: WecomGroupMsgTaskCreateDto,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      chat_type: 'single',
      external_userid: dto.externalUserIds,
      sender: dto.senderIds,
      msgtype: dto.msgType,
    };
    switch (dto.msgType) {
      case 'text':
        body.text = { content: this.asString(dto.content?.content) };
        break;
      case 'image':
        body.image = { media_id: this.asString(dto.content?.mediaId) };
        break;
      case 'link':
        body.link = {
          title: this.asString(dto.content?.title),
          url: this.asString(dto.content?.url),
          picurl: this.asString(dto.content?.picUrl),
          desc: this.asString(dto.content?.desc),
        };
        break;
      case 'miniprogram':
        body.miniprogram = {
          title: this.asString(dto.content?.title),
          pic_media_id: this.asString(dto.content?.picMediaId),
          appid: this.asString(dto.content?.appid),
          page: this.asString(dto.content?.page),
        };
        break;
      default:
        throw new BadRequestException(
          '不支持的群发消息类型: ' + String(dto.msgType),
        );
    }
    return body;
  }

  private buildMomentAttachment(
    a: Record<string, unknown>,
  ): Record<string, unknown> {
    const type = this.asString(a.type) || 'image';
    if (type === 'image') {
      return {
        msgtype: 'image',
        image: { media_id: this.asString(a.mediaId) },
      };
    }
    if (type === 'video') {
      return {
        msgtype: 'video',
        video: { media_id: this.asString(a.mediaId) },
      };
    }
    if (type === 'link') {
      return {
        msgtype: 'link',
        link: {
          title: this.asString(a.title),
          url: this.asString(a.url),
          picurl: this.asString(a.picUrl),
        },
      };
    }
    throw new BadRequestException('朋友圈附件类型不支持: ' + type);
  }

  private buildVisibleRange(
    range: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      sender_list: {
        users: Array.isArray(range.users) ? range.users : [],
        departments: Array.isArray(range.departments) ? range.departments : [],
        tag_list: Array.isArray(range.tagList) ? range.tagList : [],
      },
      external_contact_list: {
        tags: Array.isArray(range.externalTags) ? range.externalTags : [],
      },
    };
  }

  private async getOwnedConfig(userId: string, configId: string) {
    const cfg = await this.prisma.wecomCorpConfig.findFirst({
      where: { id: configId, userId },
    });
    if (!cfg) throw new NotFoundException('企业微信配置不存在');
    return cfg;
  }

  /** 获取 access_token（内存缓存 + 过期刷新） */
  private async getAccessToken(cfg: {
    id: string;
    corpId: string;
    encryptedCorpSecret: string;
  }): Promise<string> {
    const cached = this.tokenCache.get(cfg.id);
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return cached.token;
    }
    const secret = this.decryptSecret(cfg.encryptedCorpSecret);
    const token = await this.fetchAccessToken(cfg.corpId, secret);
    this.tokenCache.set(cfg.id, {
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return token;
  }

  private async fetchAccessToken(
    corpId: string,
    corpSecret: string,
  ): Promise<string> {
    try {
      const { data } = await axios.get<{
        errcode?: number;
        errmsg?: string;
        access_token?: string;
      }>(`${WECOM_API}/gettoken`, {
        params: { corpid: corpId, corpsecret: corpSecret },
        timeout: 10000,
      });
      if (data.errcode !== 0 || !data.access_token) {
        throw new Error(
          `获取 access_token 失败: ${data.errcode} ${data.errmsg || ''}`,
        );
      }
      return data.access_token;
    } catch (error) {
      throw new BadRequestException(
        '企业微信 access_token 获取失败: ' + this.getErrorMessage(error),
      );
    }
  }

  private async wecomGet(
    path: string,
    token: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    const { data } = await axios.get<
      { errcode?: number; errmsg?: string } & Record<string, unknown>
    >(`${WECOM_API}${path}`, {
      params: { access_token: token, ...params },
      timeout: 10000,
    });
    if (data.errcode !== 0) {
      throw new Error(`企业微信 ${path} 失败: ${data.errcode} ${data.errmsg}`);
    }
    return data;
  }

  private async wecomPost(
    path: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ errcode?: number; errmsg?: string } & Record<string, unknown>> {
    const { data } = await axios.post<
      { errcode?: number; errmsg?: string } & Record<string, unknown>
    >(`${WECOM_API}${path}`, body, {
      params: { access_token: token },
      timeout: 15000,
    });
    if (data.errcode !== 0) {
      throw new Error(`企业微信 ${path} 失败: ${data.errcode} ${data.errmsg}`);
    }
    return data;
  }

  private sanitizeConfig(cfg: {
    id: string;
    name: string;
    corpId: string;
    agentId: string | null;
    status: string;
    encryptedCorpSecret: string;
    callbackVerified?: boolean;
    callbackUrlVerifiedAt?: Date | null;
    callbackUrl?: string | null;
    lastTokenAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: cfg.id,
      name: cfg.name,
      corpId: cfg.corpId,
      agentId: cfg.agentId,
      status: cfg.status,
      maskedSecret: this.maskSecret(cfg.encryptedCorpSecret),
      callbackVerified: Boolean(cfg.callbackUrlVerifiedAt),
      callbackUrl: cfg.callbackUrl,
      lastTokenAt: cfg.lastTokenAt,
      createdAt: cfg.createdAt,
      updatedAt: cfg.updatedAt,
    };
  }

  private sanitizeTask(id: string, patch: Record<string, unknown>) {
    return { id, ...patch };
  }

  private maskSecret(encrypted: string | null): string {
    if (!encrypted) return '';
    const raw = this.decryptSecret(encrypted);
    if (raw.length <= 8) return '********';
    return raw.slice(0, 3) + '****' + raw.slice(-2);
  }

  // ============ 加密（与 wecom-assistant 一致的 aes-256-gcm + master key） ============

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
      this.logger.error('企业微信凭据解密失败: ' + this.getErrorMessage(error));
      throw new BadRequestException('企业微信凭据解密失败');
    }
  }

  private getEncryptionKey(): Buffer {
    const configured =
      this.config.get<string>('WECOM_INTEGRATION_SECRET_KEY') ||
      this.config.get<string>('INTEGRATION_SECRET_KEY') ||
      this.config.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') ||
      'kaypalai-local-integration-secret';
    try {
      const decoded = Buffer.from(configured, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {
      // fall through
    }
    return Buffer.from(crypto.createHash('sha256').update(configured).digest());
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
