import {
  AI_FLAVOR_WORDS,
  detectAIFlavor,
  extractTopFlavorHits,
} from './ai-flavor-detector';

describe('AIFlavorDetector', () => {
  it('词库命中：AI 味高分', () => {
    const text =
      '值得注意的是，综上所述，我们需要赋能业务闭环。首先，我们要提升颗粒度；其次，我们要实现底层逻辑的破局；最后，毫无疑问这是非常重要的。';
    const result = detectAIFlavor(text);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.pass).toBe(false);
    expect(
      result.hits.some((h) => h.kind === 'word' && h.label.includes('值得注意的是')),
    ).toBe(true);
    expect(result.hits.some((h) => h.kind === 'word' && h.label.includes('综上所述'))).toBe(true);
  });

  it('自然口语文本低分通过', () => {
    const text =
      '哈哈哈这个真得试试，我之前也踩过坑。说实话一开始没抱希望，结果用了两周真的不一样了。\n价格也不贵，反正比请人划算多了，你说是不是？';
    const result = detectAIFlavor(text);
    expect(result.score).toBeLessThan(30);
    expect(result.pass).toBe(true);
  });

  it('排比句式命中', () => {
    const text =
      '首先我们要分析市场，首先我们要研究用户，首先我们要优化产品，首先我们要迭代版本。';
    const result = detectAIFlavor(text);
    expect(result.hits.some((h) => h.kind === 'parallel')).toBe(true);
  });

  it('段落均匀命中结构特征', () => {
    const p1 = '第一段内容，讲的是产品的基本功能和使用方法，大概六十个字左右的内容。';
    const p2 = '第二段内容，讲的是产品的核心优势和差异化特点，大概六十个字左右的内容。';
    const p3 = '第三段内容，讲的是产品的价格策略和目标用户群体，大概六十个字左右的内容。';
    const text = [p1, p2, p3].join('\n');
    const result = detectAIFlavor(text);
    expect(result.hits.some((h) => h.kind === 'structure')).toBe(true);
  });

  it('空文本安全返回', () => {
    const result = detectAIFlavor('');
    expect(result.score).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it('extractTopFlavorHits 只保留强信号', () => {
    const text =
      '值得注意的是，总的来说我们需要提升效率，希望这个方案能帮助大家。';
    const result = detectAIFlavor(text);
    const top = extractTopFlavorHits(result.hits);
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((t) => t.length > 0)).toBe(true);
  });

  it('词库完整性：所有词条有 weight 且 > 0', () => {
    expect(AI_FLAVOR_WORDS.length).toBeGreaterThan(30);
    expect(AI_FLAVOR_WORDS.every((w) => w.weight > 0)).toBe(true);
  });
});
