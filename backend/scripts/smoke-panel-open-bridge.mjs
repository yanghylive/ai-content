/**
 * 真机 smoke:模拟 3011 引擎的 panel-open 链路。
 * 1. 读桥凭据文件(0600)拿 endpoint+token;
 * 2. POST /panel-open 打开面板加载抖音创作者后台;
 * 3. 轮询 CDP /json/list 确认面板 target 出现且 URL 命中平台域;
 * 4. (只读)Runtime.evaluate 读面板页 title,证明「引擎可驱动面板页面」。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

const registryPath = join(
  homedir(),
  'Library/Application Support/ai-content-desktop/browser-panel-bridge.json',
);
const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
console.log(`[1] registry ok: endpoint=${reg.endpoint}, panelId=${reg.panelId}`);

const callBridge = async (route, body) => {
  const res = await fetch(`${reg.endpoint}${route}`, {
    method: 'POST',
    headers: {
      'x-kaypal-bridge-token': reg.token,
      'x-kaypal-bridge-nonce': crypto.randomBytes(16).toString('hex'),
      'x-kaypal-bridge-ts': String(Date.now()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const open = await callBridge('/panel-open', {
  actor: { ownerId: 'local-engine', tenantId: 'local-tenant' },
  url: 'https://creator.douyin.com/creator-micro/home',
  accountId: '4',
  platform: 'douyin',
});
console.log(`[2] /panel-open → ${open.status}`, JSON.stringify(open.json?.data ?? open.json?.error ?? {}));
if (open.status !== 200) process.exit(1);

// 轮询 CDP targets 等面板 view 出现
const CDP_HTTP = 'http://127.0.0.1:9333';
let panelTarget = null;
for (let i = 0; i < 30; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const targets = (await (await fetch(`${CDP_HTTP}/json/list`)).json())
    .filter((t) => t.type === 'page');
  panelTarget = targets.find((t) => /douyin\.com/.test(t.url || ''));
  if (panelTarget) break;
}
if (!panelTarget) {
  console.error('[3] FAIL: 30s 内 CDP targets 未出现 douyin 页面');
  const targets = (await (await fetch(`${CDP_HTTP}/json/list`)).json()).map((t) => `${t.title?.slice(0, 30)} | ${(t.url || '').slice(0, 60)}`);
  console.error(targets.join('\n'));
  process.exit(1);
}
console.log(`[3] CDP target 出现: ${panelTarget.url.slice(0, 90)}`);

// 只读 evaluate 驱动面板页面(page-level CDP)
const WebSocket = (await import('ws')).default;
const ws = new WebSocket(panelTarget.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('ws timeout')), 10000);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'document.title', returnByValue: true },
    }));
  });
  ws.on('message', (m) => {
    clearTimeout(timer);
    const msg = JSON.parse(m.toString());
    resolve(msg.result?.result?.value);
  });
  ws.on('error', reject);
});
ws.close();
console.log(`[4] 面板页 title = ${JSON.stringify(result)}`);
console.log('SMOKE_OK');
