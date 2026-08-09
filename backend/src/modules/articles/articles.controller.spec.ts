import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import {
  CreateArticleDraftDto,
  UpdateArticleDto,
} from './dto/article-workspace.dto';

describe('ArticlesController', () => {
  let controller: ArticlesController;
  const articlesService = {
    createDraft: jest.fn(),
    generateFromTopic: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArticlesController],
      providers: [
        {
          provide: ArticlesService,
          useValue: articlesService,
        },
      ],
    }).compile();

    controller = module.get<ArticlesController>(ArticlesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('会把空白草稿输入透传给 service', () => {
    const input = {
      title: '新品内容',
      contentType: 'article' as const,
      contentFormat: 'markdown' as const,
    };
    controller.createDraft(input);
    expect(articlesService.createDraft).toHaveBeenCalledWith(input);
  });

  it('会为草稿与工作区更新暴露可反射的运行时 DTO', () => {
    const createTypes = Reflect.getMetadata(
      'design:paramtypes',
      ArticlesController.prototype,
      'createDraft',
    );
    const updateTypes = Reflect.getMetadata(
      'design:paramtypes',
      ArticlesController.prototype,
      'update',
    );

    expect(createTypes).toEqual([CreateArticleDraftDto]);
    expect(updateTypes).toEqual([String, UpdateArticleDto]);
  });

  it('会校验 intent v1 并剥离冻结范围之外的字段', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata = {
      type: 'body' as const,
      metatype: CreateArticleDraftDto,
    };

    await expect(
      pipe.transform(
        {
          workspaceIntent: {
            task: 'multiplatform',
            goal: '形成多平台内容主稿',
            platforms: ['wechat', 'xiaohongshu'],
            brandId: 'not-allowed',
            materialIds: ['not-allowed'],
          },
          tenantId: 'not-allowed',
        },
        metadata,
      ),
    ).resolves.toEqual({
      workspaceIntent: {
        task: 'multiplatform',
        goal: '形成多平台内容主稿',
        platforms: ['wechat', 'xiaohongshu'],
      },
    });
  });

  it('会拒绝未知 intent task、平台和过长目标', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata = {
      type: 'body' as const,
      metatype: CreateArticleDraftDto,
    };

    await expect(
      pipe.transform({ workspaceIntent: { task: 'publish' } }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        {
          workspaceIntent: {
            task: 'create',
            platforms: ['unknown-platform'],
          },
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        {
          workspaceIntent: {
            task: 'create',
            goal: '目'.repeat(2001),
          },
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('大纲确认只接受原生布尔值，不接受隐式转换后的字符串', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata = { type: 'body' as const, metatype: UpdateArticleDto };

    await expect(
      pipe.transform({ confirmWorkspaceOutline: 'false' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ confirmWorkspaceOutline: '0' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ confirmWorkspaceOutline: true }, metadata),
    ).resolves.toMatchObject({ confirmWorkspaceOutline: true });
  });

  it('会把 contentType 查询参数透传给 service', () => {
    controller.generateFromTopic('topic-1', 'true', 'xiaohongshu');
    expect(articlesService.generateFromTopic.mock.calls[0].slice(0, 3)).toEqual(
      ['topic-1', true, 'xiaohongshu'],
    );
  });

  it('客户端断开时会取消正在生成的文章', async () => {
    const socket = new EventEmitter();
    let generationSignal: AbortSignal | undefined;
    articlesService.generateFromTopic.mockImplementationOnce(
      (...args: unknown[]) =>
        new Promise<never>((_, reject) => {
          generationSignal = args[4] as AbortSignal;
          generationSignal.addEventListener(
            'abort',
            () => reject(generationSignal?.reason),
            { once: true },
          );
        }),
    );

    const result = controller.generateFromTopic(
      'topic-2',
      undefined,
      'article',
      { socket } as any,
    );
    const assertion =
      expect(result).rejects.toThrow('文章生成客户端连接已断开');
    socket.emit('close');

    await assertion;
    expect(generationSignal?.aborted).toBe(true);
  });
});
