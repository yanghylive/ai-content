import { reviewContent, issuesToPrompt } from './content-reviewer';

describe('ContentReviewer', () => {
  const baseInput = {
    titles: ['一个人到35岁才明白的3个道理，第三点最扎心'],
    pagesContent: [
      '深夜书桌前的中年人背影，那些熬过的夜都算数。三十五岁那年的某个深夜，我关掉电脑屏幕，突然意识到时间已经不站在我这边了。',
      '道理一：把时间花在复利的事上。每天读30页书，一年就是20本，比刷短视频强十倍。技能是越老越值钱的资产，熬夜加班不是。建立自己的作品集，哪怕从一条朋友圈开始。坚持一年回头看，你会感谢今天开始行动的自己。',
      '道理二：主动选择圈子。和优秀的人在一起，认知会被拉高。远离消耗你的人，把精力留给值得的事。你的收入约等于身边五个朋友的平均值，这句话虽然扎心但确实有道理。',
      '道理三：身体是最大的复利。坚持锻炼两年，你会发现精力充沛带来的改变是全方位的。工作状态、情绪管理、甚至是家庭关系都会跟着变好。运动是最廉价的抗衰老投资，没有之一。',
      '现在开始，永远不晚。种一棵树最好的时间是十年前，其次是现在。点个关注，我们下期聊聊怎么找到自己的复利赛道。',
    ],
    pageTypes: ['cover', 'content', 'content', 'content', 'summary'],
    generatedImageCount: 5,
    aiFlavorScore: 10,
  };

  it('优质内容通过审稿', () => {
    const result = reviewContent(baseInput);
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    // 允许 0-1 条 warn（内容偏薄提示），不应有 error
    expect(result.issues.filter((i) => i.severity === 'error').length).toBe(0);
  });

  it('标题过短警告', () => {
    const result = reviewContent({ ...baseInput, titles: ['短'] });
    expect(result.issues.some((i) => i.dimension === 'title')).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('内容单薄判 error', () => {
    const result = reviewContent({
      ...baseInput,
      pagesContent: ['一句话。'],
      pageTypes: ['content'],
    });
    expect(result.issues.some((i) => i.dimension === 'content' && i.severity === 'error')).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('结构缺总结页警告', () => {
    const result = reviewContent({
      ...baseInput,
      pageTypes: ['cover', 'content', 'content', 'content'],
      pagesContent: baseInput.pagesContent.slice(0, 4),
      generatedImageCount: 4,
    });
    expect(result.issues.some((i) => i.dimension === 'structure')).toBe(true);
  });

  it('AI 味严重判 error 且建议先 de-flavor', () => {
    const result = reviewContent({ ...baseInput, aiFlavorScore: 60 });
    expect(result.issues.some((i) => i.dimension === 'flavor' && i.severity === 'error')).toBe(true);
  });

  it('配图缺失判 error', () => {
    const result = reviewContent({ ...baseInput, generatedImageCount: 0 });
    expect(result.issues.some((i) => i.dimension === 'image' && i.severity === 'error')).toBe(true);
  });

  it('issuesToPrompt 生成问题清单文本', () => {
    const result = reviewContent({ ...baseInput, generatedImageCount: 0 });
    const text = issuesToPrompt(result.issues);
    expect(text).toContain('[image/error]');
  });

  it('空内容全部 error', () => {
    const result = reviewContent({
      titles: [],
      pagesContent: [],
      pageTypes: [],
      generatedImageCount: 0,
    });
    expect(result.pass).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
