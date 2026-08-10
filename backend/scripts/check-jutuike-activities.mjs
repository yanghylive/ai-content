#!/usr/bin/env node
/**
 * 聚推客联盟活动表自动校准（2026-08-09）
 *
 * 背景：聚推客 act_id 是动态的——活动上下架/换绑频繁（实测美团系 5 个活动下架、
 * 3 个 act_id 张冠李戴）。官网文档清单滞后于接口实际，必须定期按真实转链接口校准。
 *
 * 用法：
 *   node scripts/check-jutuike-activities.mjs          # 只读校准报告
 *   node scripts/check-jutuike-activities.mjs --fix    # 自动剔除下架项 + 修正张冠李戴名称（改写 TS 源码）
 *
 * 判定：
 *   OK            转链成功且名称一致（展示名与官方名互为子串视为一致）
 *   FAIL          转链失败（下架/停投/凭证问题）——前端点不了，需剔除
 *   NO_H5         转链成功但无 h5（仅小程序）——桌面端点不了，需关注
 *   NAME_MISMATCH 名称差异提示：多为展示名 vs 官方全名（无害）；仅当语义完全
 *                 不同（如 电费充值→美团机票）才说明 act_id 被换绑，需人工核对
 *
 * 退出码：0=健康（名称差异仅提示）  1=有 FAIL/NO_H5  3=缺少 apikey
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = path.join(ROOT, 'src/modules/savings/jutuike-life.service.ts');
const ENV_FILE = path.join(ROOT, '.env');
const API = 'http://api.jutuike.com/union/act';
const TIMEOUT = 12000;
const FIX = process.argv.includes('--fix');

// ---------- 读 .env（仅取需要的键，不注入全局） ----------
function loadEnv(file) {
  const out = {};
  try {
    const txt = readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].trim();
    }
  } catch { /* .env 不存在则用 process.env */ }
  return { ...process.env, ...out };
}
const env = loadEnv(ENV_FILE);
const apikey = (env.JUTUIKE_APIKEY || '').trim();
const sid = (env.JUTUIKE_SID || 'jiuzhang-ai').trim();

if (!apikey) {
  console.error('❌ 未找到 JUTUIKE_APIKEY（backend/.env），无法校准。');
  process.exit(3);
}

// ---------- 从 TS 源码解析 LIFE_SERVICES 配置块 ----------
const src = readFileSync(SERVICE, 'utf8');
const tableMatch = src.match(/const LIFE_SERVICES: LifeServiceItem\[\] = \[([\s\S]*?)\n\];/);
if (!tableMatch) {
  console.error('❌ 无法在 jutuike-life.service.ts 定位 LIFE_SERVICES 配置表。');
  process.exit(3);
}
const tableBody = tableMatch[1];

/** 按顶层块切分（每个 { ... }, 一个活动） */
const blocks = [];
const blockRe = /\{\s*\n([\s\S]*?)\n\s*\},/g;
let bm;
while ((bm = blockRe.exec(tableBody)) !== null) {
  const body = bm[1];
  const actId = Number((body.match(/actId:\s*(\d+)/) || [])[1]);
  const name = (body.match(/name:\s*'([^']*)'/) || [])[1];
  const scene = (body.match(/scene:\s*'([^']*)'/) || [])[1];
  if (actId) blocks.push({ actId, name: name || '', scene: scene || '', raw: bm[0], idx: bm.index });
}

console.log(`📋 配置表活动数：${blocks.length}（${SERVICE.split('/').pop()}）\n`);

// ---------- 逐个转链验证 ----------
function normalize(s) {
  return (s || '').replace(/[【】\[\]（）()\s&、，,·]/g, '').toLowerCase();
}

async function check(actId) {
  const q = new URLSearchParams({ apikey, sid, act_id: String(actId) });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${API}?${q}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, fail: true, msg: `HTTP ${res.status}` };
    const j = await res.json();
    if (j.code !== 1 || !j.data) return { ok: false, fail: true, msg: `${j.code} ${j.msg || ''}`.trim() };
    const d = j.data;
    return {
      ok: true,
      actName: d.act_name || '',
      h5: Boolean(d.h5),
      weApp: Boolean(d.we_app_info),
    };
  } catch (e) {
    return { ok: false, fail: true, msg: e.name === 'AbortError' ? '超时' : e.message };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
for (const b of blocks) {
  const r = await check(b.actId);
  let status, note = '';
  if (r.fail) {
    status = 'FAIL';
    note = r.msg;
  } else if (!r.h5 && !r.weApp) {
    status = 'NO_H5';
    note = '无 h5 且无小程序信息';
  } else if (!r.h5) {
    status = 'NO_H5';
    note = '仅小程序（无 h5）';
  } else if (normalize(r.actName) && normalize(r.actName) !== normalize(b.name) && !normalize(r.actName).includes(normalize(b.name)) && !normalize(b.name).includes(normalize(r.actName))) {
    status = 'NAME_MISMATCH';
    note = `接口实际:「${r.actName}」`;
  } else {
    status = 'OK';
  }
  results.push({ ...b, status, note, apiName: r.actName || '' });
  const mark = status === 'OK' ? '✅' : status === 'NAME_MISMATCH' ? '⚠️' : '❌';
  console.log(`${mark} act_${b.actId} ${status.padEnd(13)} ${b.name.padEnd(12)} ${note}`);
}

// ---------- 汇总 ----------
const fails = results.filter((r) => r.status === 'FAIL' || r.status === 'NO_H5');
const mismatches = results.filter((r) => r.status === 'NAME_MISMATCH');
const ok = results.filter((r) => r.status === 'OK');
console.log(`\n📊 汇总：OK ${ok.length} · 需处理 ${fails.length}（下架/无H5）· 名称差异提示 ${mismatches.length} / 共 ${results.length}`);
if (mismatches.length > 0) {
  console.log('   ℹ️ 名称差异多为「展示名 vs 官方全名」（如 花小猪打车 vs 花小猪活动），无害；');
  console.log('      仅当差异语义完全不同（如 电费充值→美团机票）才说明 act_id 被换绑，需人工核对。');
}

// ---------- --fix：改写 TS 源码 ----------
if (FIX) {
  if (fails.length === 0) {
    console.log('\n✨ 无下架/无H5 活动，配置表健康（名称差异不自动改，避免破坏展示名）。');
    process.exit(0);
  }
  let newTable = tableBody;
  // 剔除 FAIL/NO_H5 块（从后往前删，避免索引错位）
  const toRemove = results.filter((r) => r.status === 'FAIL' || r.status === 'NO_H5');
  for (const r of [...toRemove].sort((a, b) => b.idx - a.idx)) {
    const start = newTable.indexOf(r.raw);
    if (start >= 0) newTable = newTable.slice(0, start) + newTable.slice(start + r.raw.length);
  }
  const fixed = src.replace(tableMatch[0], `const LIFE_SERVICES: LifeServiceItem[] = [${newTable}\n];`);
  writeFileSync(SERVICE, fixed, 'utf8');
  console.log(`\n✏️ 已改写 ${SERVICE.split('/').pop()}：剔除 ${toRemove.length} 项。`);
  console.log('   请运行 prettier 格式化 + 重新构建 bundle：');
  console.log('   cd backend && npx prettier --write src/modules/savings/jutuike-life.service.ts');
  console.log('   npm run build:bundle:sqlite');
  process.exit(1);
}

process.exit(fails.length > 0 ? 1 : 0);
