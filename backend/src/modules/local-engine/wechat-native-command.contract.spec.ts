import {
  WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
  WECHAT_NATIVE_COMMAND_DEFINITIONS,
  WECHAT_NATIVE_COMMANDS,
  buildWechatNativeCommandFailure,
  createWechatNativeCommandRequest,
  getWechatNativeCommandDefinition,
  resolveWechatNativeCommandKey,
  type WechatNativeCommandRunner,
} from './wechat-native-command.contract';

describe('wechat-native-command contract', () => {
  it('declares the unified command set for desktop WeChat runtime work', () => {
    expect(WECHAT_NATIVE_COMMANDS).toEqual([
      'contacts',
      'group-broadcast',
      'contact-add',
      'friend-accept',
      'moments-publish',
      'moments-marketing',
      'chat-history',
      'auto-reply',
    ]);

    for (const command of WECHAT_NATIVE_COMMANDS) {
      const definition = WECHAT_NATIVE_COMMAND_DEFINITIONS[command];

      expect(definition.key).toBe(command);
      expect(definition.schema.input.type).toBe('object');
      expect(definition.schema.output.type).toBe('object');
      expect(definition.schema.diagnostics.type).toBe('object');
      expect(definition.schema.error.type).toBe('object');
      expect(definition.legacySkillIds.length).toBeGreaterThan(0);
    }
  });

  it('keeps legacy task and metadata aliases visible for the adapter layer', () => {
    expect(resolveWechatNativeCommandKey('wechat-contact-add')).toBe(
      'contact-add',
    );
    expect(resolveWechatNativeCommandKey('wechat-friend-accept')).toBe(
      'friend-accept',
    );
    expect(resolveWechatNativeCommandKey('wechat-moments-marketing')).toBe(
      'moments-marketing',
    );
    expect(resolveWechatNativeCommandKey('chat-history')).toBe('chat-history');

    expect(
      getWechatNativeCommandDefinition('group-broadcast').legacyMetadataKeys,
    ).toEqual(
      expect.arrayContaining(['wechat_group_targets', 'wechat_reply_draft']),
    );
    expect(
      getWechatNativeCommandDefinition('moments-publish').legacyMetadataKeys,
    ).toEqual(
      expect.arrayContaining([
        'wechat_moments_content',
        'wechat_moments_asset_path',
      ]),
    );
    expect(
      getWechatNativeCommandDefinition('chat-history').legacySkillIds,
    ).toContain('wechat-chat-sync');
    expect(
      getWechatNativeCommandDefinition('friend-accept').supportsAutoSend,
    ).toBe(true);
    expect(
      getWechatNativeCommandDefinition('group-broadcast').schema.input
        .properties,
    ).toHaveProperty('messages');
    expect(
      getWechatNativeCommandDefinition('moments-publish').schema.input
        .properties,
    ).toHaveProperty('items');
  });

  it('builds typed requests and lets a reusable runner return command output', async () => {
    const request = createWechatNativeCommandRequest({
      command: 'group-broadcast',
      input: {
        targets: [{ wxid: 'wxid_customer_a', displayName: 'Customer A' }],
        message: { text: 'Kaypal broadcast smoke.' },
      },
      context: {
        relatedId: 'task-1',
        relatedType: 'interaction-task',
        safety: {
          sendMode: 'approval',
          riskLevel: 'medium',
          targetLockRequired: true,
          readbackRequired: true,
        },
      },
    });
    const runner: WechatNativeCommandRunner = {
      runnerId: 'mock-wechat-native-runner',
      contractVersion: WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
      supportedCommands: ['group-broadcast'],
      async run(input) {
        expect(input.command).toBe('group-broadcast');
        return {
          contractVersion: input.contractVersion,
          command: input.command,
          ok: true,
          status: 'success',
          output: {
            summary: {
              total: 1,
              succeeded: 1,
              failed: 0,
              blocked: 0,
              skipped: 0,
            },
            results: [
              {
                targetName: 'Customer A',
                action: 'draft',
                ok: true,
                status: 'draft_filled',
                message: 'Draft filled.',
              },
            ],
          },
          diagnostics: {
            command: 'group-broadcast',
            stage: 'draft-filled',
            batch: {
              requestedTargets: 1,
              attemptedTargets: 1,
              succeededTargets: 1,
              failedTargets: 0,
              blockedTargets: 0,
            },
          },
        };
      },
    };

    const response = await runner.run(request);

    expect(request.contractVersion).toBe(
      WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
    );
    expect(response.output?.summary).toMatchObject({
      total: 1,
      succeeded: 1,
    });
  });

  it('standardizes failed responses without selecting a concrete runtime', () => {
    const request = createWechatNativeCommandRequest({
      command: 'chat-history',
      input: { action: 'sync', limit: 50 },
      context: {
        safety: {
          sendMode: 'read-only',
          riskLevel: 'low',
        },
      },
    });

    const response = buildWechatNativeCommandFailure(
      request,
      {
        code: 'unsupported_platform',
        category: 'runtime',
        message: 'Chat history sync is not supported on this platform.',
        retryable: false,
        manualActionRequired: true,
      },
      {
        command: 'chat-history',
        stage: 'preflight',
        chatHistory: {
          sessionsScanned: 0,
          messagesScanned: 0,
        },
      },
    );

    expect(response).toMatchObject({
      ok: false,
      status: 'failed',
      command: 'chat-history',
      error: {
        code: 'unsupported_platform',
        manualActionRequired: true,
      },
    });
  });
});
