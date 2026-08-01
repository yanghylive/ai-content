import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DEMO_CONTACTS, DemoContact } from './fixtures/contacts';

/**
 * 演示舱·个人微信自动化任务引擎（纯内存态 + 纯 mock）
 *
 * 合规边界（合规书第五节）：
 *   - 所有数据来自 fixtures/contacts.ts（虚构联系人）
 *   - 任务推进用 setTimeout 随机节奏模拟"真人操作"，不产生任何对外网络请求
 *   - 不 import 任何生产凭证模块，不连真实微信/腾讯服务器
 *
 * 演示效果：创建任务后进度按 0.8~2.0s/条 随机推进，约 90% 成功 10% 失败，
 * 日志文案模拟真实微信操作反馈，前端轮询即可看到"任务在跑"。
 */

export type DemoTaskType = 'add_friend' | 'mass_send' | 'moments';
export type DemoTaskStatus = 'running' | 'done' | 'stopped';

export interface DemoTaskLog {
  time: string;
  text: string;
}

export interface DemoTask {
  id: string;
  type: DemoTaskType;
  name: string;
  status: DemoTaskStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  message?: string;
  contactIds: string[];
  logs: DemoTaskLog[];
  createdAt: string;
}

export interface CreateDemoTaskInput {
  type: DemoTaskType;
  name: string;
  message?: string;
  contactIds: string[];
}

const TYPE_LABEL: Record<DemoTaskType, string> = {
  add_friend: '自动加好友',
  mass_send: '群发消息',
  moments: '朋友圈自动发布',
};

@Injectable()
export class WechatPersonalDemoService {
  private readonly logger = new Logger('DemoWechatPersonal');
  private readonly tasks = new Map<string, DemoTask>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private seq = 0;

  /** 返回 mock 联系人列表（演示舱数据源） */
  listContacts(): DemoContact[] {
    return DEMO_CONTACTS;
  }

  /** 任务列表（按创建时间倒序） */
  listTasks(): DemoTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 单任务详情 */
  getTask(id: string): DemoTask {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundException(`演示任务 ${id} 不存在`);
    return task;
  }

  /** 创建任务并启动模拟推进 */
  createTask(input: CreateDemoTaskInput): DemoTask {
    const targets = input.contactIds.length
      ? input.contactIds
      : DEMO_CONTACTS.slice(0, 8).map((c) => c.wxid); // 默认前 8 个，演示节奏刚好

    const id = `demo-task-${Date.now()}-${++this.seq}`;
    const task: DemoTask = {
      id,
      type: input.type,
      name: input.name || `${TYPE_LABEL[input.type]}演示`,
      status: 'running',
      total: targets.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      message: input.message,
      contactIds: targets,
      logs: [
        {
          time: this.now(),
          text: `任务已创建（${TYPE_LABEL[input.type]} · ${targets.length} 个目标）· 模拟真人节奏推进，不产生任何真实请求`,
        },
      ],
      createdAt: this.now(),
    };
    this.tasks.set(id, task);
    this.scheduleTick(task);
    this.logger.warn(`[DEMO-MODE] 创建演示任务 ${id}（${task.name}）· ${targets.length} 目标`);
    return task;
  }

  /** 停止任务 */
  stopTask(id: string): DemoTask {
    const task = this.getTask(id);
    if (task.status === 'running') {
      const timer = this.timers.get(id);
      if (timer) clearTimeout(timer);
      this.timers.delete(id);
      task.status = 'stopped';
      task.logs.push({ time: this.now(), text: '任务已手动停止' });
    }
    return task;
  }

  // ─── 内部：模拟推进 ───

  private scheduleTick(task: DemoTask): void {
    // 随机 800~2000ms：演示"模拟人类节奏"（对应合规书限速条款的演示版）
    const delay = 800 + Math.floor(Math.random() * 1200);
    const timer = setTimeout(() => this.tick(task.id), delay);
    this.timers.set(task.id, timer);
  }

  private tick(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return;

    const wxid = task.contactIds[task.processed];
    const contact = DEMO_CONTACTS.find((c) => c.wxid === wxid);
    const nickname = contact?.nickname ?? wxid;
    const ok = Math.random() < 0.9;

    task.processed += 1;
    if (ok) task.succeeded += 1;
    else task.failed += 1;

    task.logs.push({ time: this.now(), text: this.buildLogLine(task, nickname, ok) });

    if (task.processed >= task.total) {
      task.status = 'done';
      task.logs.push({
        time: this.now(),
        text: `任务完成：成功 ${task.succeeded} · 失败 ${task.failed} · 共 ${task.total}（全部 mock，无真实触达）`,
      });
      this.timers.delete(id);
      this.logger.warn(`[DEMO-MODE] 演示任务 ${id} 完成`);
      return;
    }
    this.scheduleTick(task);
  }

  private buildLogLine(task: DemoTask, nickname: string, ok: boolean): string {
    switch (task.type) {
      case 'add_friend':
        return ok
          ? `向「${nickname}」发送好友申请 → 已通过`
          : `向「${nickname}」发送好友申请 → 未响应（跳过）`;
      case 'mass_send':
        return ok
          ? `向「${nickname}」群发消息「${this.truncate(task.message)}」→ 已送达`
          : `向「${nickname}」群发消息 → 发送失败（对方拒收）`;
      case 'moments':
        return ok
          ? `朋友圈素材「${this.truncate(task.message)}」→ 发布成功（仅演示）`
          : `朋友圈素材发布 → 失败（模拟风控提示）`;
    }
  }

  private truncate(text?: string): string {
    if (!text) return '默认话术';
    return text.length > 12 ? `${text.slice(0, 12)}…` : text;
  }

  private now(): string {
    return new Date().toISOString();
  }
}
