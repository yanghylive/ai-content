import { Test, TestingModule } from '@nestjs/testing';

jest.mock('./publishing.service', () => ({
  PublishingService: class PublishingService {},
}));

import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';

describe('PublishingController', () => {
  let controller: PublishingController;
  let publishingService: Record<string, jest.Mock>;

  beforeEach(async () => {
    publishingService = {
      getAccounts: jest.fn(),
      createAccount: jest.fn(),
      updateAccount: jest.fn(),
      createAccountDeleteConfirmation: jest.fn(),
      deleteAccount: jest.fn(),
      createPublishConfirmation: jest.fn(),
      publishArticle: jest.fn(),
      getRecordsByArticle: jest.fn(),
      getJpagePreview: jest.fn(),
      createJpagePreviewConfirmation: jest.fn(),
      createJpagePreview: jest.fn(),
      createJpageRemoteRenderConfirmation: jest.fn(),
      confirmJpageRemoteRender: jest.fn(),
      createWechatDraftConfirmation: jest.fn(),
      createWechatOfficialDraft: jest.fn(),
      createWechatDraftReadbackConfirmation: jest.fn(),
      reconcileWechatOfficialDraft: jest.fn(),
      createWechatOfficialPublishConfirmation: jest.fn(),
      submitWechatOfficialPublish: jest.fn(),
      refreshWechatOfficialPublish: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [
        {
          provide: PublishingService,
          useValue: publishingService,
        },
      ],
    }).compile();

    controller = module.get<PublishingController>(PublishingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates account deletion confirmation and consumption', async () => {
    await controller.createAccountDeleteConfirmation('account-1');
    await controller.deleteAccount('account-1', {
      confirmationId: 'confirmation-1',
    });

    expect(
      publishingService.createAccountDeleteConfirmation,
    ).toHaveBeenCalledWith('account-1');
    expect(publishingService.deleteAccount).toHaveBeenCalledWith(
      'account-1',
      'confirmation-1',
    );
  });

  it('delegates approved draft readback reconciliation', async () => {
    await controller.createWechatDraftReadbackConfirmation('draft-record-1');
    await controller.reconcileWechatDraft('draft-record-1', {
      confirmationId: 'confirmation-1',
    });

    expect(
      publishingService.createWechatDraftReadbackConfirmation,
    ).toHaveBeenCalledWith('draft-record-1');
    expect(publishingService.reconcileWechatOfficialDraft).toHaveBeenCalledWith(
      'draft-record-1',
      'confirmation-1',
    );
  });

  it('delegates JPage preview upload and remote render confirmations', async () => {
    await controller.createJpagePreviewConfirmation({
      articleId: 'article-1',
      jpageAccountId: 'jpage-account-1',
    });
    await controller.createJpagePreview({
      articleId: 'article-1',
      jpageAccountId: 'jpage-account-1',
      confirmationId: 'upload-confirmation-1',
    });
    await controller.createJpageRemoteRenderConfirmation('article-1');
    await controller.confirmJpageRemoteRender('article-1', {
      confirmationId: 'render-confirmation-1',
    });

    expect(
      publishingService.createJpagePreviewConfirmation,
    ).toHaveBeenCalledWith('article-1', 'jpage-account-1');
    expect(publishingService.createJpagePreview).toHaveBeenCalledWith(
      'article-1',
      'jpage-account-1',
      'upload-confirmation-1',
    );
    expect(
      publishingService.createJpageRemoteRenderConfirmation,
    ).toHaveBeenCalledWith('article-1');
    expect(publishingService.confirmJpageRemoteRender).toHaveBeenCalledWith(
      'article-1',
      'render-confirmation-1',
    );
  });
});
