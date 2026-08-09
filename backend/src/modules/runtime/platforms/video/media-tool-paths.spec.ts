import { resolveMediaToolPath } from './media-tool-paths';

describe('resolveMediaToolPath', () => {
  const originalFfmpeg = process.env.KAYPAL_FFMPEG_PATH;
  const originalFfprobe = process.env.KAYPAL_FFPROBE_PATH;
  const originalRequired = process.env.KAYPAL_BUNDLED_MEDIA_TOOLS_REQUIRED;

  afterEach(() => {
    if (originalFfmpeg === undefined) delete process.env.KAYPAL_FFMPEG_PATH;
    else process.env.KAYPAL_FFMPEG_PATH = originalFfmpeg;
    if (originalFfprobe === undefined) delete process.env.KAYPAL_FFPROBE_PATH;
    else process.env.KAYPAL_FFPROBE_PATH = originalFfprobe;
    if (originalRequired === undefined) {
      delete process.env.KAYPAL_BUNDLED_MEDIA_TOOLS_REQUIRED;
    } else {
      process.env.KAYPAL_BUNDLED_MEDIA_TOOLS_REQUIRED = originalRequired;
    }
  });

  it('uses desktop-injected absolute paths before every fallback', () => {
    process.env.KAYPAL_FFMPEG_PATH = '/package/media-tools/bin/ffmpeg';
    process.env.KAYPAL_FFPROBE_PATH = '/package/media-tools/bin/ffprobe';

    expect(resolveMediaToolPath('ffmpeg')).toBe(
      '/package/media-tools/bin/ffmpeg',
    );
    expect(resolveMediaToolPath('ffprobe')).toBe(
      '/package/media-tools/bin/ffprobe',
    );
  });

  it('does not fall back to the system PATH when bundled tools are required', () => {
    delete process.env.KAYPAL_FFMPEG_PATH;
    process.env.KAYPAL_BUNDLED_MEDIA_TOOLS_REQUIRED = '1';

    expect(() => resolveMediaToolPath('ffmpeg')).toThrow(
      'KAYPAL_FFMPEG_PATH is required',
    );
  });
});
