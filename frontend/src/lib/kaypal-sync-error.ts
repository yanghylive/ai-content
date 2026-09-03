// Kaypal 模型同步错误的统一分类与提示文案（2026-09-03）
// 供「账号与团队 / 设置」等页面复用：把两类失败区分开，
// 避免把「无模型台列表权限」误报成「登录失效」让用户白跑一趟重登。
import { toPublicError } from "./public-error";

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : String(value || "");
}

/** 会话/登录真正失效（前端重登可解决，如 AuthGuard 的「请先登录」） */
export function isSessionAuthIssue(value: unknown) {
  return /请先登录|未登录|登录已失效|会话已过期|登录态.*失效/i.test(
    messageOf(value),
  );
}

/**
 * 凭据无法读取 Kaypal 模型台列表（admin/chat-models 端点 401）。
 * 2026-09-03 实测：desktop token 未过期但列表端点返回 Unauthorized——
 * 多半是当前账号无模型台管理权限或云端收紧，重登不一定能解决；
 * 本地已同步的模型路由不受影响，AI 对话/推理照常。
 */
export function isModelListUnavailable(value: unknown) {
  return /模型台状态读取失败|普通模型列表读取失败|模型列表读取失败|模型列表暂不可用/.test(
    messageOf(value),
  );
}

/** 把同步/状态错误翻译成准确、可操作的提示文案 */
export function describeSyncError(value: unknown) {
  if (isSessionAuthIssue(value)) {
    return "登录已失效，请重新登录后再同步。";
  }
  if (isModelListUnavailable(value)) {
    return "无法读取 Kaypal 模型台列表（当前凭据无管理权限或云端暂不可用）。本地已同步的 AI 服务不受影响，可继续使用。";
  }
  return toPublicError(value, "AI 服务状态暂时无法读取，请重新加载。");
}
