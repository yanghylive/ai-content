import type {
  ContentWorkflowPlatform,
  ContentWorkflowTargetType,
} from "@/lib/api/content-optimization";

export type ComplianceHandoff = {
  source: "content-optimization";
  versionId: string;
  title: string;
  content: string;
  platform: ContentWorkflowPlatform;
  targetType: ContentWorkflowTargetType;
  createdAt: string;
};

const COMPLIANCE_HANDOFF_KEY = "ai-content-compliance-handoff";

export function saveComplianceHandoff(
  input: Omit<ComplianceHandoff, "createdAt" | "source">,
) {
  if (typeof window === "undefined") return;

  const handoff: ComplianceHandoff = {
    ...input,
    source: "content-optimization",
    createdAt: new Date().toISOString(),
  };

  window.sessionStorage.setItem(COMPLIANCE_HANDOFF_KEY, JSON.stringify(handoff));
}

export function loadComplianceHandoff() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(COMPLIANCE_HANDOFF_KEY);
    return raw ? (JSON.parse(raw) as ComplianceHandoff) : null;
  } catch {
    return null;
  }
}

export function clearComplianceHandoff() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(COMPLIANCE_HANDOFF_KEY);
}
