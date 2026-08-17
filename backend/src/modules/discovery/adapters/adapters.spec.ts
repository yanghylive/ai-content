import { parseCsv, toCsv } from './csv';
import { ManualAdapter } from './manual.adapter';
import { VideoLinkAdapter, parseVideoUrl } from './video-link.adapter';
import type { DiscoveryInput } from '../discovery.types';

describe('csv parser', () => {
  it('正确处理引号内逗号/换行/双引号转义', () => {
    const csv = 'nickname,sourceText,url\n"张三","价格, 怎么收费？","https://x/1"\n"李四","说""你好""","https://x/2"';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(['nickname', 'sourceText', 'url']);
    expect(r.rows[0]).toEqual({ nickname: '张三', sourceText: '价格, 怎么收费？', url: 'https://x/1' });
    expect(r.rows[1]).toEqual({ nickname: '李四', sourceText: '说"你好"', url: 'https://x/2' });
  });

  it('处理 \\r\\n 行尾和 BOM', () => {
    const csv = '\uFEFFa,b\r\n1,2\r\n3,4\r\n';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toHaveLength(2);
  });

  it('toCsv 往返一致', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'z"q' }]);
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual({ a: 'x,y', b: 'z"q' });
  });
});

describe('ManualAdapter', () => {
  it('CSV 文本 → DiscoveryItem（字段映射 + 去重 rawHash）', async () => {
    const adapter = new ManualAdapter();
    const items: unknown[] = [];
    const input: DiscoveryInput = {
      platform: 'manual',
      accountId: 'acc-1',
      mode: 'manual-import',
      input: {
        csvText: '昵称,评论,链接\n张三,怎么收费,https://x/1\n李四,加微信,https://x/2',
      },
      timeWindow: { from: '2026-01-01', to: '2026-12-31' },
      limit: 10,
      riskMode: 'draft-only',
    };
    for await (const item of adapter.discover(input, {} as never)) {
      items.push(item);
    }
    expect(items).toHaveLength(2);
    const first = items[0] as { platform: string; sourceContent: { text?: string }; interactionEvents: Array<{ text?: string }> };
    expect(first.platform).toBe('unknown'); // 未指定平台列
    expect(first.sourceContent.text).toBe('怎么收费');
    expect(first.interactionEvents[0].text).toBe('怎么收费');
  });

  it('空行/无效记录跳过', async () => {
    const adapter = new ManualAdapter();
    const items: unknown[] = [];
    const input: DiscoveryInput = {
      platform: 'manual',
      accountId: 'acc-1',
      mode: 'manual-import',
      input: { rows: [{ nickname: '张三', sourceText: 'A' }, {}, { sourceText: '' }] },
      timeWindow: { from: 'a', to: 'b' },
      limit: 10,
      riskMode: 'draft-only',
    };
    for await (const item of adapter.discover(input, {} as never)) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
  });

  it('capabilities：manual-import 模式', async () => {
    const adapter = new ManualAdapter();
    const cap = await adapter.capabilities();
    expect(cap.modes).toContain('manual-import');
  });
});

describe('VideoLinkAdapter', () => {
  it('解析抖音/小红书/B站链接', () => {
    expect(parseVideoUrl('https://www.douyin.com/video/7312345678901234567')).toMatchObject({
      platform: 'douyin',
      externalContentId: '7312345678901234567',
    });
    expect(parseVideoUrl('https://www.xiaohongshu.com/explore/64f0abcde123')).toMatchObject({
      platform: 'xiaohongshu',
      externalContentId: '64f0abcde123',
    });
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7')).toMatchObject({
      platform: 'bilibili',
      externalContentId: 'BV1GJ411x7h7',
    });
  });

  it('不认识的链接 → null', () => {
    expect(parseVideoUrl('https://example.com/foo')).toBeNull();
  });

  it('discover 产出 sourceContent，评论抓取明确不产出（不假报成功）', async () => {
    const adapter = new VideoLinkAdapter();
    const items: unknown[] = [];
    const input: DiscoveryInput = {
      platform: 'video-link',
      accountId: 'acc-1',
      mode: 'video-link',
      input: { url: 'https://www.douyin.com/video/7312345678901234567' },
      timeWindow: { from: 'a', to: 'b' },
      limit: 5,
      riskMode: 'draft-only',
    };
    for await (const item of adapter.discover(input, {} as never)) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
    const cap = await adapter.capabilities();
    expect(cap.supportsComment).toBe(false);
    expect(cap.unavailableReason).toBeTruthy();
  });
});

import { DouyinAdapter } from './douyin.adapter';
import { BrowserDiscoverError } from '../discovery-browser-runner';
import { ShipinhaoAdapter, WecomAdapter, KuaishouAdapter, XiaohongshuAdapter } from './platform-connectors';

describe('DouyinAdapter', () => {
  it('无浏览器会话 → unavailableReason 明确置灰，discover 抛结构化原因码', async () => {
    const adapter = new DouyinAdapter(undefined, { browserEnabled: false });
    const cap = await adapter.capabilities();
    expect(cap.supportsComment).toBe(false);
    expect(cap.unavailableReason).toContain('浏览器会话');
    await expect(
      (async () => {
        const input = { platform: 'douyin', accountId: 'a', mode: 'keyword', input: { keyword: 'x' }, timeWindow: { from: 'a', to: 'b' }, limit: 5, riskMode: 'draft-only' } as never;
        for await (const _ of adapter.discover(input, {} as never)) { /* noop */ }
      })(),
    ).rejects.toThrow(BrowserDiscoverError);
  });

  it('有浏览器会话（mock runner）→ 能力开放 + video-link 无需会话', async () => {
    const runner = {
      searchByKeyword: jest.fn().mockResolvedValue([]),
      listAccountWorks: jest.fn().mockResolvedValue([]),
    };
    const adapter = new DouyinAdapter(runner as never, { browserEnabled: true, dailyQuota: 300 });
    const cap = await adapter.capabilities();
    expect(cap.modes).toEqual(['keyword', 'video-link', 'target-account']);
    expect(cap.supportsComment).toBe(true);
    expect(cap.unavailableReason).toBeUndefined();

    // video-link 无需 runner 也可产出
    const items: unknown[] = [];
    const input = { platform: 'douyin', accountId: 'a', mode: 'video-link', input: { url: 'https://www.douyin.com/video/7312345678901234567' }, timeWindow: { from: 'a', to: 'b' }, limit: 5, riskMode: 'draft-only' } as never;
    for await (const item of adapter.discover(input, {} as never)) items.push(item);
    expect(items).toHaveLength(1);
  });

  it('keyword 模式：runner 返回结果 → yield 给调用方', async () => {
    const runner = {
      searchByKeyword: jest.fn().mockResolvedValue([
        {
          platform: 'douyin',
          accountId: 'a',
          sourceContent: { externalContentId: 'c1', url: 'https://www.douyin.com/video/1', contentType: 'video', title: '测试视频', rawHash: 'h1' },
        },
      ]),
      listAccountWorks: jest.fn().mockResolvedValue([]),
    };
    const adapter = new DouyinAdapter(runner as never, { browserEnabled: true });
    const items: unknown[] = [];
    const input = { platform: 'douyin', accountId: 'a', mode: 'keyword', input: { keyword: 'AI 获客' }, timeWindow: { from: 'a', to: 'b' }, limit: 5, riskMode: 'draft-only' } as never;
    for await (const item of adapter.discover(input, {} as never)) items.push(item);
    expect(items).toHaveLength(1);
    expect(runner.searchByKeyword).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'AI 获客' }),
    );
  });
});

describe('Platform connectors（T5.3）', () => {
  it('四个平台未授权时均明确 unavailableReason（unsupported 置灰不报假成功）', async () => {
    const adapters = [
      new ShipinhaoAdapter(),
      new WecomAdapter(),
      new KuaishouAdapter(),
      new XiaohongshuAdapter(),
    ];
    for (const a of adapters) {
      const cap = await a.capabilities();
      expect(cap.unavailableReason).toBeTruthy();
      expect(cap.supportsComment).toBe(false);
      expect(cap.dailyQuota).toBe(0);
    }
  });

  it('能力差异前置显示：publishMode 未授权为 collect-only', async () => {
    const cap = await new WecomAdapter().capabilities();
    expect(cap.publishMode).toBe('collect-only');
  });
});
