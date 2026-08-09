import { Test, TestingModule } from '@nestjs/testing';
import { WechatPublisherService } from './wechat-publisher.service';
import { WechatCompiler } from './wechat-compiler';

jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((markdown: string) => `<p>${markdown}</p>`),
  },
}));

describe('WechatPublisherService', () => {
  let service: WechatPublisherService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WechatPublisherService],
    }).compile();

    service = module.get<WechatPublisherService>(WechatPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('removes active HTML and unsafe URL attributes from model output', async () => {
    const html = await WechatCompiler.compile(
      '<style>body{background:url(https://tracker.example/pixel)}</style><script>alert(1)</script><svg><a xlink:href="javascript:alert(3)">x</a></svg><img src="javascript:alert(1)" srcset="https://tracker.example/a 2x" onerror="alert(2)">正文',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('srcset');
    expect(html).not.toContain('tracker.example');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('正文');
  });

  it('returns explicit provider readback and evidence without inferring it from an id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: {
          articleId: 'wechat-article-1',
          publishUrl: 'https://publisher.example.test/articles/1',
          evidence: { requestId: 'request-1' },
          readback: {
            matched: true,
            expectedText: '门店文章',
            actualText: '门店文章',
          },
        },
      }),
    } as never);

    const result = await service.publish({
      apiToken: 'token',
      authorizerAppid: 'wx-app',
      apiUrl: 'https://mp.idouq.com/api/open/article',
      title: '门店文章',
      htmlContent:
        '<script>alert(1)</script><img src="javascript:alert(2)" onerror="alert(3)"><p>内容</p>',
      sourceUrl: 'https://source.example.test/articles/1',
    });

    expect(result).toEqual({
      articleId: 'wechat-article-1',
      publishUrl: 'https://publisher.example.test/articles/1',
      evidence: { requestId: 'request-1' },
      readback: {
        matched: true,
        expectedText: '门店文章',
        actualText: '门店文章',
      },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://mp.idouq.com/api/open/article',
      expect.objectContaining({
        redirect: 'error',
        body: expect.stringContaining(
          '"source_url":"https://source.example.test/articles/1"',
        ),
      }),
    );
    const requestBody = String(
      (global.fetch as jest.Mock).mock.calls[0][1]?.body || '',
    );
    expect(requestBody).not.toContain('<script');
    expect(requestBody).not.toContain('onerror');
    expect(requestBody).not.toContain('javascript:');
  });

  it('rejects non-allowlisted publisher URLs before making a request', async () => {
    const request = jest.spyOn(global, 'fetch');
    await expect(
      service.publish({
        apiToken: 'token',
        authorizerAppid: 'wx-app',
        apiUrl: 'http://127.0.0.1:8080/internal',
        title: '门店文章',
        htmlContent: '<p>内容</p>',
        sourceUrl: 'https://source.example.test/articles/1',
      }),
    ).rejects.toThrow('WECHAT_PUBLISH_ALLOWED_HOSTS');
    expect(request).not.toHaveBeenCalled();
  });

  it('creates and reads back an official WeChat draft', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ media_id: 'draft-media-1' }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          news_item: [
            {
              title: '已核对文章',
              content: WechatCompiler.sanitizeHtml('<p>正文</p>'),
            },
          ],
        }),
      } as never);

    const result = await service.createOfficialDraft({
      accessToken: 'access token',
      title: '已核对文章',
      author: 'KAYPAL',
      digest: '摘要',
      htmlContent: '<p>正文</p>',
      sourceUrl: 'https://source.example.test/article',
      thumbMediaId: 'cover-media-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        mediaId: 'draft-media-1',
        payload: {
          articles: [
            expect.objectContaining({
              title: '已核对文章',
              thumb_media_id: 'cover-media-1',
            }),
          ],
        },
        readback: {
          matched: true,
          expectedTitle: '已核对文章',
          actualTitle: '已核对文章',
          contentMatched: true,
        },
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.weixin.qq.com/cgi-bin/draft/add?access_token=access%20token',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('keeps media id and add payload when draft readback fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ media_id: 'draft-media-recover' }),
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          errcode: 40001,
          errmsg: 'readback unavailable',
        }),
      } as never);

    const result = await service.createOfficialDraft({
      accessToken: 'access-token',
      title: '待恢复文章',
      htmlContent: '<p>正文</p>',
      sourceUrl: 'https://source.example.test/article',
      thumbMediaId: 'cover-media-recover',
    });

    expect(result.mediaId).toBe('draft-media-recover');
    expect(result.payload.articles[0]).toEqual(
      expect.objectContaining({
        title: '待恢复文章',
        thumb_media_id: 'cover-media-recover',
      }),
    );
    expect(result.readback).toEqual(
      expect.objectContaining({
        matched: false,
        expectedTitle: '待恢复文章',
        failureReason: expect.stringContaining('40001'),
      }),
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(
      String((global.fetch as jest.Mock).mock.calls[0][1]?.body),
    ).toContain('cover-media-recover');
  });

  it('submits and reads back an official WeChat publication job', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ publish_id: 'publish-1' }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          publish_status: 0,
          article_detail: {
            item: [
              {
                article_id: 'article-1',
                article_url: 'https://mp.weixin.qq.com/s/example',
              },
            ],
          },
        }),
      } as never);

    const submitted = await service.submitOfficialPublish(
      'access-token',
      'draft-media-1',
    );
    const status = await service.getOfficialPublishStatus(
      'access-token',
      submitted.publishId,
    );

    expect(submitted.publishId).toBe('publish-1');
    expect(status).toEqual(
      expect.objectContaining({
        status: 'published',
        articleId: 'article-1',
      }),
    );
  });
});
