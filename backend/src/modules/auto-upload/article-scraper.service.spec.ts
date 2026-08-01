import { ArticleScraperService } from './article-scraper.service';

describe('ArticleScraperService', () => {
  let service: ArticleScraperService;

  beforeEach(() => {
    service = new ArticleScraperService();
  });

  it('rejects invalid URLs', async () => {
    await expect(service.scrapeUrl('not-a-url')).rejects.toThrow('有效');
    await expect(service.scrapeUrl('')).rejects.toThrow('有效');
  });

  it('rejects non-HTTP protocols', async () => {
    await expect(service.scrapeUrl('ftp://example.com/article')).rejects.toThrow('有效');
  });

  it('extracts title and content from HTML', async () => {
    const html = `
      <html>
        <head>
          <title>测试文章标题</title>
          <meta property="og:title" content="OG标题" />
          <meta property="og:site_name" content="测试站" />
          <meta name="author" content="张三" />
          <meta property="article:published_time" content="2026-07-01T00:00:00Z" />
        </head>
        <body>
          <nav>导航栏</nav>
          <article>
            <h1>正文标题</h1>
            <p>这是正文内容段落。</p>
            <img src="/relative/image.jpg" alt="图片说明" width="800" height="600" />
            <img src="https://cdn.example.com/cover.png" alt="封面" />
            <script>alert('xss')</script>
            <div class="ad">广告内容</div>
          </article>
          <footer>页脚</footer>
        </body>
      </html>
    `;

    // Mock fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      arrayBuffer: () => Promise.resolve(Buffer.from(html, 'utf8')),
    }) as never;

    try {
      const result = await service.scrapeUrl('https://example.com/article/123');

      expect(result.title).toBe('OG标题');
      expect(result.siteName).toBe('测试站');
      expect(result.author).toBe('张三');
      expect(result.publishedAt).toBe('2026-07-01T00:00:00Z');
      expect(result.contentFormat).toBe('html');
      expect(result.content).toContain('正文内容段落');
      expect(result.content).not.toContain('alert');
      expect(result.content).not.toContain('广告内容');
      expect(result.images).toHaveLength(2);
      expect(result.images[0].src).toBe('https://example.com/relative/image.jpg');
      expect(result.images[0].alt).toBe('图片说明');
      expect(result.images[0].width).toBe(800);
      expect(result.images[1].src).toBe('https://cdn.example.com/cover.png');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failures gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Map(),
      arrayBuffer: () => Promise.resolve(Buffer.from('')),
    }) as never;

    try {
      await expect(service.scrapeUrl('https://example.com/missing')).rejects.toThrow('404');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
