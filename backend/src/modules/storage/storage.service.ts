/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import * as qiniu from 'qiniu';
import OSS from 'ali-oss';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';

type StorageProvider = 'local' | 'qiniu' | 'aliyun-oss';

export type StorageConfig = {
  provider: StorageProvider;
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  endpoint?: string;
  region?: string;
};

type RiskGateOptions = {
  riskConfirmation?: BackendRiskConfirmationInput;
  riskContext?: BackendRiskContext;
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(
    typeof reason === 'string' ? reason : '图片存储已取消',
  );
  error.name = 'AbortError';
  throw error;
}

function rethrowAbort(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) throwIfAborted(signal);
  if (
    error &&
    typeof error === 'object' &&
    ['AbortError', 'APIUserAbortError'].includes(
      String((error as { name?: unknown }).name || ''),
    )
  ) {
    throw error;
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<StorageConfig | null> {
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            'storage_provider',
            'storage_access_key',
            'storage_secret_key',
            'storage_bucket',
            'storage_domain',
            'storage_endpoint',
            'storage_region',
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

    const provider = (map['storage_provider'] || '').trim() as StorageProvider;
    if (provider === 'local') {
      return {
        provider: 'local',
        accessKey: '',
        secretKey: '',
        bucket: '',
        domain: '',
        endpoint: '',
        region: '',
      };
    }
    if (provider) {
      if (
        !map['storage_access_key'] ||
        !map['storage_secret_key'] ||
        !map['storage_bucket'] ||
        !map['storage_domain']
      ) {
        return null;
      }

      const config: StorageConfig = {
        provider,
        accessKey: map['storage_access_key'],
        secretKey: map['storage_secret_key'],
        bucket: map['storage_bucket'],
        domain: map['storage_domain'],
        endpoint: map['storage_endpoint'] || '',
        region: map['storage_region'] || '',
      };

      if (provider === 'aliyun-oss' && (!config.endpoint || !config.region)) {
        return null;
      }

      return config;
    }

    if (
      !map['qiniu_access_key'] ||
      !map['qiniu_secret_key'] ||
      !map['qiniu_bucket'] ||
      !map['qiniu_domain']
    ) {
      return null;
    }

    return {
      provider: 'qiniu',
      accessKey: map['qiniu_access_key'],
      secretKey: map['qiniu_secret_key'],
      bucket: map['qiniu_bucket'],
      domain: map['qiniu_domain'],
      endpoint: '',
      region: '',
    };
  }

  async saveConfig(data: StorageConfig): Promise<void> {
    const entries: { key: string; value: string }[] = [
      { key: 'storage_provider', value: data.provider },
    ];

    if (data.provider !== 'local') {
      entries.push(
        { key: 'storage_access_key', value: data.accessKey },
        { key: 'storage_secret_key', value: data.secretKey },
        { key: 'storage_bucket', value: data.bucket },
        { key: 'storage_domain', value: data.domain },
        {
          key: 'storage_endpoint',
          value: data.provider === 'aliyun-oss' ? data.endpoint || '' : '',
        },
        {
          key: 'storage_region',
          value: data.provider === 'aliyun-oss' ? data.region || '' : '',
        },
      );
    }

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

  async uploadFromUrl(
    externalUrl: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    const config = await this.getConfig();
    if (!config) {
      this.logger.warn('对象存储配置未完成，跳过上传，将使用临时链接');
      return null;
    }

    try {
      const response = await fetch(externalUrl, { signal });
      if (!response.ok) {
        throw new Error(`下载外部图片失败，HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('gif')
            ? 'gif'
            : 'jpg';

      return await this.uploadBuffer(buffer, ext, 'ai-images', signal);
    } catch (error) {
      rethrowAbort(error, signal);
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`对象存储上传失败: ${message}`);
      return null;
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    ext = 'png',
    folder = 'ai-images',
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    const config = await this.getConfig();
    if (!config) {
      this.logger.warn('对象存储配置未完成，无法上传二进制图片');
      return null;
    }

    if (config.provider === 'local') {
      this.logger.log('本地存储已启用，跳过云端上传');
      return null;
    }

    try {
      return config.provider === 'aliyun-oss'
        ? await this.uploadBufferToAliyunOss(
            config,
            buffer,
            ext,
            folder,
            signal,
          )
        : await this.uploadBufferToQiniu(config, buffer, ext, folder, signal);
    } catch (error) {
      rethrowAbort(error, signal);
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`对象存储二进制上传失败: ${message}`);
      return null;
    }
  }

  async testConnection(options: RiskGateOptions = {}): Promise<{
    success: boolean;
    message: string;
    riskAudit: BackendRiskAuditEvent;
  }> {
    const riskAudit = assertBackendRiskGate({
      action: 'storage-remote-test',
      target: 'storage:configured-provider',
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.riskConfirmation,
      context: options.riskContext,
      reason: '测试对象存储连接会使用云厂商密钥执行远程上传和删除探测。',
    });
    const config = await this.getConfig();
    if (!config) {
      return {
        success: false,
        message: '对象存储配置不完整，请填写所有参数后保存',
        riskAudit,
      };
    }

    if (config.provider === 'local') {
      return {
        success: true,
        message: '本地存储已启用，无需测试连接',
        riskAudit,
      };
    }

    try {
      const pixel = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
          '0a49444154789c6260000000020001e221bc330000000049454e44ae426082',
        'hex',
      );
      const testKey = `__test__/${Date.now()}.png`;

      if (config.provider === 'aliyun-oss') {
        const client = this.createAliyunOssClient(config);
        await client.put(testKey, pixel, {
          headers: { 'Content-Type': 'image/png' },
        });
        try {
          await client.delete(testKey);
        } catch {
          // 删除失败不影响测试结果
        }
        return {
          success: true,
          message: '阿里 OSS 连接测试成功！配置有效。',
          riskAudit,
        };
      }

      const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
      const putPolicy = new qiniu.rs.PutPolicy({
        scope: config.bucket,
        expires: 60,
      });
      const uploadToken = putPolicy.uploadToken(mac);
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

      return {
        success: true,
        message: '七牛云连接测试成功！配置有效。',
        riskAudit,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return { success: false, message: `连接测试失败: ${message}`, riskAudit };
    }
  }

  private async uploadBufferToQiniu(
    config: StorageConfig,
    buffer: Buffer,
    ext: string,
    folder: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
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
      let settled = false;
      const onAbort = () => {
        settled = true;
        reject(signal?.reason || new Error('图片存储已取消'));
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      formUploader.put(
        uploadToken,
        fileName,
        buffer,
        putExtra,
        (err, body, info) => {
          if (settled) return;
          cleanup();
          if (err) return reject(err);
          if (info.statusCode !== 200)
            return reject(new Error(`七牛云上传失败: ${JSON.stringify(body)}`));
          resolve();
        },
      );
    });

    const domain = config.domain.replace(/\/$/, '');
    const cdnUrl = `${domain}/${fileName}`;
    this.logger.log(`图片已上传到七牛云: ${cdnUrl}`);
    return cdnUrl;
  }

  private async uploadBufferToAliyunOss(
    config: StorageConfig,
    buffer: Buffer,
    ext: string,
    folder: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    const client = this.createAliyunOssClient(config);
    const safeExt = ext.replace(/^\./, '') || 'png';
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${safeExt}`;

    await client.put(fileName, buffer, {
      headers: { 'Content-Type': this.getContentTypeByExt(safeExt) },
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal);

    const domain = config.domain.replace(/\/$/, '');
    const cdnUrl = `${domain}/${fileName}`;
    this.logger.log(`图片已上传到阿里 OSS: ${cdnUrl}`);
    return cdnUrl;
  }

  private createAliyunOssClient(config: StorageConfig): any {
    return new OSS({
      accessKeyId: config.accessKey,
      accessKeySecret: config.secretKey,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
    });
  }

  private getContentTypeByExt(ext: string): string {
    const normalized = ext.toLowerCase();
    if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
    if (normalized === 'webp') return 'image/webp';
    if (normalized === 'gif') return 'image/gif';
    return 'image/png';
  }
}
