const https = require('https');
const http = require('http');

class CloudAPI {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'https://kaypal.cn/cloud-api';
    this.token = options.token || '';
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.appVersion = options.appVersion || '1.0.0';
  }

  // 设置 API token
  setToken(token) {
    this.token = token;
  }

  // 设置 API endpoint
  setEndpoint(endpoint) {
    this.endpoint = endpoint;
  }

  // 通用请求方法
  async request(path, options = {}) {
    const url = new URL(path, this.endpoint);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': `AIContentDesktop/${this.appVersion || '1.0.0'}`,
      ...options.headers
    };

    // 添加认证 token
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // 准备请求体
    let bodyStr = null;
    if (options.body) {
      bodyStr = JSON.stringify(options.body);
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers,
      timeout: this.timeout
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };

      const req = client.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              settle(resolve, json);
            } else {
              const error = new Error(json.message || `HTTP ${res.statusCode}`);
              error.statusCode = res.statusCode;
              error.response = json;
              settle(reject, error);
            }
          } catch (err) {
            const error = new Error(`Failed to parse response: ${err.message}`);
            error.responseBody = data.slice(0, 500);
            error.statusCode = res.statusCode;
            settle(reject, error);
          }
        });
      });

      req.on('error', (err) => {
        settle(reject, new Error(`Request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        settle(reject, new Error('Request timeout'));
      });

      // 发送请求体
      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    });
  }

  // 带重试的请求
  async requestWithRetry(path, options = {}, retries = 0) {
    try {
      return await this.request(path, options);
    } catch (error) {
      // 不重试客户端错误，但 429 (Too Many Requests) 和 408 (Request Timeout) 除外
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500
          && error.statusCode !== 429 && error.statusCode !== 408) {
        throw error;
      }

      if (retries < this.maxRetries) {
        const delay = error.statusCode === 429
          ? this.retryDelay * Math.pow(2, retries + 1) // 429 用指数退避
          : this.retryDelay * (retries + 1);
        console.log(`[CloudAPI] Retrying request (${retries + 1}/${this.maxRetries}) in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.requestWithRetry(path, options, retries + 1);
      }

      throw error;
    }
  }

  // AI 生成回复
  async generateReply(data) {
    const { platform, scene, customerMessage, recentContext, businessProfile } = data;

    return await this.requestWithRetry('/api/v1/generate-reply', {
      method: 'POST',
      body: {
        platform,
        scene,
        customerMessage,
        recentContext: recentContext || [],
        businessProfile: businessProfile || ''
      }
    });
  }

  // 检查内容是否可发送
  async checkContent(data) {
    const { replyText, platform } = data;

    return await this.requestWithRetry('/api/v1/check-content', {
      method: 'POST',
      body: {
        replyText,
        platform
      }
    });
  }

  // 检查是否重复
  async checkDedup(data) {
    const { accountId, targetText, kind } = data;

    return await this.requestWithRetry('/api/v1/check-dedup', {
      method: 'POST',
      body: {
        accountId,
        targetText,
        kind
      }
    });
  }

  // 标记已发送
  async markSent(data) {
    const { accountId, targetText, replyText, kind } = data;

    return await this.requestWithRetry('/api/v1/mark-sent', {
      method: 'POST',
      body: {
        accountId,
        targetText,
        replyText,
        kind
      }
    });
  }

  // 用户登录
  async login(username, password) {
    const response = await this.request('/api/v1/auth/login', {
      method: 'POST',
      body: { username, password }
    });

    if (response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  // 用户注册
  async register(username, password, email) {
    return await this.request('/api/v1/auth/register', {
      method: 'POST',
      body: { username, password, email }
    });
  }

  // 获取用户信息
  async getUserInfo() {
    return await this.requestWithRetry('/api/v1/auth/me', {
      method: 'GET'
    });
  }

  // 获取使用统计
  async getUsageStats() {
    return await this.requestWithRetry('/api/v1/usage/stats', {
      method: 'GET'
    });
  }

  // 获取订阅信息
  async getSubscription() {
    return await this.requestWithRetry('/api/v1/subscription', {
      method: 'GET'
    });
  }

  // 客户端兜底错误上报（fire-and-forget，失败静默——上报绝不能影响主流程）。
  // 2026-08-29 补盲区：后端启动崩溃时本地 3011 转发者已死，error-reports 零上报，
  // 由主进程把崩溃摘要直接 POST 到云端 /api/v1/client-error 转发落 OSS。
  async reportClientError(data) {
    try {
      await this.request('/api/v1/client-error', {
        method: 'POST',
        body: data
      });
      return true;
    } catch (err) {
      console.warn('[CloudAPI] client-error 上报失败(静默):', err && err.message);
      return false;
    }
  }
}

module.exports = CloudAPI;
