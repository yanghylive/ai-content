import type { InteractionTask } from "@/lib/api/local-engine";

function normalizeProofText(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

export function hasInteractionReadbackProof(task: InteractionTask | null) {
  if (!task?.replyText) return false;
  const replyText = normalizeProofText(task.replyText);
  if (!replyText) return false;

  const messages = [
    ...(task.events || []).map((event) => event.message),
    ...(task.steps || []).map((step) => `${step.label} ${step.message}`),
    task.diagnostics?.currentStepMessage,
  ];

  return messages.some((message) => {
    const normalized = normalizeProofText(message);
    if (!normalized.includes(replyText)) return false;
    if (/editorCleared|editorGone|输入框已清空/i.test(String(message))) {
      return false;
    }
    return /回读成功|回读确认|readback\s*(ok|success|confirmed)|已在页面看到|回复内容已确认/i.test(
      String(message),
    );
  });
}
