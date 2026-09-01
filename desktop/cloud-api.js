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
    // 2026-08-29 修复：endpoint 带路径前缀时（如 https://kaypal.cn/cloud-api），
    // new URL('/api/v1/x', base) 会丢掉前缀导致请求打到错误服务（401/404）。
    // 这里改为保留 base 路径前缀的拼接。
    let url;
    try {
      const base = new URL(this.endpoint);
      if (base.pathname && base.pathname !== '/') {
        url = new URL(base.pathname.replace(/\/+$/, '') + path, base.origin);
      } else {
        url = new URL(path, base.origin);
      }
    } catch (err) {
      url = new URL(path, this.endpoint);
    }
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
          // v1.1.102（复核整改）：204/205 等「无 body 的 2xx」不能走 JSON.parse——
          // 空 body 解析抛错会把成功的上报误判为失败（生产 client-error 返回 204）。
          if ((res.statusCode === 204 || res.statusCode === 205) && !data.trim()) {
            return settle(resolve, {});
          }
          try {
            const json = data.trim() ? JSON.parse(data) : {};

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

  // v1.1.108（复核 P2-8 / 大王决策）：Cloud API 遗留登录/用量/订阅接口移除——
  // /api/v1/auth/login、auth/me、usage/stats、subscription 线上 503（服务端未配置
  // API_KEY），且主登录链路已走 3011 本地后端（authApi），这些方法无任何调用方
  // （main.js/preload/前端均不调）。标注遗留禁用；错误上报 reportClientError 保留。
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
