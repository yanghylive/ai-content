import { Injectable, Logger } from '@nestjs/common';
import * as qiniu from 'qiniu';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QiniuService {
  private readonly logger = new Logger(QiniuService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 从数据库读取七牛云配置
   */
  async getConfig(): Promise<{
    accessKey: string;
    secretKey: string;
    bucket: string;
    domain: string;
  } | null> {
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            'qiniu_access_key',
            'qiniu_secret_key',
            'qiniu_bucket',
            'qiniu_domain',
          ],
        },
      },
    });

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    // 四个字段必须都有才算配置完整
    if (
      !map['qiniu_access_key'] ||
      !map['qiniu_secret_key'] ||
      !map['qiniu_bucket'] ||
      !map['qiniu_domain']
    ) {
      return null;
    }

    return {
      accessKey: map['qiniu_access_key'],
      secretKey: map['qiniu_secret_key'],
      bucket: map['qiniu_bucket'],
      domain: map['qiniu_domain'],
    };
  }

  /**
   * 保存七牛云配置到数据库
   */
  async saveConfig(data: {
    accessKey: string;
    secretKey: string;
    bucket: string;
    domain: string;
  }): Promise<void> {
    const entries = [
      { key: 'qiniu_access_key', value: data.accessKey },
      { key: 'qiniu_secret_key', value: data.secretKey },
      { key: 'qiniu_bucket', value: data.bucket },
      { key: 'qiniu_domain', value: data.domain },
    ];

    // 使用 upsert 逐条保存
    await Promise.all(
      entries.map(({ key, value }) =>
        this.prisma.systemConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );
  }

  /**
   * 从远程 URL 下载图片并上传到七牛云，返回 CDN 永久 URL
   * 若配置不存在或上传失败，返回 null
   */
  async uploadFromUrl(externalUrl: string): Promise<string | null> {
    const config = await this.getConfig();
    if (!config) {
      this.logger.warn('七牛云配置未完成，跳过上传，将使用临时链接');
      return null;
    }

    try {
      // 生成上传凭证
      // 从外部 URL 下载图片内容
      const response = await fetch(externalUrl);
      if (!response.ok) {
        throw new Error(`下载外部图片失败，HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // 根据 Content-Type 推断扩展名
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('gif')
            ? 'gif'
            : 'jpg';

      return await this.uploadBuffer(buffer, ext, 'ai-images');
    } catch (error) {
      this.logger.error(`七牛云上传失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 将二进制图片直接上传到七牛云，适配 b64_json 这类非 URL 返回值
   */
  async uploadBuffer(
    buffer: Buffer,
    ext = 'png',
    folder = 'ai-images',
  ): Promise<string | null> {
    const config = await this.getConfig();
    if (!config) {
      this.logger.warn('七牛云配置未完成，无法上传二进制图片');
      return null;
    }

    try {
      const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
      const putPolicy = new qiniu.rs.PutPolicy({
        scope: config.bucket,
        expires: 3600,
      });
      const uploadToken = putPolicy.uploadToken(mac);

      const safeExt = ext.replace(/^\./, '') || 'png';
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${safeExt}`;
      const formUploader = new qiniu.form_up.FormUploader(
        new qiniu.conf.Config(),
      );
      const putExtra = new qiniu.form_up.PutExtra();

      await new Promise<void>((resolve, reject) => {
        formUploader.put(
          uploadToken,
          fileName,
          buffer,
          putExtra,
          (err, body, info) => {
            if (err) return reject(err);
            if (info.statusCode !== 200)
              return reject(
                new Error(`七牛云上传失败: ${JSON.stringify(body)}`),
              );
            resolve();
          },
        );
      });

      const domain = config.domain.replace(/\/$/, '');
      const cdnUrl = `${domain}/${fileName}`;
      this.logger.log(`图片已上传到七牛云: ${cdnUrl}`);
      return cdnUrl;
    } catch (error) {
      this.logger.error(`七牛云二进制上传失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 测试七牛云连接（上传 1 像素 PNG 并删除）
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const config = await this.getConfig();
    if (!config) {
      return {
        success: false,
        message: '七牛云配置不完整，请填写所有参数后保存',
      };
    }

    try {
      const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
      const putPolicy = new qiniu.rs.PutPolicy({
        scope: config.bucket,
        expires: 60,
      });
      const uploadToken = putPolicy.uploadToken(mac);

      // 1x1 透明 PNG（最小合法 PNG 文件）
      const pixel = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
          '0a49444154789c6260000000020001e221bc330000000049454e44ae426082',
        'hex',
      );
      const testKey = `__test__/${Date.now()}.png`;

      const formUploader = new qiniu.form_up.FormUploader(
        new qiniu.conf.Config(),
      );
      const putExtra = new qiniu.form_up.PutExtra();

      await new Promise<void>((resolve, reject) => {
        formUploader.put(
          uploadToken,
          testKey,
          pixel,
          putExtra,
          (err, body, info) => {
            if (err) return reject(err);
            if (info.statusCode !== 200)
              return reject(new Error(`上传测试失败: ${JSON.stringify(body)}`));
            resolve();
          },
        );
      });

      // 删除测试文件
      try {
        const bucketManager = new qiniu.rs.BucketManager(
          mac,
          new qiniu.conf.Config(),
        );
        await new Promise<void>((resolve) => {
          bucketManager.delete(config.bucket, testKey, () => resolve());
        });
      } catch {
        // 删除失败不影响测试结果
      }

      return { success: true, message: '七牛云连接测试成功！配置有效。' };
    } catch (error) {
      return { success: false, message: `连接测试失败: ${error.message}` };
    }
  }
}
