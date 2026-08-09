import type { AgentSession } from "./api/local-engine";

export type AgentSessionVerificationState = {
  evidenceCount: number;
  requiresEvidence: boolean;
  pendingVerification: boolean;
};

function metadataBoolean(
  metadata: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    if (typeof metadata[key] === "boolean") return metadata[key];
  }
  return undefined;
}

function metadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase().replace(/[.\s-]+/g, "_");
    }
  }
  return "";
}

function sessionEvidenceCount(session: AgentSession) {
  const eventCount = (
    Array.isArray(session.events) ? session.events : []
  ).filter((event) => Boolean(event.evidence)).length;
  const metadata = session.metadata || {};
  const reportedCount = Number(
    metadata.evidenceCount ??
      metadata.evidence_count ??
      metadata.resultEvidenceCount ??
      0,
  );
  return Math.max(
    eventCount,
    Number.isFinite(reportedCount) ? Math.max(0, reportedCount) : 0,
  );
}

export function agentSessionRequiresEvidence(session: AgentSession) {
  const metadata = session.metadata || {};
  const explicitRequirement = metadataBoolean(metadata, [
    "requiresEvidence",
    "requires_evidence",
    "requiresReadback",
    "requires_readback",
    "resultEvidenceRequired",
    "result_evidence_required",
  ]);
  const explicitExternalAction = metadataBoolean(metadata, [
    "commercialExecutionRequested",
    "commercial_execution_requested",
    "realAction",
    "real_action",
    "externalAction",
    "external_action",
    "platformAction",
    "platform_action",
    "customerAction",
    "customer_action",
    "realWechatActionAttempted",
  ]);
  const executionKind = metadataText(metadata, [
    "executionMode",
    "execution_mode",
    "actionKind",
    "action_kind",
    "executionKind",
    "execution_kind",
  ]);
  const externalExecutionKinds = new Set([
    "customer_action",
    "platform_action",
    "live_execution",
    "auto_send",
    "publish",
    "mass_send",
  ]);

  if (session.riskLevel === "high") return true;
  if (session.source === "publishing" || session.source === "interaction") {
    return true;
  }
  if (session.resumeAction || explicitExternalAction === true) return true;
  if (externalExecutionKinds.has(executionKind)) return true;
  if (explicitRequirement !== undefined) return explicitRequirement;
  if (explicitExternalAction === false) return false;
  if (
    [
      "dry_run",
      "simulated",
      "preview",
      "plan_only",
      "read_only",
      "internal",
      "local_operation",
      "candidate_read",
    ].includes(executionKind)
  ) {
    return false;
  }
  return (
    ["desktop", "remote", "mixed"].includes(session.executionScope) ||
    (session.executionScope === "browser" && Boolean(session.targetApp))
  );
}

export function getAgentSessionVerificationState(
  session: AgentSession,
): AgentSessionVerificationState {
  const evidenceCount = sessionEvidenceCount(session);
  const requiresEvidence = agentSessionRequiresEvidence(session);
  return {
    evidenceCount,
    requiresEvidence,
    pendingVerification:
      session.status === "completed" && requiresEvidence && evidenceCount === 0,
  };
}
