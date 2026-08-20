/**
 * 通知去重工具（2026-08-20）：
 * 同一通知（按内容/类型去重）全局只展示一次，避免"账号 XX 登录状态异常"重复 2-4 次刷屏。
 * 去重维度：通知的 message 文本（trim 后）+ type/severity。
 */

export interface Notifiable {
  id?: string;
  message?: string;
  title?: string;
  type?: string;
  severity?: string;
}

/** 生成通知去重 key：优先 id；否则按 message/title/type 归一化 */
export function notificationKey(n: Notifiable): string {
  if (n.id) return `id:${n.id}`;
  const text = (n.message || n.title || "").trim();
  return `text:${text}|type:${n.type || ""}|sev:${n.severity || ""}`;
}

/** 数组去重（保持顺序，第一条胜出） */
export function dedupeNotifications<T extends Notifiable>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = notificationKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
