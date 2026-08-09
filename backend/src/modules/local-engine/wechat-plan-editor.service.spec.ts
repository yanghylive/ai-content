import { WechatPlanEditorService } from './wechat-plan-editor.service';

describe('WechatPlanEditorService', () => {
  const sourceTask = {
    id: 'moments-1',
    type: 'wechat-moments-publish',
    accountId: 'local-wechat-desktop',
    accountName: '本机微信',
    platformName: '微信桌面',
    targetName: '朋友圈发布',
    sourceText: '旧文案',
    replyText: '旧文案',
    planName: '每日朋友圈',
    sendMode: 'auto-send',
    metadata: { planRevision: 2 },
  };

  function setup() {
    const localEngine = {
      getTaskForDisplay: jest.fn(async () => sourceTask),
      createTask: jest.fn(async (input) => ({ id: 'revision-1', ...input })),
      linkAgentSessionToTask: jest.fn(async (id, sessionId) => ({
        ...sourceTask,
        id,
        status: 'running',
        metadata: { agentSessionId: sessionId },
      })),
    };
    const aiClient = {
      generate: jest.fn(async () => '新版朋友圈文案'),
    };
    const defaultModels = {
      getDefaults: jest.fn(async () => ({
        articleCreation: 'text-model-1',
        topicSelection: '',
      })),
    };
    const service = new WechatPlanEditorService(
      localEngine as never,
      aiClient as never,
      defaultModels as never,
    );
    return { service, localEngine, aiClient };
  }

  it('saves edits as a new draft without publishing', async () => {
    const { service, localEngine } = setup();

    await service.createMomentsRevision('moments-1', {
      content: '修订后的正文',
      assetPaths: ['/tmp/1.jpg'],
      visibility: 'public',
    });

    expect(localEngine.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'wechat-moments-publish',
        planStatus: 'draft',
        sendMode: 'auto-send',
        commercialExecutionRequested: false,
        metadata: expect.objectContaining({
          revisionOfPlanId: 'moments-1',
          planRevision: 3,
        }),
      }),
    );
  });

  it('regenerates copy with the configured text model', async () => {
    const { service, aiClient } = setup();

    await expect(
      service.regenerateMomentsContent('moments-1', {
        instruction: '更简洁',
      }),
    ).resolves.toEqual({ content: '新版朋友圈文案' });

    expect(aiClient.generate).toHaveBeenCalledWith(
      'text-model-1',
      expect.any(Array),
      expect.objectContaining({ maxTokens: 800 }),
    );
  });

  it('generates copy before a moments plan has been created', async () => {
    const { service, localEngine, aiClient } = setup();

    await expect(
      service.generateMomentsDraftContent({
        instruction: '写一条新品到店通知',
      }),
    ).resolves.toEqual({ content: '新版朋友圈文案' });

    expect(localEngine.getTaskForDisplay).not.toHaveBeenCalled();
    expect(aiClient.generate).toHaveBeenCalledWith(
      'text-model-1',
      expect.any(Array),
      expect.objectContaining({ maxTokens: 800 }),
    );
  });

  it('links the Agent-S session back to the business task', async () => {
    const { service, localEngine } = setup();

    await expect(
      service.linkAgentSession('moments-1', 'agent-session-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'moments-1',
        status: 'running',
        metadata: { agentSessionId: 'agent-session-1' },
      }),
    );

    expect(localEngine.linkAgentSessionToTask).toHaveBeenCalledWith(
      'moments-1',
      'agent-session-1',
    );
  });
});
