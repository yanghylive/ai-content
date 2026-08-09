#!/usr/bin/env node
/**
 * kaypal.cn 语音网关连通性自检。
 *
 * 检查本地对接 kaypal.cn 云端 AI 网关（阿里百炼已接入）的配置是否可用：
 *  1. 网关地址（KAYPAL_AI_PROXY_BASE_URL，默认 {KAYPAL_AUTH_BASE_URL}/api/ai）
 *  2. 服务商 Key（KAYPAL_AI_PROXY_API_KEY / KAYPAL_API_KEY）
 *  3. GET /v1/models 连通性与鉴权
 *  4. 模型列表中是否含语音相关模型（paraformer/audio/tts/cosyvoice/qwen-audio…）
 *  5. 探测 /v1/audio/speech 端点存在性（POST 空体，用响应码区分端点不存在）
 *
 * 用法：node scripts/verify-kaypal-voice-gateway.mjs [--json]
 * 退出码：0=全部通过  1=配置缺失/鉴权失败  2=网关不可达  3=语音模型未检测到（警告级）
 */
import process from 'node:process';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

const env = (key) => (process.env[key] || '').trim();

const authBase = env('KAYPAL_AUTH_BASE_URL') || 'https://test.kaypal.cn';
const gatewayBase = (
  env('KAYPAL_AI_PROXY_BASE_URL') || `${authBase}/api/ai`
).replace(/\/+$/, '');
const serverKey = env('KAYPAL_AI_PROXY_API_KEY') || env('KAYPAL_API_KEY') || '';

const ASR_MODEL = env('KAYPAL_VOICE_ASR_MODEL') || 'paraformer-realtime-v2';
const TTS_MODEL = env('KAYPAL_VOICE_TTS_MODEL') || 'cosyvoice-v2';
const VOICE_MODEL_KEYWORDS = [
  'paraformer',
  'audio',
  'asr',
  'tts',
  'cosyvoice',
  'qwen-audio',
  'speech',
  'voice',
  'sambert',
];

const results = {
  checkedAt: new Date().toISOString(),
  gateway: gatewayBase,
  authBase,
  serverKeyConfigured: Boolean(serverKey),
  asrModel: ASR_MODEL,
  ttsModel: TTS_MODEL,
  steps: [],
};

function step(name, ok, detail) {
  results.steps.push({ name, ok, detail });
  if (!jsonOutput) {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let exitCode = 0;

async function main() {
  // 1. 配置完整性
  if (!serverKey) {
    step('服务商 Key 已配置', false, '缺少 KAYPAL_AI_PROXY_API_KEY / KAYPAL_API_KEY');
    exitCode = 1;
  } else {
    step('服务商 Key 已配置', true);
  }

  // 2. 网关连通性 + 鉴权（GET /v1/models）
  let models = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${gatewayBase}/v1/models`, {
      headers: serverKey ? { 'x-kaypal-api-key': serverKey } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const list = Array.isArray(payload?.data)
        ? payload.data.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean)
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
      models = list;
      step(
        '网关连通 + 鉴权通过',
        true,
        `${res.status} · 模型数 ${models.length}`,
      );
      if (jsonOutput) results.models = models;
    } else if (res.status === 401 || res.status === 403) {
      step('网关连通但鉴权失败', false, `HTTP ${res.status}（Key 失效或无权访问）`);
      exitCode = 1;
    } else {
      step('网关连通但返回异常', false, `HTTP ${res.status}`);
      exitCode = 2;
    }
  } catch (err) {
    step(
      '网关不可达',
      false,
      err instanceof Error ? err.message : String(err),
    );
    exitCode = 2;
  }

  // 3. 语音模型检测
  if (models.length) {
    const matched = models.filter((id) =>
      VOICE_MODEL_KEYWORDS.some((kw) => String(id).toLowerCase().includes(kw)),
    );
    if (matched.length) {
      step('检测到语音相关模型', true, matched.join(', '));
    } else {
      step(
        '未检测到语音相关模型',
        false,
        '模型列表不含 paraformer/audio/tts/cosyvoice 等关键词（可能网关未暴露语音模型或列表不全）',
      );
      if (exitCode === 0) exitCode = 3;
    }
  }

  // 4. 探测 /v1/audio/speech 端点存在性（空体 POST，按响应码区分）
  try {
    const res = await fetch(`${gatewayBase}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kaypal-api-key': serverKey },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      step('TTS 端点 /v1/audio/speech 存在性', false, 'HTTP 404（网关未实现该端点）');
      if (exitCode === 0) exitCode = 2;
    } else {
      step(
        'TTS 端点 /v1/audio/speech 存在性',
        true,
        `HTTP ${res.status}（端点存在，4xx/5xx 为参数或鉴权问题）`,
      );
    }
  } catch {
    /* 与步骤 2 连通性结论一致，不重复计分 */
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ ...results, exitCode }, null, 2));
  } else {
    console.log(
      `\n${exitCode === 0 ? '✅ 全部通过' : exitCode === 3 ? '⚠️ 通过但语音模型未检测到' : '❌ 存在失败项'}（exit=${exitCode}）`,
    );
    console.log('网关:', gatewayBase);
    console.log('ASR 模型:', ASR_MODEL, '· TTS 模型:', TTS_MODEL);
    console.log('\n提示：模型名不对时，用 env 覆盖后再跑：');
    console.log('  KAYPAL_VOICE_ASR_MODEL=<云端模型名> KAYPAL_VOICE_TTS_MODEL=<云端模型名> node scripts/verify-kaypal-voice-gateway.mjs');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
