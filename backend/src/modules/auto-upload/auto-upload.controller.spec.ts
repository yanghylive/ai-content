import { IS_PUBLIC_KEY } from '../auth/auth.decorator';
import { AutoUploadController } from './auto-upload.controller';

describe('AutoUploadController route access', () => {
  it('keeps health public while requiring auth for CDP session details', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        AutoUploadController.prototype.getHealth,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        AutoUploadController.prototype.getInteractionCdpSessions,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        AutoUploadController.prototype.getInteractionCapabilities,
      ),
    ).toBeUndefined();
  });

  it('rejects legacy negative task ids at the user-facing boundary', () => {
    const service = { getPublishBatchResults: jest.fn() };
    const controller = new AutoUploadController(service as never);

    expect(() => controller.getPlatformResults('-42')).toThrow('任务 ID 无效');
    expect(service.getPublishBatchResults).not.toHaveBeenCalled();
  });

  it('passes publish history pagination and search to the service', () => {
    const service = {
      listTaskPage: jest.fn(),
      listTasks: jest.fn(),
    };
    const controller = new AutoUploadController(service as never);

    controller.listTasks(undefined, '12', '20', '目标文章', 'failed', '抖音');

    expect(service.listTaskPage).toHaveBeenCalledWith({
      page: 12,
      pageSize: 20,
      search: '目标文章',
      status: 'failed',
      platform: '抖音',
    });
    expect(service.listTasks).not.toHaveBeenCalled();
  });

  it('uses server pagination when listing platform accounts', () => {
    const service = {
      listAccountPage: jest.fn(),
      listAccounts: jest.fn(),
    };
    const controller = new AutoUploadController(service as never);

    controller.listAccounts('true', undefined, undefined, '3', '50', '品牌');

    expect(service.listAccountPage).toHaveBeenCalledWith({
      validate: true,
      force: false,
      ids: undefined,
      page: 3,
      pageSize: 50,
      search: '品牌',
    });
    expect(service.listAccounts).not.toHaveBeenCalled();
  });

  it('issues and consumes server publish confirmations instead of client self-reporting', () => {
    const service = {
      createPublishConfirmation: jest.fn(),
      publishBatch: jest.fn(),
    };
    const controller = new AutoUploadController(service as never);
    const payload = {
      type: 3,
      title: '门店视频',
      tags: [],
      fileList: ['video.mp4'],
      accountList: ['douyin.json'],
    } as never;
    const request = {
      authSessionId: 'session-1',
      authUser: { id: 'user-1', name: '测试用户' },
      headers: {},
    } as never;

    controller.createPublishConfirmation({ payloads: [payload] }, request);
    controller.publishBatch(
      { payloads: [payload], confirmationId: 'confirmation-1' },
      request,
    );

    expect(service.createPublishConfirmation).toHaveBeenCalledWith(
      [payload],
      expect.objectContaining({
        accountId: 'user-1',
        accountName: '测试用户',
        deviceId: 'session-1',
      }),
    );
    expect(service.publishBatch).toHaveBeenCalledWith([payload], {
      confirmationId: 'confirmation-1',
      context: expect.objectContaining({
        accountId: 'user-1',
        deviceId: 'session-1',
      }),
    });
  });

  it('uses server confirmation ids for retry and blocked-task recovery', () => {
    const service = {
      createRetryPublishConfirmation: jest.fn(),
      retryPublishTask: jest.fn(),
      createResumeBlockedTasksConfirmation: jest.fn(),
      resumeAccountBlockedTasks: jest.fn(),
    };
    const controller = new AutoUploadController(service as never);
    const request = {
      authSessionId: 'session-1',
      authUser: { id: 'user-1', name: '测试用户' },
      headers: {},
    } as never;

    controller.createRetryTaskConfirmation('17', request);
    controller.retryTask('17', 'retry-confirmation-1', request);
    controller.createRecoverBlockedTasksConfirmation(9, request);
    controller.recoverBlockedTasks(9, 'resume-confirmation-1', request);

    expect(service.createRetryPublishConfirmation).toHaveBeenCalledWith(
      17,
      expect.objectContaining({ accountId: 'user-1', deviceId: 'session-1' }),
    );
    expect(service.retryPublishTask).toHaveBeenCalledWith(17, {
      confirmationId: 'retry-confirmation-1',
      context: expect.objectContaining({
        accountId: 'user-1',
        deviceId: 'session-1',
      }),
    });
    expect(service.createResumeBlockedTasksConfirmation).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ accountId: 'user-1', deviceId: 'session-1' }),
    );
    expect(service.resumeAccountBlockedTasks).toHaveBeenCalledWith(9, {
      confirmationId: 'resume-confirmation-1',
      context: expect.objectContaining({
        accountId: 'user-1',
        deviceId: 'session-1',
      }),
    });
  });
});
