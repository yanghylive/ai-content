import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from './interaction-task-runtime.mapper';
import type { InteractionTask } from '../../local-engine/local-engine.types';
import type { RuntimeExecutionResult } from '../executor.interface';

const baseTask: InteractionTask = {
  id: 'task-1',
  type: 'douyin-comment-reply',
  typeLabel: '抖音评论回复',
  status: 'running',
  statusLabel: '运行中',
  accountId: '12',
  accountName: '抖音账号',
  platformType: 3,
  platformName: '抖音',
  targetName: '评论用户',
  sourceText: '多少钱',
  replyText: '可以私信你具体价格。',
  sendMode: 'auto-send',
  executionMode: 'browser-assisted',
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  events: [],
};

describe('interaction-task-runtime.mapper', () => {
  it('maps browser-assisted interaction task to RuntimeOrchestrator input', () => {
    const mapped = mapInteractionTaskToRuntimeInput(baseTask, {
      accountId: 'operator-1',
      accountName: 'Operator',
    });

    expect(mapped.task).toMatchObject({
      relatedId: 'task-1',
      relatedType: 'interaction-task',
      type: 'douyin-comment-reply',
      platform: 'douyin',
        accountId: '12',
      payload: {
        targetName: '评论用户',
        targetText: '多少钱',
        replyText: '可以私信你具体价格。',
      },
    });
    expect(mapped.ctx).toMatchObject({
      sendMode: 'auto-send',
      riskContext: {
        accountId: 'operator-1',
        accountName: 'Operator',
      },
    });
  });

  it('maps RuntimeExecutionResult back to legacy send result shape', () => {
    const result: RuntimeExecutionResult = {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '抖音评论已发送',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
        engineUrl: 'internal://ai-content/local-interaction',
      },
      evidence: [
        {
          type: 'screenshot',
          label: '发送截图',
          path: '/tmp/evidence.png',
          createdAt: '2026-06-03T00:00:01.000Z',
        },
      ],
      readback: {
        expectedText: '可以私信你具体价格。',
        actualText: '可以私信你具体价格。',
        matched: true,
      },
    };

    expect(mapRuntimeResultToInteractionDraftResult(baseTask, result)).toEqual({
      ok: true,
      status: 'sent',
      message: '抖音评论已发送',
      evidence: {
        type: 'screenshot',
        label: '发送截图',
        value: '/tmp/evidence.png',
        artifactUrl: '/tmp/evidence.png',
        createdAt: '2026-06-03T00:00:01.000Z',
      },
      nextAction: undefined,
      readbackText: '可以私信你具体价格。',
      replyVisible: true,
    });
  });

  it('maps approval-send runtime success back to legacy draft result shape', () => {
    const result: RuntimeExecutionResult = {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '抖音评论草稿已填入',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [],
    };

    expect(
      mapRuntimeResultToInteractionDraftResult(
        { ...baseTask, sendMode: 'approval-send' },
        result,
      ),
    ).toMatchObject({
      ok: true,
      status: 'draft_filled',
      message: '抖音评论草稿已填入',
    });
  });

  it('keeps account_not_logged_in reason visible in legacy message', () => {
    const result: RuntimeExecutionResult = {
      ok: false,
      status: 'failed',
      reasonCode: 'account_not_logged_in',
      userMessage: '抖音账号未登录：不能回复评论',
      technicalMessage: '请完成抖音后台登录后重试',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [],
    };

    expect(mapRuntimeResultToInteractionDraftResult(baseTask, result)).toMatchObject({
      ok: false,
      status: 'editor_missing',
      message: '抖音账号未登录：不能回复评论',
      nextAction: '请完成抖音后台登录后重试',
    });
  });

  it('keeps readback_failed visible as send_failed with readback message', () => {
    const result: RuntimeExecutionResult = {
      ok: false,
      status: 'failed',
      reasonCode: 'readback_failed',
      userMessage: '抖音评论发送未通过回读确认',
      technicalMessage: 'expected=可以私信你具体价格。；readback=',
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [],
    };

    expect(mapRuntimeResultToInteractionDraftResult(baseTask, result)).toMatchObject({
      ok: false,
      status: 'send_failed',
      message: '抖音评论发送未通过回读确认',
      nextAction: 'expected=可以私信你具体价格。；readback=',
    });
  });

});
