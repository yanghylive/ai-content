import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from './interaction-task-runtime.mapper';
import type { InteractionTask } from '../../local-engine/local-engine.types';
import type { RuntimeExecutionResult } from '../executor.interface';

const baseTask: InteractionTask = {
  id: 'task-1',
  type: 'douyin-comment-reply',
  typeLabel: '抖音自动评论',
  status: 'running',
  statusLabel: '运行中',
  accountId: '12',
  accountName: '抖音账号',
  platformType: 3,
  platformName: '抖音',
  targetName: '评论用户',
  sourceText: '多少钱',
  replyText: '可以私信你具体价格。',
  sourceUrl: 'https://www.douyin.com/video/1',
  profileUrl: 'https://www.douyin.com/user/lead-1',
  commentTime: '今天',
  videoTitle: '热门加盟案例',
  videoUrl: 'https://www.douyin.com/video/1',
  engagementScore: 9200,
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
        sourceUrl: 'https://www.douyin.com/video/1',
        profileUrl: 'https://www.douyin.com/user/lead-1',
        commentTime: '今天',
        videoTitle: '热门加盟案例',
        videoUrl: 'https://www.douyin.com/video/1',
        engagementScore: 9200,
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

  it('preserves task metadata for desktop runtime executors', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-group-broadcast',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: 'KayPal (4)',
      sourceText: '客户问：今天能发资料吗？',
      replyText: '可以，资料我现在发你。',
      metadata: {
        skill_id: 'wechat-group-broadcast',
        wechat_group_targets: ['KayPal (4)'],
        wechat_reply_draft: '可以，资料我现在发你。',
        wechat_reply_mode: 'auto-send',
      },
    });

    expect(mapped.task.platform).toBe('wechat-desktop');
    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat-group-broadcast',
      wechat_group_targets: ['KayPal (4)'],
      wechat_reply_draft: '可以，资料我现在发你。',
      wechat_reply_mode: 'auto-send',
      targetName: 'KayPal (4)',
      replyText: '可以，资料我现在发你。',
    });
  });

  it('derives Node Runtime metadata for desktop WeChat reply tasks', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-reply-draft',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: 'KayPal (4)',
      sourceText: '客户问：能发资料吗？',
      replyText: '可以，我现在发你。',
    });

    expect(mapped.task.platform).toBe('wechat-desktop');
    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat.session.auto_reply',
      wechat_contact_name: 'KayPal (4)',
      wechat_expected_contact_name: 'KayPal (4)',
      wechat_reply_draft: '可以，我现在发你。',
      wechat_reply_mode: 'auto-send',
    });
  });

  it('derives Node Runtime metadata for desktop group broadcast targets', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-group-broadcast',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: 'KayPal (4)',
      sourceText: '群发对象：KayPal (4)',
      replyText: 'Kaypal 群发验收，请忽略。',
      batchTargets: [
        {
          id: 'bt-1',
          targetName: 'KayPal (4)',
          sourceText: '群发对象：KayPal (4)',
          replyText: 'Kaypal 群发验收，请忽略。',
          status: 'queued',
        },
      ],
    });

    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat-group-broadcast',
      wechat_group_targets: ['KayPal (4)'],
      wechat_reply_draft: 'Kaypal 群发验收，请忽略。',
      wechat_reply_mode: 'auto-send',
    });
  });

  it('preserves each contact-specific group message for desktop execution', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-group-broadcast',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: '客户甲',
      replyText: '默认消息',
      batchTargets: [
        {
          id: 'bt-a',
          targetName: '客户甲',
          replyText: '甲的专属消息',
          status: 'queued',
        },
        {
          id: 'bt-b',
          targetName: '客户乙',
          replyText: '乙的专属消息',
          status: 'queued',
        },
      ],
    });

    expect(mapped.task.payload).toMatchObject({
      wechat_mass_send_contents: [
        { targetName: '客户甲', sendContent: '甲的专属消息' },
        { targetName: '客户乙', sendContent: '乙的专属消息' },
      ],
      wechat_group_messages: [
        { target: '客户甲', message: '甲的专属消息' },
        { target: '客户乙', message: '乙的专属消息' },
      ],
    });
  });

  it('maps friend request review plans to the supported registration contract', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-friend-accept',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: '新的朋友',
      metadata: {
        remarkStrategy: 'manual',
        remarkContent: '活动客户',
        welcomeMessage: '你好，欢迎联系。',
        matchKeywords: ['咨询', '活动'],
        dailyLimit: 12,
      },
    });

    expect(mapped.task.type).toBe('wechat-friend-accept');
    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat.friend.accept',
      wechat_friend_accept_remark_strategy: 'manual',
      wechat_friend_accept_remark_content: '活动客户',
      wechat_friend_accept_welcome_message: '你好，欢迎联系。',
      wechat_friend_accept_match_keywords: ['咨询', '活动'],
      wechat_friend_accept_daily_limit: 12,
    });
  });

  it('passes all Moments details without collapsing item settings', () => {
    const details = [
      {
        content: '第一条文案',
        attachments: ['/tmp/first.png'],
        scheduledPublishTime: '2026-07-10T12:00:00.000Z',
        visibility: '公开',
        additionalComment: '第一条评论',
      },
      {
        content: '第二条文案',
        attachments: ['/tmp/second.mp4'],
        scheduledPublishTime: '2026-07-10T13:00:00.000Z',
        visibility: '私密',
        additionalComment: '第二条评论',
      },
    ];
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-moments-publish',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: '朋友圈计划',
      metadata: { wechat_moments_details: details },
    });

    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat-moments-publish',
      wechat_moments_details: details,
      momentsDetails: details,
      wechat_moments_content: '第一条文案',
      wechat_moments_asset_path: '/tmp/first.png',
      wechat_moments_visibility: '公开',
    });
  });

  it('passes target-specific moments marketing comments to Node Runtime', () => {
    const mapped = mapInteractionTaskToRuntimeInput({
      ...baseTask,
      type: 'wechat-moments-marketing',
      accountId: undefined,
      accountName: '桌面微信',
      platformName: '微信',
      targetName: '朋友圈第 1 条',
      sourceText: '朋友圈AI个性化验收',
      replyText: '默认朋友圈评论',
      metadata: {
        commentMode: 'ai',
        actions: { like: true, comment: true },
        targetComments: [
          { targetName: '朋友圈第 1 条', commentText: '评论 A' },
          { targetName: '朋友圈第 2 条', commentText: '评论 B' },
        ],
      },
      batchTargets: [
        {
          id: 'bt-1',
          targetName: '朋友圈第 1 条',
          sourceText: '目标 A',
          replyText: '评论 A',
          status: 'queued',
        },
        {
          id: 'bt-2',
          targetName: '朋友圈第 2 条',
          sourceText: '目标 B',
          replyText: '评论 B',
          status: 'queued',
        },
      ],
    });

    expect(mapped.task.payload).toMatchObject({
      skill_id: 'wechat-moments-marketing',
      wechat_moments_marketing_contacts: ['朋友圈第 1 条', '朋友圈第 2 条'],
      wechat_moments_marketing_comment_mode: 'ai',
      wechat_moments_marketing_target_comments: [
        { targetName: '朋友圈第 1 条', commentText: '评论 A' },
        { targetName: '朋友圈第 2 条', commentText: '评论 B' },
      ],
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
      sourceText: '客户问多少钱',
      targetText: '客户问多少钱',
      replyText: '可以私信你具体价格。',
      replyGeneratedBy: 'ai',
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
      nextAction: '已完成，可在任务证据里查看发送和回读结果。',
      readbackText: '可以私信你具体价格。',
      replyVisible: true,
      targetText: '客户问多少钱',
      sourceText: '客户问多少钱',
      replyText: '可以私信你具体价格。',
      replyGeneratedBy: 'ai',
      runtimeMode: 'persistent-cdp-browser',
    });
  });

  it('maps Node Runtime per-target results back to batch target updates', () => {
    const result: RuntimeExecutionResult = {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '朋友圈营销完成：成功 1，失败 1。',
      runtime: {
        mode: 'local-runtime',
        executor: 'desktop-agent-s',
      },
      evidence: [],
      result: {
        results: [
          { target: '朋友圈第 1 条', ok: true, message: '已处理' },
          { target: '朋友圈第 2 条', ok: false, message: '发送失败' },
        ],
      },
      readback: {
        expectedText: '评论 A',
        actualText: '评论 A',
        matched: true,
      },
    };

    expect(
      mapRuntimeResultToInteractionDraftResult(baseTask, result),
    ).toMatchObject({
      ok: true,
      status: 'sent',
      completedTargets: ['朋友圈第 1 条'],
      failedTargets: [{ targetName: '朋友圈第 2 条', reason: '发送失败' }],
    });
  });

  it('maps desktop WeChat runtime screenshots to desktop evidence', () => {
    const result: RuntimeExecutionResult = {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '朋友圈营销完成：成功 1，失败 0。',
      runtime: {
        mode: 'local-runtime',
        executor: 'desktop-agent-s',
      },
      evidence: [
        {
          type: 'screenshot',
          label: 'Node Runtime 微信执行截图',
          path: '/tmp/wechat-moments-sent.png',
          createdAt: '2026-06-15T00:00:01.000Z',
        },
      ],
    };

    expect(
      mapRuntimeResultToInteractionDraftResult(
        {
          ...baseTask,
          type: 'wechat-moments-marketing',
        },
        result,
      ).evidence,
    ).toEqual({
      type: 'desktop_screenshot',
      label: 'Node Runtime 微信执行截图',
      value: '/tmp/wechat-moments-sent.png',
      artifactUrl: '/tmp/wechat-moments-sent.png',
      createdAt: '2026-06-15T00:00:01.000Z',
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

    expect(
      mapRuntimeResultToInteractionDraftResult(baseTask, result),
    ).toMatchObject({
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

    expect(
      mapRuntimeResultToInteractionDraftResult(baseTask, result),
    ).toMatchObject({
      ok: false,
      status: 'send_failed',
      message: '抖音评论发送未通过回读确认',
      nextAction: 'expected=可以私信你具体价格。；readback=',
    });
  });
});
