export type AgentSOutcomeStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "waiting_approval"
  | "cancelled";

export type AgentSOutcome = {
  status: AgentSOutcomeStatus;
  cardStatus: "ready" | "paused" | "review" | "sending";
  canStart: boolean;
  title: string;
  detail: string;
  target?: string;
  message?: string;
  screenshotPath?: string;
  mode?: string;
};

type AgentSEventLike = {
  seq?: number;
  status?: string;
  message?: string | null;
  payload?: Record<string, unknown>;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function latestEvent(events: AgentSEventLike[]) {
  return [...events].sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0))[0];
}

export function buildAgentSOutcome(
  session: { status?: string } | null | undefined,
  events: AgentSEventLike[],
  fallbackRunningDetail: string,
): AgentSOutcome | null {
  if (!session) return null;

  const event = latestEvent(events);
  const payload = event?.payload || {};
  const status = String(
    event?.status || session.status || "running",
  ) as AgentSOutcomeStatus;
  const isRunning = status === "running" || status === "waiting_approval";
  const target =
    text(payload.target) || text(payload.contact) || text(payload.assetPath);
  const message =
    text(payload.message) || text(payload.reply) || text(payload.content);
  const screenshotPath = text(payload.screenshotPath);
  const mode = text(payload.mode);
  const rawDetail =
    text(event?.message) ||
    (isRunning ? fallbackRunningDetail : "本机执行已返回状态。");
  const detailParts = [
    rawDetail,
    target ? `对象：${target}` : null,
    message ? `内容：${message}` : null,
    screenshotPath ? `截图：${screenshotPath}` : null,
  ].filter(Boolean);

  return {
    status,
    cardStatus:
      status === "completed"
        ? "ready"
        : status === "failed" || status === "cancelled"
          ? "paused"
          : status === "waiting_approval"
            ? "review"
            : "sending",
    canStart: !isRunning,
    title:
      status === "completed"
        ? "真实发送结果"
        : status === "failed"
          ? "发送失败"
          : status === "waiting_approval"
            ? "等待继续执行"
            : "正在操作本机应用",
    detail: detailParts.join("\n"),
    target,
    message,
    screenshotPath,
    mode,
  };
}
