import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireDemoMode } from '../../lib/demo/demo-mode';

const DEMO_PREFIX = '[DEMO-MODE][NON-COMPLIANT]';

interface WechatPersonalFixture {
  demoTitle: string;
  notice: string;
  contacts: Array<{
    id: string;
    name: string;
    tag: string;
    lastMessage: string;
    unread: number;
    avatarColor: string;
  }>;
  conversations: Record<
    string,
    Array<{ from: string; text: string; time: string }>
  >;
  autoReplies: Array<{ id: string; label: string; template: string }>;
  broadcastFlow: Array<{ step: number; name: string; detail: string }>;
}

function loadFixture(): WechatPersonalFixture {
  const path = join(__dirname, '..', 'fixtures', 'wechat-personal.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as WechatPersonalFixture;
}

/**
 * 个人微信自动化（演示舱）——能力证明，非产品功能。
 * 全部数据为 mock fixtures，绝不连接真实微信。
 */
@Controller('demo/wechat-personal')
export class WechatPersonalDemoController {
  private readonly logger = new Logger(WechatPersonalDemoController.name);
  private readonly fixture: WechatPersonalFixture;

  constructor() {
    this.fixture = loadFixture();
  }

  @Get('status')
  getStatus() {
    requireDemoMode();
    return {
      enabled: true,
      title: this.fixture.demoTitle,
      notice: this.fixture.notice,
      mock: true,
    };
  }

  @Get('contacts')
  getContacts() {
    requireDemoMode();
    this.logger.warn(`${DEMO_PREFIX} 联系人列表被读取（mock 数据）`);
    return { contacts: this.fixture.contacts };
  }

  @Get('conversations/:contactId')
  getConversation(contactId: string) {
    requireDemoMode();
    return {
      messages: this.fixture.conversations[contactId] || [],
    };
  }

  @Post('auto-reply')
  autoReply(@Body() input: { contactId?: string; templateId?: string }) {
    requireDemoMode();
    const reply = this.fixture.autoReplies.find(
      (item) => item.id === input.templateId,
    );
    this.logger.warn(
      `${DEMO_PREFIX} 自动回复被调用（mock 执行，未发送任何真实消息）`,
    );
    return {
      ok: true,
      contactId: input.contactId || null,
      replyText: reply?.template || '（无匹配话术模板）',
      sent: false, // 演示：仅编排，不真发
      mock: true,
    };
  }

  @Get('broadcast-flow')
  getBroadcastFlow() {
    requireDemoMode();
    return { flow: this.fixture.broadcastFlow };
  }
}
