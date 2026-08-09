import { RemoteImagePreprocessor } from './remote-image-preprocessor';

describe('RemoteImagePreprocessor', () => {
  let preprocessor: RemoteImagePreprocessor;

  beforeEach(() => {
    preprocessor = new RemoteImagePreprocessor();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns body unchanged when no img tags present', async () => {
    const body = '<p>没有图片的文章</p>';
    const result = await preprocessor.preprocessBody(body);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.body).toBe(body);
  });

  it('returns body unchanged when images are already data URLs', async () => {
    const body = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    const result = await preprocessor.preprocessBody(body);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('skips payloads without body or non-article content', async () => {
    const payloads = [
      { contentKind: 'video' as const, title: '视频', body: undefined },
      { contentKind: 'article' as const, title: '文章', body: '' },
    ] as never;

    const result = await preprocessor.preprocessPayloads(payloads);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('counts failed downloads without crashing', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const body = '<img src="https://nonexistent.example.invalid/image.jpg">';
    const result = await preprocessor.preprocessBody(body);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.body).toContain(
      'https://nonexistent.example.invalid/image.jpg',
    );
    expect(clearTimeoutSpy).toHaveBeenCalledWith(
      timeoutSpy.mock.results[0].value,
    );
  });

  it('clears the timeout when temp-file download fetch fails', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      preprocessor.downloadToTempFile('https://example.com/image.jpg'),
    ).resolves.toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(
      timeoutSpy.mock.results[0].value,
    );
  });
});
