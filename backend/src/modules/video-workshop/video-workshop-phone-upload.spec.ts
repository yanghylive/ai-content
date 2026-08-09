import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoWorkshopPhoneUploadService } from './video-workshop-phone-upload';

describe('VideoWorkshopPhoneUploadService', () => {
  it('keeps a token pending until bytes arrive, then imports a single-use upload', async () => {
    const cwd = process.cwd();
    const previousHost = process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_HOST;
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-phone-'));
    process.chdir(projectDir);
    process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_HOST = '127.0.0.1';
    const service = new VideoWorkshopPhoneUploadService();
    try {
      const created = await service.createSession(1024 * 1024);

      expect(created).toMatchObject({
        status: 'pending',
        progress: 0,
        bytesReceived: 0,
        reachableFromPhone: false,
      });
      expect(created.uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/upload\//);
      expect(created.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);

      const page = await fetch(created.uploadUrl!);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('上传手机素材');

      const mp4Header = Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x00, 0x00,
      ]);
      const uploaded = await fetch(created.uploadUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'video/mp4',
          'X-File-Name': encodeURIComponent('phone-product.mp4'),
        },
        body: mp4Header,
      });

      expect(uploaded.status).toBe(201);
      const completed = await service.getSession(created.id);
      expect(completed).toMatchObject({
        status: 'succeeded',
        progress: 100,
        bytesReceived: mp4Header.length,
        material: {
          name: 'phone-product.mp4',
          kind: 'video',
          sizeBytes: mp4Header.length,
        },
      });
      expect(existsSync(completed.material!.path)).toBe(true);

      const reused = await fetch(created.uploadUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'video/mp4',
          'X-File-Name': encodeURIComponent('second.mp4'),
        },
        body: mp4Header,
      });
      expect(reused.status).toBe(409);
    } finally {
      await service.onModuleDestroy();
      process.chdir(cwd);
      if (previousHost === undefined) {
        delete process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_HOST;
      } else {
        process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_HOST = previousHost;
      }
    }
  });
});
