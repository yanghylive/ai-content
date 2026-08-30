require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const Database = require('better-sqlite3');
const OpenAI = require('openai');
const path = require('path');

const app = express();

// CORS 白名单：从 CORS_ORIGINS 环境变量读取（逗号分隔）。
// 默认空 = 不允许任何跨域来源（仅同源 / 无 Origin 的请求可访问）。
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // 无 Origin 头：同源请求 / curl / 服务端调用，允许。
    // 有 Origin 头：必须在 CORS_ORIGINS 白名单内；白名单为空时拒绝一切跨域。
    if (!origin || (allowedOrigins.length > 0 && allowedOrigins.includes(origin))) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

const PORT = process.env.PORT || 3100;
// 显式绑定本机回环地址，防止暴露到局域网/公网；可用 HOST 环境变量覆盖。
const HOST = process.env.HOST || '127.0.0.1';
const DEDUP_TTL_HOURS = 72;

// 共享密钥鉴权：请求头 x-api-key 必须与环境变量 API_KEY 严格一致。
function apiKeyMatches(provided) {
  const expected = process.env.API_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ⚠️ 遗留状态（v1.1.103 复核标注）：以下 4 个业务接口（generate-reply /
// check-content / check-dedup / mark-sent）为老企业版架构遗留，生产未启用
// （API_KEY 未配置 → 恒 503）。桌面端无活跃调用方（Agent-S 客服走 local-engine，
// 浏览器走同源代理）。启用前必须先做产品决策 + 鉴权方案设计——API_KEY 共享
// 密钥不能下发桌面客户端（1.1.96 凭据红线），建议本地 3011 代理 + 服务端计费。
// 不要在未完成鉴权设计的情况下直接配置 API_KEY（会形成半开放计费接口）。
function requireAuth(req, res, next) {
  if (!process.env.API_KEY) {
    return res.status(503).json({ message: '服务端未配置 API_KEY，拒绝访问' });
  }
  const provided = req.headers['x-api-key'];
  if (typeof provided !== 'string' || !apiKeyMatches(provided)) {
    return res.status(401).json({ message: '未授权：x-api-key 缺失或无效' });
  }
  next();
}

const db = new Database(path.join(__dirname, 'cloud-api.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sent_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    target_hash TEXT NOT NULL,
    reply_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    platform TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_dedup ON sent_replies(account_id, target_hash, kind, created_at);
`);

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(Math.abs(hash));
}

function cleanOldRecords() {
  const cutoff = new Date(Date.now() - DEDUP_TTL_HOURS * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM sent_replies WHERE created_at < ?').run(cutoff);
}

setInterval(cleanOldRecords, 60 * 60 * 1000);

const aiClient = new OpenAI({
  apiKey: process.env.AI_API_KEY || '',
  baseURL: process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

const AI_MODEL = process.env.AI_MODEL || 'qwen-plus';

const FORBIDDEN_WORDS = [
  '加微信', '加我微信', '微信号', 'wx', '私聊', '转账',
  '红包', '赌博', '色情', '暴力', '政治',
];

const SYSTEM_PROMPT = `你是一个专业的电商客服回复助手。你的任务是根据客户的评论或私信，生成专业、友好、有价值的回复。

回复要求：
1. 语气亲切自然，像朋友一样交流
2. 回复要有针对性，直接回应客户的具体问题或需求
3. 适当使用表情符号增加亲和力，但不要过多
4. 回复长度适中，不要太长也不要太短（通常 20-80 字）
5. 不要包含任何联系方式（微信号、手机号等）
6. 不要包含任何引导转账、付款的内容
7. 如果客户的问题你无法回答，建议客户联系官方客服
8. 回复应该是可以直接发送的完整文本，不要包含任何前缀说明`;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-content-cloud-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ===== 客户端错误上报（匿名 + IP 限流，2026-08-29 补「后端启动崩溃」上报盲区）=====
// 背景：error-reports 自动上报的转发者是本地 3011 后端进程（它持 OSS 凭据）；
// 后端启动即崩时转发者自己死了，任何错误都不会落 OSS（8/29 同事 Win 机 3011 崩溃
// 在 OSS 上零记录）。桌面主进程把崩溃摘要直接 POST 到这里，由云端转发到
// OSS error-reports/<date>/<uuid>.json —— 凭据不下发客户端（1.1.96 安全加固红线）。
const REPORT_WINDOW_MS = 60_000;
const REPORT_MAX_PER_IP = 20; // 与后端 error-report 匿名端点同级限流
const reportBuckets = new Map();

// v1.1.102（复核整改）：取 X-Forwarded-For 的**最后一段**而非第一段。
// 反代链 nginx 用 $proxy_add_x_forwarded_for 把真实客户端 IP 追加在末尾，
// 客户端可自带伪造 XFF（在首段）绕过限流——取末段才能拿到不可伪造的真实 IP。
function reportClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

function reportRateLimited(ip) {
  const now = Date.now();
  const bucket = reportBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > REPORT_WINDOW_MS) {
    reportBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  if (reportBuckets.size > 5000) reportBuckets.clear();
  return bucket.count > REPORT_MAX_PER_IP;
}

// 零依赖 OSS V1 签名 PUT（等价 ali-oss put；不改 package.json，部署免重装依赖）
function ossPutJson(key, report) {
  return new Promise((resolve, reject) => {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
    if (!accessKeyId || !accessKeySecret) {
      return reject(new Error('OSS 凭据未配置（OSS_ACCESS_KEY_ID/SECRET）'));
    }
    const bucket = process.env.OSS_BUCKET || 'kaypal';
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
    const host = `${bucket}.${region}.aliyuncs.com`;
    const body = Buffer.from(JSON.stringify(report, null, 2));
    const date = new Date().toUTCString();
    const contentType = 'application/json';
    const stringToSign = `PUT\n\n${contentType}\n${date}\n/${bucket}/${key}`;
    const signature = crypto
      .createHmac('sha1', accessKeySecret)
      .update(stringToSign)
      .digest('base64');
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: `/${key}`,
        method: 'PUT',
        headers: {
          Host: host,
          Date: date,
          'Content-Type': contentType,
          Authorization: `OSS ${accessKeyId}:${signature}`,
          'Content-Length': body.length,
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
          reject(new Error(
            `OSS PUT ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`,
          ));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('OSS PUT timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 注意：必须注册在 `app.use('/api/v1', requireAuth)` 之前 —— 匿名端点，
// 客户端安装包不带任何凭据（1.1.96 安全加固），鉴权靠 IP 限流 + 字段截断。
app.post('/api/v1/client-error', async (req, res) => {
  try {
    if (reportRateLimited(reportClientIp(req))) {
      return res.status(204).end(); // 超限静默丢弃（与后端匿名端点行为一致）
    }
    const body = req.body || {};
    const kind = String(body.kind || 'client-error').slice(0, 100);
    const message = String(body.message || '客户端未知错误').slice(0, 2000);
    const detail = String(body.stderrTail || body.stack || '').slice(0, 8000);

    const report = {
      schema: 'error-report/v1',
      reportId: crypto.randomUUID(),
      app: 'ai-content-desktop',
      kind,
      version: String(body.version || 'unknown').slice(0, 50),
      requestId: 'client-crash-' + crypto.randomUUID(),
      method: 'BACKEND-PROCESS',
      url: 'backend://startup',
      status: 500,
      exitCode: Number.isFinite(body.exitCode) ? body.exitCode : null,
      message,
      stack: detail,
      launchLog: String(body.launchLog || '').slice(0, 4000),
      system: {
        platform: String(body.platform || '').slice(0, 50),
        arch: String(body.arch || '').slice(0, 50),
        electron: String(body.electron || '').slice(0, 50),
        node: String(body.node || '').slice(0, 50),
        userData: String(body.dataPath || '').slice(0, 500),
      },
      occurredAt: new Date().toISOString(),
    };

    const ymd = new Date().toISOString().slice(0, 10);
    const key = `error-reports/${ymd}/${report.reportId}.json`;
    await ossPutJson(key, report);
    console.log(`[client-error] 已转发 OSS: ${key} (${kind} v${report.version})`);
    res.status(204).end();
  } catch (error) {
    console.error('[client-error] 转发失败:', error.message);
    res.status(204).end(); // 上报通道失败静默，不让客户端重试风暴
  }
});

app.use('/api/v1', requireAuth);

app.post('/api/v1/generate-reply', async (req, res) => {
  try {
    const { platform, scene, customerMessage, recentContext = [], businessProfile = '' } = req.body;

    if (!customerMessage || !customerMessage.trim()) {
      return res.json({
        reply: '',
        shouldSend: false,
        confidence: 0,
        reason: '客户消息为空',
      });
    }

    if (!process.env.AI_API_KEY) {
      return res.json({
        reply: '感谢您的关注！如有问题请联系官方客服。',
        shouldSend: true,
        confidence: 0.5,
        reason: 'AI 服务未配置，使用默认回复',
      });
    }

    const sceneDesc = {
      comment: '视频/图文评论',
      direct_message: '私信',
      wechat_session: '微信会话',
      group: '群聊',
    }[scene] || '消息';

    let userPrompt = `平台：${platform || '未知'}\n场景：${sceneDesc}\n\n客户消息：${customerMessage}`;

    if (recentContext.length > 0) {
      userPrompt += `\n\n最近对话上下文：\n${recentContext.join('\n')}`;
    }

    if (businessProfile) {
      userPrompt += `\n\n商家简介：${businessProfile}`;
    }

    userPrompt += '\n\n请生成一条合适的回复：';

    const completion = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || '';

    if (!reply) {
      return res.json({
        reply: '',
        shouldSend: false,
        confidence: 0,
        reason: 'AI 未生成回复',
      });
    }

    const hasForbidden = FORBIDDEN_WORDS.some(word => reply.includes(word));
    const tooLong = reply.length > 200;
    const tooShort = reply.length < 5;

    const shouldSend = !hasForbidden && !tooLong && !tooShort;
    const confidence = shouldSend ? 0.85 : 0.3;

    let reason = '';
    if (hasForbidden) reason = '包含敏感词';
    else if (tooLong) reason = '回复过长';
    else if (tooShort) reason = '回复过短';

    res.json({ reply, shouldSend, confidence, reason });
  } catch (error) {
    console.error('[generate-reply] Error:', error.message);
    res.status(500).json({ message: '生成回复失败: ' + error.message });
  }
});

app.post('/api/v1/check-content', (req, res) => {
  try {
    const { replyText, platform } = req.body;

    if (!replyText || !replyText.trim()) {
      return res.json({ canSend: false, blockedReason: '回复内容为空' });
    }

    if (replyText.length > 500) {
      return res.json({ canSend: false, blockedReason: '回复内容过长（超过500字）' });
    }

    if (replyText.length < 2) {
      return res.json({ canSend: false, blockedReason: '回复内容过短' });
    }

    for (const word of FORBIDDEN_WORDS) {
      if (replyText.includes(word)) {
        return res.json({ canSend: false, blockedReason: `包含敏感词: ${word}` });
      }
    }

    const urlPattern = /https?:\/\/[^\s]+/;
    if (urlPattern.test(replyText)) {
      return res.json({ canSend: false, blockedReason: '包含外部链接' });
    }

    res.json({ canSend: true });
  } catch (error) {
    console.error('[check-content] Error:', error.message);
    res.status(500).json({ message: '内容检查失败: ' + error.message });
  }
});

app.post('/api/v1/check-dedup', (req, res) => {
  try {
    const { accountId, targetText, kind } = req.body;

    if (!accountId || !targetText || !kind) {
      return res.json({ isDuplicate: false });
    }

    const targetHash = hashText(targetText);
    const cutoff = new Date(Date.now() - DEDUP_TTL_HOURS * 60 * 60 * 1000).toISOString();

    const existing = db.prepare(
      'SELECT id FROM sent_replies WHERE account_id = ? AND target_hash = ? AND kind = ? AND created_at > ? LIMIT 1'
    ).get(accountId, targetHash, kind, cutoff);

    res.json({ isDuplicate: !!existing });
  } catch (error) {
    console.error('[check-dedup] Error:', error.message);
    res.status(500).json({ message: '去重检查失败: ' + error.message });
  }
});

app.post('/api/v1/mark-sent', (req, res) => {
  try {
    const { accountId, targetText, replyText, kind } = req.body;

    if (!accountId || !targetText || !replyText || !kind) {
      return res.json({ ok: false });
    }

    const targetHash = hashText(targetText);
    const replyHash = hashText(replyText);
    const platform = req.body.platform || null;

    db.prepare(
      'INSERT INTO sent_replies (account_id, target_hash, reply_hash, kind, platform) VALUES (?, ?, ?, ?, ?)'
    ).run(accountId, targetHash, replyHash, kind, platform);

    res.json({ ok: true });
  } catch (error) {
    console.error('[mark-sent] Error:', error.message);
    res.status(500).json({ message: '标记发送失败: ' + error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ message: '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`[Cloud API] Server running on ${HOST}:${PORT}`);
  console.log(`[Cloud API] AI Model: ${AI_MODEL}`);
  console.log(`[Cloud API] AI Base URL: ${process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}`);
  console.log(`[Cloud API] AI API Key: ${process.env.AI_API_KEY ? '***configured***' : 'NOT SET (will use fallback replies)'}`);
  console.log(`[Cloud API] API Key Auth: ${process.env.API_KEY ? '***enabled***' : 'NOT CONFIGURED (rejecting /api/v1 requests)'}`);
  console.log(`[Cloud API] CORS Origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'same-origin only'}`);
});
