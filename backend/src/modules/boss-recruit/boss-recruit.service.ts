import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { BossPlaywrightClient } from './boss-recruit.playwright.client';
import type {
  BossHelloInput,
  BossLoginCheckResult,
  BossRecruitState,
  BossSyncPositionsInput,
} from './boss-recruit.types';

@Injectable()
export class BossRecruitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bossClient: BossPlaywrightClient,
  ) {}

  async getState(userId: string): Promise<BossRecruitState> {
    const [accounts, candidates, tasks, pendingTasks] = await Promise.all([
      this.prisma.bossAccount.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.bossCandidate.count({ where: { userId } }),
      this.prisma.bossTask.count({ where: { userId } }),
      this.prisma.bossTask.count({ where: { userId, status: { in: ['queued', 'running'] } } }),
    ]);
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        loginStatus: a.loginStatus as BossRecruitState['accounts'][number]['loginStatus'],
        lastCheckedAt: a.lastCheckedAt ? a.lastCheckedAt.toISOString() : null,
      })),
      candidates,
      tasks,
      pendingTasks,
    };
  }

  /** 上传登录态（storageState JSON） */
  async saveCookie(userId: string, storageState: Record<string, unknown>): Promise<{ ok: boolean; accountId: string }> {
    if (!storageState || typeof storageState !== 'object') {
      throw new BadRequestException('storageState 必须是对象（含 cookies / localStorage）');
    }
    const account = await this.prisma.bossAccount.create({
      data: { userId, loginStatus: 'unknown' },
    });
    const storagePath = join(
      process.cwd(),
      'data',
      'boss-storage-states',
      `${account.id}.json`,
    );
    writeFileSync(storagePath, JSON.stringify(storageState), 'utf8');
    await this.prisma.bossAccount.update({
      where: { id: account.id },
      data: { storageStatePath: storagePath, updatedAt: new Date() },
    });
    return { ok: true, accountId: account.id };
  }

  async checkLogin(userId: string, accountId: string): Promise<BossLoginCheckResult> {
    const account = await this.getOwnedAccount(userId, accountId);
    const result = await this.bossClient.checkLogin(account.storageStatePath || undefined);
    await this.prisma.bossAccount.update({
      where: { id: account.id },
      data: { loginStatus: result.status, lastCheckedAt: new Date(), updatedAt: new Date() },
    });
    return result;
  }

  async refreshPositions(userId: string, input: BossSyncPositionsInput) {
    const account = await this.getOwnedAccount(userId, input.accountId);
    if (!account.storageStatePath) {
      throw new BadRequestException('该账号未配置登录态，请先上传 Boss 登录态');
    }
    const task = await this.prisma.bossTask.create({
      data: { userId, accountId: account.id, taskType: 'refresh_position', status: 'running' },
    });
    try {
      const result = await this.bossClient.refreshPositions(
        account.storageStatePath,
        input.limit || 3,
      );
      await this.prisma.bossTask.update({
        where: { id: task.id },
        data: { status: 'completed', result: result as never, updatedAt: new Date() },
      });
      return result;
    } catch (error) {
      await this.prisma.bossTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async sendHello(userId: string, input: BossHelloInput) {
    const account = await this.getOwnedAccount(userId, input.accountId);
    if (!account.storageStatePath) {
      throw new BadRequestException('该账号未配置登录态，请先上传 Boss 登录态');
    }
    if (!input.candidateName?.trim()) {
      throw new BadRequestException('缺少候选人名称');
    }
    const task = await this.prisma.bossTask.create({
      data: { userId, accountId: account.id, taskType: 'auto_hello', status: 'running' },
    });
    try {
      const result = await this.bossClient.sendHello(
        account.storageStatePath,
        input.candidateName.trim(),
        input.message,
      );
      await this.prisma.bossTask.update({
        where: { id: task.id },
        data: { status: 'completed', result: result as never, updatedAt: new Date() },
      });
      if (result.ok) {
        await this.prisma.bossCandidate.upsert({
          where: { id: `${account.id}:${input.candidateName.trim()}` },
          create: {
            userId,
            accountId: account.id,
            name: input.candidateName.trim(),
            status: 'contacted',
          },
          update: { status: 'contacted', updatedAt: new Date() },
        }).catch(() => undefined);
      }
      return result;
    } catch (error) {
      await this.prisma.bossTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async listCandidates(userId: string) {
    const candidates = await this.prisma.bossCandidate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return candidates.map((c) => ({
      id: c.id,
      name: c.name,
      jobTitle: c.jobTitle,
      wechatId: c.wechatId,
      status: c.status,
      notes: c.notes,
      createdAt: c.createdAt,
    }));
  }

  async listTasks(userId: string) {
    const tasks = await this.prisma.bossTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return tasks.map((t) => ({
      id: t.id,
      taskType: t.taskType,
      status: t.status,
      result: t.result,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt,
    }));
  }

  private async getOwnedAccount(userId: string, accountId: string) {
    const account = await this.prisma.bossAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Boss 账号不存在');
    return account;
  }
}
