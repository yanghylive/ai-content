import { RemoteImagePreprocessor } from './remote-image-preprocessor';

describe('RemoteImagePreprocessor', () => {
  let preprocessor: RemoteImagePreprocessor;

  beforeEach(() => {
    preprocessor = new RemoteImagePreprocessor();
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
    const body = '<img src="https://nonexistent.example.invalid/image.jpg">';
    const result = await preprocessor.preprocessBody(body);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    // body should still contain the original URL
    expect(result.body).toContain('https://nonexistent.example.invalid/image.jpg');
  });
});
