require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3100;
const DEDUP_TTL_HOURS = 72;

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

app.listen(PORT, () => {
  console.log(`[Cloud API] Server running on port ${PORT}`);
  console.log(`[Cloud API] AI Model: ${AI_MODEL}`);
  console.log(`[Cloud API] AI Base URL: ${process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}`);
  console.log(`[Cloud API] AI API Key: ${process.env.AI_API_KEY ? '***configured***' : 'NOT SET (will use fallback replies)'}`);
});
