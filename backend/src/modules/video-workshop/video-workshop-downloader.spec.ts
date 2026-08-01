import {
  isAllowedVideoDownloadHostname,
  isBlockedVideoDownloadAddress,
  VideoWorkshopDownloader,
} from './video-workshop-downloader';

describe('VideoWorkshopDownloader security', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.4',
    '172.16.1.4',
    '192.168.1.4',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isBlockedVideoDownloadAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedVideoDownloadAddress(address)).toBe(false);
    },
  );

  it('matches exact and explicit wildcard hosts without suffix confusion', () => {
    const allowlist = ['media.example.com', '*.cdn.example.com'];
    expect(isAllowedVideoDownloadHostname('media.example.com', allowlist)).toBe(
      true,
    );
    expect(
      isAllowedVideoDownloadHostname('video.cdn.example.com', allowlist),
    ).toBe(true);
    expect(isAllowedVideoDownloadHostname('cdn.example.com', allowlist)).toBe(
      false,
    );
    expect(
      isAllowedVideoDownloadHostname('media.example.com.evil.test', allowlist),
    ).toBe(false);
  });

  it('rejects non-HTTPS URLs before any network request', async () => {
    const downloader = new VideoWorkshopDownloader();
    await expect(
      downloader.download(
        { url: 'http://v.douyin.com/video.mp4' },
        {
          taskId: 'download-test',
          signal: new AbortController().signal,
          onProgress: jest.fn(),
        },
      ),
    ).rejects.toMatchObject({
      reasonCode: 'invalid_input',
      message: '下载任务只允许 HTTPS 链接',
    });
  });
});
