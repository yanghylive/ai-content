// 回复分类（开发文档 §10.4，统一开发计划 §九）
// 真实回复分类 7 类；unsubscribe → suppression；机器自动回复不算人工回复。
export type ReplyCategory =
  | 'positive' // 正向（感兴趣/认可）
  | 'negative' // 负向（拒绝/不感兴趣）
  | 'question' // 提问（需跟进）
  | 'out_of_office' // 不在岗/休假
  | 'unsubscribe' // 退订（→ suppression）
  | 'ambiguous' // 模糊（需人工）
  | 'spam'; // 垃圾/机器自动回复

export const REPLY_CATEGORIES: ReplyCategory[] = [
  'positive',
  'negative',
  'question',
  'out_of_office',
  'unsubscribe',
  'ambiguous',
  'spam',
];

/** 是否算「人工真实回复」（机器自动回复不算） */
export function isHumanReply(category: ReplyCategory): boolean {
  return category !== 'spam';
}

/** unsubscribe 是否触发 suppression */
export function triggersSuppression(category: ReplyCategory): boolean {
  return category === 'unsubscribe';
}

const UNSUBSCRIBE_KEYWORDS = [
  '退订', '取消订阅', '别再发', '不要发了', '停止发送', 'unsubscribe', 'stop sending', 'opt out', 'no more',
];
const NEGATIVE_KEYWORDS = [
  '不感兴趣', '不需要', '不用了', '算了', '拒绝', '别联系', 'no thanks', 'not interested', 'don\'t contact',
];
const OOO_KEYWORDS = [
  '休假', '出差', '不在', 'out of office', 'ooo', 'on vacation', 'away',
];
const SPAM_KEYWORDS = [
  '中奖', '恭喜您', '点击链接', '加群领', '免费领', '扫码', 'v我', '转发抽奖',
];
const QUESTION_MARKERS = ['？', '?', '怎么', '如何', '能否', '请问', '什么时候', '多少钱'];

/**
 * 回复分类（规则初版，纯关键词；后续可升级 LLM 分类）。
 * 优先级：spam > unsubscribe > negative > out_of_office > question > positive > ambiguous。
 * 机器自动回复（spam 特征/纯广告语）不计入人工回复。
 */
export function classifyReply(text: string): { category: ReplyCategory; reason: string } {
  const t = (text ?? '').toLowerCase();

  // 1. spam（机器/广告，优先——机器自动回复不算人工回复）
  if (SPAM_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
    return { category: 'spam', reason: '命中垃圾/广告特征，判为机器自动回复' };
  }
  // 2. unsubscribe（退订 → suppression）
  if (UNSUBSCRIBE_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
    return { category: 'unsubscribe', reason: '退订意图明确，触发 suppression' };
  }
  // 3. negative
  if (NEGATIVE_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
    return { category: 'negative', reason: '拒绝/不感兴趣' };
  }
  // 4. out_of_office
  if (OOO_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
    return { category: 'out_of_office', reason: '不在岗/休假，暂停 follow-up 但保留线索' };
  }
  // 5. question
  if (QUESTION_MARKERS.some((k) => t.includes(k))) {
    return { category: 'question', reason: '包含提问，需跟进' };
  }
  // 6. positive（认可/感兴趣词）
  if (/(好的|可以|感兴趣|不错|聊聊|详细|了解下|约)/.test(t)) {
    return { category: 'positive', reason: '正向认可/感兴趣' };
  }
  // 7. ambiguous（默认，需人工）
  return { category: 'ambiguous', reason: '无法自动判定，需人工确认' };
}
