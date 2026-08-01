import { ForbiddenException } from '@nestjs/common';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';

function makeConfig(enabled = false) {
  return {
    get: jest.fn(() => (enabled ? 'true' : undefined)),
  };
}

function makeService(realExecutionEnabled = false, agentS?: unknown) {
  const scope = {
    key: 'tenant-1:user-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
  };
  const redfoxService = {
    resolveScope: jest.fn(async () => scope),
    getEffectiveConnection: jest.fn(async () => ({
      baseUrl: 'https://redfox.hk',
      apiKey: 'ak_test',
      apiKeySource: 'env',
      timeoutMs: 30000,
      enabled: true,
      dailyUserLimit: 0,
      dailyTenantLimit: 0,
      highCostConfirmThreshold: 0,
      status: 'connected',
      updatedAt: new Date(0).toISOString(),
    })),
  };
  const redfoxClient = {
    request: jest.fn(async (_scope: unknown, _connection: unknown, options) => {
      options.onCallLogRecorded?.({ id: 'log-1' });
      return { code: 2000, data: { ok: true } };
    }),
  };
  const skillRows = [
    {
      id: 'douyin-query-work',
      skillNo: '0OT1E306',
      code: 'douyin-query-work',
      name: '抖音作品详情查询',
      platform: 'douyin',
      category: 'data',
      tags: ['douyin'],
      summary: 'query work',
      status: 'available',
      enabled: true,
      scenario: 'work_detail',
      raw: {},
      syncedAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'douyin-search-user',
      skillNo: 'dy-search-user',
      code: 'douyin-search-user',
      name: '抖音账号搜索',
      platform: 'douyin',
      category: 'data',
      tags: ['douyin', 'account'],
      summary: 'search user',
      status: 'available',
      enabled: true,
      scenario: 'account_search',
      raw: {},
      syncedAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  ];
  const skills = {
    list: jest.fn(async (_scope: unknown, options: { keyword?: string }) => {
      const keyword = options.keyword || '';
      const items = skillRows.filter(
        (item) =>
          item.code === keyword ||
          item.skillNo === keyword ||
          item.name === keyword,
      );
      return {
        items,
        total: items.length,
        page: 1,
        limit: 20,
        totalPages: items.length ? 1 : 0,
      };
    }),
  };
  const service = new RedfoxSkillRunnerService(
    makeConfig(realExecutionEnabled) as any,
    redfoxService as any,
    redfoxClient as any,
    skills as any,
    agentS as any,
  );
  return { service, redfoxService, redfoxClient, skills };
}

const actor = {
  id: 'user-1',
  username: 'tester',
  email: 'tester@example.com',
  name: 'Tester',
  status: 'active',
  lastLoginAt: null,
  role: 'admin',
  commercialExecutionAllowed: true,
  planMode: 'commercial',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe('RedfoxSkillRunnerService', () => {
  it('creates a dry-run plan by default without external execution', async () => {
    const { service, redfoxClient, redfoxService } = makeService();

    const result = await service.runSkill(actor as any, {
      skillCode: 'douyin-query-work',
      input: {
        workUrl: 'https://example.com/video/1',
        apiKey: 'should-not-leak',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        dryRun: true,
        status: 'dry_run_ready',
        callLogId: null,
        idempotencyKey: null,
        endpoint: expect.objectContaining({
          path: '/story/api/dyData/queryWork',
        }),
      }),
    );
    expect(result.requestPreview.input).toEqual(
      expect.objectContaining({ apiKey: '[redacted]' }),
    );
    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(redfoxService.getEffectiveConnection).not.toHaveBeenCalled();
  });

  it('runs mapped execution without an extra runner feature flag or phrase', async () => {
    const { service, redfoxClient } = makeService(false);

    const result = await service.runSkill(actor as any, {
      skillCode: 'douyin-query-work',
      dryRun: false,
      path: '/story/api/dyData/queryWork',
    });

    expect(redfoxClient.request).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it('treats RedFox business error codes as execution failures', async () => {
    const { service, redfoxClient } = makeService(false);
    redfoxClient.request.mockResolvedValueOnce({
      code: 1002,
      data: null,
      msg: '搜索文本不能为空',
    });

    await expect(
      service.runSkill(actor as any, {
        skillCode: 'deepsearch-doubao-submit',
        dryRun: false,
        input: { keyword: '咖啡' },
      }),
    ).rejects.toThrow('豆包 WebSearch 提交 执行失败：搜索文本不能为空');
  });

  it('runs a verified API mapping even when the local skill catalog has not been synced', async () => {
    const { service, redfoxClient, skills } = makeService(false);

    const result = await service.runSkill(actor as any, {
      skillCode: 'douyin-search-article',
      dryRun: false,
      input: { keyword: '咖啡' },
    });

    expect(skills.list).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ keyword: 'douyin-search-article' }),
    );
    expect(redfoxClient.request).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        method: 'POST',
        path: '/story/api/dyData/searchArticle',
        body: { keyword: '咖啡' },
        skillCode: 'douyin-search-article',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        dryRun: false,
        status: 'success',
        skill: expect.objectContaining({
          code: 'douyin-search-article',
          enabled: false,
          resolved: true,
        }),
      }),
    );
  });

  it('blocks real execution when the skill is not in the whitelist mapping', async () => {
    const { service, redfoxClient } = makeService(true);

    await expect(
      service.runSkill(actor as any, {
        skillCode: 'unknown-live-skill',
        dryRun: false,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(redfoxClient.request).not.toHaveBeenCalled();
  });

  it('runs a confirmed mapped execution and returns the recorded call log id', async () => {
    const { service, redfoxClient } = makeService(true);

    const result = await service.runSkill(actor as any, {
      skillCode: 'douyin-query-work',
      dryRun: false,
      method: 'POST',
      body: { workUrl: 'https://example.com/video/1' },
      bodyEncoding: 'json',
      estimatedCostPoints: 2,
      idempotencyKey: 'idem-1',
    });

    expect(redfoxClient.request).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.any(Object),
      expect.objectContaining({
        method: 'POST',
        path: '/story/api/dyData/queryWork',
        body: { workUrl: 'https://example.com/video/1' },
        bodyEncoding: 'json',
        skillCode: 'douyin-query-work',
        estimatedCostPoints: 2,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        dryRun: false,
        status: 'success',
        callLogId: 'log-1',
        idempotencyKey: 'idem-1',
      }),
    );
  });

  it('resolves the douyin-account-search alias through the canonical mapping', async () => {
    const { service, skills } = makeService();

    const result = await service.runSkill(actor as any, {
      skillCode: 'douyin-account-search',
      input: { keyword: '咖啡' },
    });

    expect(skills.list).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ keyword: 'douyin-search-user' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        dryRun: true,
        endpoint: expect.objectContaining({
          path: '/story/api/dyData/searchUser',
        }),
        skill: expect.objectContaining({
          code: 'douyin-search-user',
          name: '抖音账号搜索',
          resolved: true,
        }),
      }),
    );
  });

  it('runs a confirmed SkillHub mapping through Agent-S when no RedFox API path exists', async () => {
    const agentS = {
      createSession: jest.fn(async () => ({
        session: { session_id: 'agent-session-1' },
      })),
      runTask: jest.fn(async () => ({
        accepted: true,
        session_id: 'agent-session-1',
        run_id: 'agent-run-1',
        status: 'completed',
      })),
      getEvents: jest.fn(async () => ({
        session_id: 'agent-session-1',
        after_seq: 0,
        next_seq: 2,
        events: [
          {
            event_type: 'SkillCompleted',
            message: '全网热搜查询试跑完成：返回 1 条结果。',
          },
        ],
      })),
      getArtifacts: jest.fn(async () => ({
        session_id: 'agent-session-1',
        artifacts: [
          {
            artifact_id: 'artifact-1',
            filename: 'trending-hub-result.json',
            kind: 'json',
          },
        ],
      })),
      getArtifact: jest.fn(async () => ({
        artifact: { artifact_id: 'artifact-1' },
        content: JSON.stringify({
          ok: true,
          output: { items: [{ title: 'AI 创业热搜', score: 91 }] },
        }),
      })),
    };
    const { service, redfoxClient } = makeService(true, agentS);

    const result = await service.runSkill(actor as any, {
      skillCode: '全网热搜/聚合热点',
      dryRun: false,
      input: { keyword: 'AI 创业', platform: '全网' },
      solutionRunId: 'run-1',
      solutionTaskId: 'task-1',
    });

    expect(redfoxClient.request).not.toHaveBeenCalled();
    expect(agentS.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'redfox.skillhub.run',
        metadata: expect.objectContaining({
          provider: 'redfox-skillhub',
          skillCode: 'trending-hub',
          skillNo: 'KJq7uXHY',
          input: expect.objectContaining({ keyword: 'AI 创业' }),
          outputObjects: expect.arrayContaining(['IntelligenceItem', 'Topic']),
        }),
      }),
    );
    expect(agentS.runTask).toHaveBeenCalledWith(
      'agent-session-1',
      expect.objectContaining({
        task_type: 'redfox.skillhub.run',
        metadata: expect.objectContaining({ skillCode: 'trending-hub' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        dryRun: false,
        status: 'success',
        callLogId: null,
        endpoint: expect.objectContaining({ path: null }),
        skill: expect.objectContaining({
          code: 'trending-hub',
          name: '全网热搜查询',
          resolved: true,
        }),
        payloadSummary: expect.objectContaining({
          kind: 'skillhub_agent_run',
          agentSessionId: 'agent-session-1',
          agentRunId: 'agent-run-1',
          mappedStatus: 'success',
          skillHubRef: expect.objectContaining({
            skillCode: 'trending-hub',
          }),
        }),
      }),
    );
    expect(result.payloadSample).toEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          items: [{ title: 'AI 创业热搜', score: 91 }],
        }),
      }),
    );
  });

  it('returns blocked when Agent-S preflight blocks a SkillHub capability', async () => {
    const agentS = {
      createSession: jest.fn(async () => ({
        session: { session_id: 'agent-session-2' },
      })),
      runTask: jest.fn(async () => ({
        accepted: true,
        session_id: 'agent-session-2',
        run_id: 'agent-run-2',
        status: 'blocked',
      })),
      getEvents: jest.fn(async () => ({
        events: [
          {
            event_type: 'SkillBlocked',
            message: '本机能力暂未就绪：缺少 REDFOX_API_KEY',
          },
        ],
      })),
      getArtifacts: jest.fn(async () => ({
        artifacts: [
          {
            artifact_id: 'artifact-2',
            filename: 'trending-hub-preflight.json',
            kind: 'json',
          },
        ],
      })),
      getArtifact: jest.fn(async () => ({
        content: JSON.stringify({
          ok: false,
          status: 'blocked',
          blockers: ['缺少 REDFOX_API_KEY'],
        }),
      })),
    };
    const { service } = makeService(true, agentS);

    const result = await service.runSkill(actor as any, {
      skillCode: 'trending-hub',
      dryRun: false,
      input: { keyword: '咖啡' },
    });

    expect(result.status).toBe('blocked');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        '本机数据能力暂未就绪。',
        '本机能力暂未就绪：缺少 REDFOX_API_KEY',
      ]),
    );
    expect(result.payloadSummary).toEqual(
      expect.objectContaining({
        kind: 'skillhub_agent_run',
        mappedStatus: 'blocked',
      }),
    );
  });
});
