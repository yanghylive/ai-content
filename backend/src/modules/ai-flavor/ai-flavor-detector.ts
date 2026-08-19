/**
 * AIFlavorDetector —— AI 味检测器（规则评分）
 *
 * 自研实现。方法论借鉴 AIWriteX「去 AI 味/对抗检测」思路（仅思路，不抄代码）：
 * 从词库命中、句式特征、结构特征三个维度给文本打"AI 味"分（0-100）。
 *
 * 三个维度：
 * 1. 词库命中 —— AI 高频词/书面套话（值得注意的是/综上所述/赋能/抓手...）
 * 2. 句式特征 —— 工整排比、机械连接词（首先/其次/最后）、过长的句子
 * 3. 结构特征 —— 段落长度过于均匀（人类写作长短交错）
 */

/** AI 高频词/套话词库（权重分级） */
export const AI_FLAVOR_WORDS: Array<{ word: string; weight: number }> = [
  // 强信号（几乎只出现在 AI/公文里）
  { word: '值得注意的是', weight: 4 },
  { word: '综上所述', weight: 4 },
  { word: '总而言之', weight: 4 },
  { word: '不难发现', weight: 4 },
  { word: '值得一提的是', weight: 4 },
  { word: '由此可见', weight: 4 },
  { word: '从某种程度上说', weight: 4 },
  { word: '赋能', weight: 4 },
  { word: '抓手', weight: 4 },
  { word: '闭环', weight: 3 },
  { word: '颗粒度', weight: 3 },
  { word: '底层逻辑', weight: 3 },
  { word: '破局', weight: 3 },
  { word: '躬身入局', weight: 4 },
  { word: '范式', weight: 3 },
  { word: '认知升级', weight: 3 },
  { word: '方法论', weight: 3 },
  { word: '本质上', weight: 3 },
  { word: '换言之', weight: 3 },
  // 中等信号（书面连接词，AI 爱用且重复）
  { word: '首先', weight: 2 },
  { word: '其次', weight: 2 },
  { word: '最后', weight: 1.5 },
  { word: '此外', weight: 2 },
  { word: '另外', weight: 1.5 },
  { word: '同时', weight: 1.5 },
  { word: '因此', weight: 2 },
  { word: '从而', weight: 2 },
  { word: '不仅', weight: 1.5 },
  { word: '而且', weight: 1.5 },
  { word: '总之', weight: 2 },
  { word: '总的来说', weight: 2.5 },
  { word: '换句话说', weight: 2 },
  { word: '这意味着', weight: 2 },
  { word: '与此同时', weight: 2 },
  { word: '不可否认', weight: 2.5 },
  { word: '毫无疑问', weight: 2.5 },
  { word: '显然', weight: 1.5 },
  // 弱信号（口语也可能用，但 AI 高频）
  { word: '希望', weight: 1 },
  { word: '相信', weight: 1 },
  { word: '能够', weight: 1 },
  { word: '帮助', weight: 1 },
  { word: '提升', weight: 1 },
  { word: '实现', weight: 1 },
];

/** AI 味评分阈值：低于此值视为"自然" */
export const AI_FLAVOR_PASS_THRESHOLD = 30;

export interface AIFlavorDetection {
  /** 0-100，越高越像 AI 生成 */
  score: number;
  pass: boolean;
  /** 命中明细 */
  hits: Array<{
    kind: 'word' | 'parallel' | 'connector' | 'structure';
    label: string;
    detail?: string;
    weight: number;
  }>;
  stats: {
    totalWords: number;
    paragraphCount: number;
    avgSentenceLength: number;
    paragraphLengthStdDev: number;
  };
}

/** 工整排比检测：连续 2+ 句以同一词开头（分句含逗号） */
function detectParallel(text: string, hits: AIFlavorDetection['hits']) {
  const sentences = text
    .split(/[。！？!?，,；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (let i = 0; i < sentences.length - 1; i += 1) {
    const first = sentences[i];
    const second = sentences[i + 1];
    const firstHead = first.slice(0, 4);
    const secondHead = second.slice(0, 4);
    if (firstHead && firstHead === secondHead) {
      hits.push({
        kind: 'parallel',
        label: '排比句式',
        detail: `「${first.slice(0, 20)}…」与「${second.slice(0, 20)}…」同头`,
        weight: 2,
      });
      i += 1; // 跳过已配对
    }
  }
}

/** 段落长度均匀度（结构特征） */
function detectStructure(
  text: string,
  hits: AIFlavorDetection['hits'],
): {
  paragraphCount: number;
  paragraphLengthStdDev: number;
} {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 10);
  if (paragraphs.length < 3) {
    return { paragraphCount: paragraphs.length, paragraphLengthStdDev: 0 };
  }
  const lengths = paragraphs.map((p) => p.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.reduce((acc, len) => acc + (len - mean) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  // 标准差 < 均值的 20% → 段落过于均匀，像 AI 排版
  if (mean > 0 && stdDev < mean * 0.2) {
    hits.push({
      kind: 'structure',
      label: '段落过于均匀',
      detail: `std=${stdDev.toFixed(0)} mean=${mean.toFixed(0)}`,
      weight: 2,
    });
  }
  return {
    paragraphCount: paragraphs.length,
    paragraphLengthStdDev: stdDev,
  };
}

/** 平均句长（过长 → 书面感） */
function avgSentenceLength(text: string): number {
  const sentences = text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return 0;
  return sentences.reduce((a, s) => a + s.length, 0) / sentences.length;
}

export function detectAIFlavor(text: string): AIFlavorDetection {
  const normalized = (text || '').trim();
  const hits: AIFlavorDetection['hits'] = [];
  let score = 0;

  // 1. 词库命中
  for (const { word, weight } of AI_FLAVOR_WORDS) {
    const count = normalized.split(word).length - 1;
    if (count > 0) {
      score += weight * count;
      hits.push({
        kind: 'word',
        label: `高频词「${word}」×${count}`,
        weight: weight * count,
      });
    }
  }

  // 2. 排比句式
  detectParallel(normalized, hits);

  // 3. 结构特征
  const { paragraphCount, paragraphLengthStdDev } = detectStructure(
    normalized,
    hits,
  );

  // 4. 平均句长过长（> 45 字/句 → 书面 AI 感）
  const avgLen = avgSentenceLength(normalized);
  if (avgLen > 45) {
    score += 2;
    hits.push({
      kind: 'structure',
      label: '句子过长',
      detail: `平均句长 ${avgLen.toFixed(0)} 字`,
      weight: 2,
    });
  }

  const totalWords = normalized.length;
  const finalScore = Math.min(100, Math.round(score));

  return {
    score: finalScore,
    pass: finalScore < AI_FLAVOR_PASS_THRESHOLD,
    hits,
    stats: {
      totalWords,
      paragraphCount,
      avgSentenceLength: Math.round(avgLen),
      paragraphLengthStdDev: Math.round(paragraphLengthStdDev),
    },
  };
}

/** 只保留强/中信号词用于检测（供改写后复检） */
export function extractTopFlavorHits(
  hits: AIFlavorDetection['hits'],
): string[] {
  return hits
    .filter((h) => h.weight >= 1.5)
    .map((h) => h.label)
    .slice(0, 10);
}
