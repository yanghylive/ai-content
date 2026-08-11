import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GenerateReplyInput {
  platform: string;
  scene: 'comment' | 'direct_message' | 'wechat_session' | 'group';
  customerMessage: string;
  recentContext?: string[];
  businessProfile?: string;
}

export interface GenerateReplyOutput {
  reply: string;
  shouldSend: boolean;
  confidence: number;
  reason?: string;
}

export interface CheckContentInput {
  replyText: string;
  platform: string;
}

export interface CheckContentOutput {
  canSend: boolean;
  blockedReason?: string;
}

export interface CheckDedupInput {
  accountId: string;
  targetText: string;
  kind: 'comment' | 'message';
}

export interface CheckDedupOutput {
  isDuplicate: boolean;
}

export interface MarkSentInput {
  accountId: string;
  targetText: string;
  replyText: string;
  kind: 'comment' | 'message';
}

export interface MarkSentOutput {
  ok: boolean;
}

@Injectable()
export class CloudApiService {
  private readonly logger = new Logger(CloudApiService.name);
  private readonly endpoint: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('CLOUD_API_ENDPOINT') ||
      'https://kaypal.cn/cloud-api';
    this.timeout = this.configService.get<number>('CLOUD_API_TIMEOUT') || 30000;
    this.maxRetries =
      this.configService.get<number>('CLOUD_API_MAX_RETRIES') || 3;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    retries = 0,
  ): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AIContentBackend/1.0.0',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ message: response.statusText }))) as {
          message?: string;
        };
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      // 不重试客户端错误
      const errorMessage =
        (error as { message?: string } | null)?.message ?? String(error);
      if (errorMessage.includes('HTTP 4')) {
        throw error;
      }

      // 重试服务器错误
      if (retries < this.maxRetries) {
        this.logger.warn(
          `Cloud API request failed, retrying (${retries + 1}/${this.maxRetries}): ${errorMessage}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (retries + 1)),
        );
        return this.request(path, options, retries + 1);
      }

      throw error;
    }
  }

  /**
   * AI 生成回复
   */
  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutput> {
    this.logger.debug(`Generating reply for ${input.platform} ${input.scene}`);

    return this.request<GenerateReplyOutput>('/api/v1/generate-reply', {
      method: 'POST',
      body: JSON.stringify({
        platform: input.platform,
        scene: input.scene,
        customerMessage: input.customerMessage,
        recentContext: input.recentContext || [],
        businessProfile: input.businessProfile || '',
      }),
    });
  }

  /**
   * 检查内容是否可发送
   */
  async checkContent(input: CheckContentInput): Promise<CheckContentOutput> {
    this.logger.debug(`Checking content for ${input.platform}`);

    return this.request<CheckContentOutput>('/api/v1/check-content', {
      method: 'POST',
      body: JSON.stringify({
        replyText: input.replyText,
        platform: input.platform,
      }),
    });
  }

  /**
   * 检查是否重复
   */
  async checkDedup(input: CheckDedupInput): Promise<CheckDedupOutput> {
    this.logger.debug(`Checking dedup for ${input.accountId} ${input.kind}`);

    return this.request<CheckDedupOutput>('/api/v1/check-dedup', {
      method: 'POST',
      body: JSON.stringify({
        accountId: input.accountId,
        targetText: input.targetText,
        kind: input.kind,
      }),
    });
  }

  /**
   * 标记已发送
   */
  async markSent(input: MarkSentInput): Promise<MarkSentOutput> {
    this.logger.debug(`Marking sent for ${input.accountId} ${input.kind}`);

    return this.request<MarkSentOutput>('/api/v1/mark-sent', {
      method: 'POST',
      body: JSON.stringify({
        accountId: input.accountId,
        targetText: input.targetText,
        replyText: input.replyText,
        kind: input.kind,
      }),
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/health', { method: 'GET' });
      return true;
    } catch (error) {
      this.logger.error(
        `Cloud API health check failed: ${(error as { message?: string } | null)?.message ?? String(error)}`,
      );
      return false;
    }
  }
}
