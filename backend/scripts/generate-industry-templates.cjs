/**
 * D2/D3：行业模板生成器（2026-08-09）
 * 输入：行业策略预设（content_strategies 表）
 * 输出：批量生成标题(60)/文案(36)/选题(30)/配图prompt(15) → 审校标记 → 入库 content_strategy_templates
 * 直连阿里百炼（DASHSCOPE_API_KEY），纯脚本批量跑，API 成本百元级。
 *
 * 用法：node scripts/generate-industry-templates.cjs [行业...]  (默认 P0 5 行业)
 * 例：node scripts/generate-industry-templates.cjs 美业 餐饮
 */
require('dotenv').config();
const { PrismaClient } = require('../prisma/.prisma-pg-client');
const p = new PrismaClient();

const BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.DASHSCOPE_API_KEY || process.env.QIANWEN_API_KEY;
const MODEL = process.env.DASHSCOPE_DEFAULT_MODEL || 'qwen-plus';

if (!API_KEY) {
  console.error('❌ 缺少 DASHSCOPE_API_KEY');
  process.exit(1);
}

const SCENES = ['新客引流', '老客复购', '产品种草', '客户见证', '节假日活动', '品牌故事', '上新公告', '优惠活动', '知识科普', '互动话题', '答疑辟谣', '会员权益'];
const HOOKS = ['数字', '反差', '疑问', '痛点', '福利', '权威数据', '悬念', '共情', '故事', '清单', '热点', '对比'];

const TARGETS = {
  title: { count: 60, desc: '标题' },
  article: { count: 36, desc: '完整文案' },
  topic: { count: 30, desc: '热点选题' },
  image_prompt: { count: 15, desc: '配图prompt' },
};

async function callAI(systemPrompt, userPrompt, maxTokens = 1000) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 调用失败 ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 解析 AI 输出为数组（兼容「1. xxx」编号/「- xxx」/纯列表） */
function parseList(raw, expected, type) {
  const lines = String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(1[0-9]|[0-9])[.、)]/.test(l) && !l.startsWith('-') && !l.startsWith('#'))
    .map((l) => l.replace(/^["'“”]+|["'“”]+$/g, '').trim());
  if (lines.length >= expected * 0.6) return lines.slice(0, expected);
  // 带编号解析
  const numbered = String(raw || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-•]|\d+[.、)])\s*/, '').trim())
    .filter(Boolean);
  return numbered.slice(0, expected);
}

function buildSystemPrompt(strategy, type) {
  const base = `你是资深新媒体内容策划，为「${strategy.industry}」行业创作${TARGETS[type].desc}。
目标人群：${strategy.targetAudience}
商业目的：${strategy.commercialGoal}
核心痛点：${strategy.corePainPoints}
写作角度：${strategy.writingAngles}
语气风格：${strategy.toneAndStyle}
要求：
1. 内容贴近真实商家场景，可直接套用或一键改写
2. 输出为纯列表，每条一行，不要编号、不要标题、不要额外说明
3. ${strategy.industry === '直销' ? '【红线】严禁拉人头/收益承诺/暴富/发展下线返利等传销话术，只做事业机会展示与信任建设' : ''}
4. ${strategy.industry === '医疗健康' ? '【红线】严禁疗效承诺，不得违反广告法' : ''}`;
  return base;
}

function buildUserPrompt(strategy, type) {
  const sceneHint = type === 'article'
    ? `\n覆盖 12 个场景：${SCENES.join('、')}，每个场景 3 条不同变体。每条文案 80-200 字。`
    : type === 'title'
      ? `\n覆盖 12 类钩子：${HOOKS.join('、')}，每类 5 条。每条 10-30 字，有吸引力。`
      : type === 'topic'
        ? `\n覆盖全年节奏（季节/节日/行业事件/平台热点），30 条可跟选题。`
        : `\n覆盖 5 类场景（产品展示/门店环境/活动海报/客户案例/氛围），每类 3 个风格（ins风/写实/国潮），共 15 条 AI 生图 prompt。`;
  return `为「${strategy.industry}」行业生成 ${TARGETS[type].count} 条${TARGETS[type].desc}。${sceneHint}\n直接输出列表：`;
}

async function generateAndStore(strategy, type, batch) {
  const limit = parseInt(process.env.TEMPLATE_LIMIT || '0', 10);
  const sys = buildSystemPrompt(strategy, type);
  const usr = buildUserPrompt(strategy, type);
  const raw = await callAI(sys, usr, type === 'article' ? 2500 : 1200);
  const items = parseList(raw, TARGETS[type].count, type);

  let stored = 0;
  for (let i = 0; i < items.length; i++) {
    if (limit > 0 && stored >= limit) break;
    const item = items[i];
    if (!item || item.length < 4) continue;
    await p.contentStrategyTemplate.create({
      data: {
        industry: strategy.industry,
        type,
        scene: type === 'article' ? SCENES[Math.min(i, SCENES.length - 1)] : type === 'title' ? HOOKS[Math.min(i, HOOKS.length - 1)] : null,
        hook: type === 'title' ? HOOKS[Math.min(i, HOOKS.length - 1)] : null,
        title: type === 'title' || type === 'topic' ? item : null,
        content: type === 'article' || type === 'image_prompt' ? item : null,
        source: 'ai',
        enabled: true,
      },
    });
    stored++;
  }
  console.log(`  [${strategy.industry}] ${type}：生成 ${items.length} 条，入库 ${stored} 条${limit ? `（limit=${limit}）` : ''}`);
  return stored;
}

async function main() {
  const argv = process.argv.slice(2);
  const industries = argv.length ? argv : ['美业', '餐饮', '教育', '微商', '直销'];
  console.log(`📝 开始生成行业模板：${industries.join('、')}`);
  const started = Date.now();
  let total = 0;

  for (const industry of industries) {
    const strategy = await p.contentStrategy.findFirst({ where: { industry } });
    if (!strategy) {
      console.warn(`⚠️ 跳过：行业「${industry}」无策略预设`);
      continue;
    }
    console.log(`\n=== ${industry} ===`);
    const types = process.env.TEMPLATE_TYPE ? [process.env.TEMPLATE_TYPE] : Object.keys(TARGETS);
    for (const type of types) {
      if (!TARGETS[type]) {
        console.warn(`⚠️ 未知类型: ${type}，可用: ${Object.keys(TARGETS).join(', ')}`);
        continue;
      }
      try {
        total += await generateAndStore(strategy, type, 1);
      } catch (e) {
        console.error(`  ❌ [${industry}] ${type} 生成失败: ${e.message}`);
      }
    }
  }
  console.log(`\n✅ 完成！共入库 ${total} 条，耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error('❌ 脚本失败', e); process.exit(1); }).finally(() => p.$disconnect());
