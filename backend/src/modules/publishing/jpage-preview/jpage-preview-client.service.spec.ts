import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { JpagePreviewClientService } from './jpage-preview-client.service';

describe('JpagePreviewClientService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'JPAGE_ALLOWED_HOSTS') return 'jpage.example.test';
      if (key === 'JPAGE_TIMEOUT_MS') return '5000';
      return undefined;
    }),
  } as unknown as ConfigService;
  let service: JpagePreviewClientService;
  let fetchMock: jest.Mock;

  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  beforeEach(() => {
    service = new JpagePreviewClientService(config);
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  it('uploads a private file, applies tags, and verifies exact remote content', async () => {
    const content = '# 私有预览';
    fetchMock
      .mockImplementationOnce(() => json({ files: [] }))
      .mockImplementationOnce(() =>
        json({ id: 42, original_name: 'article.md', is_public: 0 }),
      )
      .mockImplementationOnce(() =>
        json({
          tags: [
            { id: 1, name: 'wechat-official-account' },
            { id: 2, name: 'pre-draft-preview' },
          ],
        }),
      )
      .mockImplementationOnce(() => json({ success: true }))
      .mockImplementationOnce(() =>
        json({
          id: 42,
          original_name: 'article.md',
          file_type: 'markdown',
          size: Buffer.byteLength(content),
          is_public: 0,
          tags: [
            { id: 1, name: 'wechat-official-account' },
            { id: 2, name: 'pre-draft-preview' },
          ],
        }),
      )
      .mockImplementationOnce(() => json({ content }));

    const result = await service.ensurePrivateFile({
      baseUrl: 'https://jpage.example.test',
      token: 'secret-token',
      name: 'article.md',
      content,
      tags: ['wechat-official-account', 'pre-draft-preview'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: '42',
        name: 'article.md',
        isPublic: false,
        sha256: createHash('sha256').update(content).digest('hex'),
      }),
    );
    const uploadRequest = fetchMock.mock.calls[1];
    expect(uploadRequest[0]).toBe(
      'https://jpage.example.test/api/files/upload-json',
    );
    expect(JSON.parse(uploadRequest[1].body)).toEqual(
      expect.objectContaining({ isPublic: false }),
    );
    expect(uploadRequest[1].headers.authorization).toBe('Bearer secret-token');
  });

  it('reuses an exact private remote file instead of uploading again', async () => {
    const content = '<p>preview</p>';
    fetchMock
      .mockImplementationOnce(() =>
        json({ files: [{ id: 9, original_name: 'article.html' }] }),
      )
      .mockImplementationOnce(() =>
        json({
          id: 9,
          original_name: 'article.html',
          file_type: 'html',
          size: Buffer.byteLength(content),
          is_public: false,
          tags: [],
        }),
      )
      .mockImplementationOnce(() => json({ content }));

    const result = await service.ensurePrivateFile({
      baseUrl: 'https://jpage.example.test',
      token: 'secret-token',
      name: 'article.html',
      content,
      tags: [],
    });

    expect(result.id).toBe('9');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith('/upload-json')),
    ).toBe(false);
  });

  it('fails closed when the remote file is public or the hash changed', async () => {
    fetchMock
      .mockImplementationOnce(() =>
        json({
          id: 7,
          original_name: 'article.md',
          file_type: 'markdown',
          is_public: true,
          tags: [],
        }),
      )
      .mockImplementationOnce(() => json({ content: 'changed' }));

    await expect(
      service.verifyPrivateFile(
        { baseUrl: 'https://jpage.example.test', token: 'secret-token' },
        '7',
        'article.md',
        createHash('sha256').update('expected').digest('hex'),
      ),
    ).rejects.toThrow('回读不匹配');
  });

  it.each([
    'http://jpage.example.test',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://unlisted.example.test',
  ])('rejects unsafe JPage base URL %s', (baseUrl) => {
    expect(() => service.normalizeBaseUrl(baseUrl)).toThrow();
  });
});
