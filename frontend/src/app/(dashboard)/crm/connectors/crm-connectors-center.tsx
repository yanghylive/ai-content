"use client";

import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle, SkeletonRow } from "@/components/skeleton";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { HubSpotVaultPanel } from "./hubspot-vault-panel";

interface ConnectorItem {
  connectorKey: string;
  connectorName: string;
  status: string;
  mode?: string;
  readinessStatus?: string;
  summary?: string;
  nextActions?: string[];
}

/**
 * 连接器状态 → 诚实标注（报告 7.6）：后端返回 contract-only / dry-run-only，
 * 均「不联网、不收 token、不写外部系统」，不能叫「已连接」。
 */
function connectorStatusMeta(item: ConnectorItem): {
  label: string;
  tone: "success" | "warning" | "muted";
} {
  const mode = (item.mode || "").toLowerCase();
  const status = (item.status || "").toLowerCase();
  if (status === "connected" || mode.includes("write") || mode.includes("synced")) {
    return { label: "已连接", tone: "success" };
  }
  if (mode.includes("read") || mode.includes("no-token") || mode.includes("contract") || mode.includes("dry-run")) {
    return { label: "只读预配置", tone: "warning" };
  }
  if (status === "ready") return { label: "就绪", tone: "success" };
  if (status === "failed" || status === "expired") {
    return { label: status === "failed" ? "失败" : "已过期", tone: "muted" };
  }
  return { label: "待配置", tone: "muted" };
}

/** 连接器说明脱敏：把内部合同/干跑阶段描述替换为面向客户的文案 */
function sanitizeConnectorText(text?: string | null) {
  if (!text) return "";
  return String(text)
    .replace(/contract-only dry-run|dry-run|dry run/gi, "预配置阶段")
    .replace(/不保存 token、不联网、不写外部系统|不联网、不写外部系统|不保存 token|不收 token|不保存token|不收token/gi, "暂不对外写入数据")
    .replace(/合同\/干跑阶段|合同阶段/gi, "预配置阶段")
    .replace(/可做字段映射、预检和证据生成/gi, "可做字段映射与预检")
    .trim();
}

/** 下一步动作 → 面向客户的友好名称 */
function formatNextAction(action?: string | null) {
  const key = String(action || "").trim().toLowerCase();
  if (!key) return "";
  const known: Record<string, string> = {
    "oauth app review": "完成应用审核",
    "app review": "完成应用审核",
    "tenant app approval": "等待应用审批",
    "human confirm": "等待人工确认",
  };
  return known[key] || "等待配置";
}

/** 数据连接——真实连接器就绪状态（不再写死） */
export function CrmConnectorsCenter() {
  const router = useRouter();
  const [items, setItems] = useState<ConnectorItem[]>([]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await api.get("/crm/connectors/readiness")) as {
        connectors?: ConnectorItem[];
        summary?: string;
      };
      setItems(result.connectors || []);
      setSummary(result.summary || "");
    } catch (err: unknown) {
      setError(toPublicError(err, "连接状态读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 连接记录（contract proof：审计证明，展示安全边界 + 留存编号）
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const handleProof = async (connectorKey: string) => {
    setProofBusy(true);
    setProofError(null);
    setProof(null);
    try {
      const result = await api.post("/crm/connectors/contract", {
        connectorKey,
        includeProof: true,
        requestedBy: "crm-connectors-center",
      });
      setProof((result as Record<string, unknown>) || null);
    } catch (err: unknown) {
      setProofError(toPublicError(err, "连接记录生成失败"));
    } finally {
      setProofBusy(false);
    }
  };

  const readyCount = items.filter(
    (i) => connectorStatusMeta(i).tone === "success",
  ).length;
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">数据连接</h1>
              <p className="mx-page-sub">
                {sanitizeConnectorText(summary) || "把你的客户数据源接到系统里"}
              </p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px" }}
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCcw size={13} style={{ marginRight: 4 }} />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 10 }}>{error}</p>
          ) : null}

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>还没有数据源连接</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>客户数据可以从导入开始，先不用急着接外部系统</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/crm-import")}>去导入客户</button>
            </div>
          ) : (
            <>
              <div className="mx-section-head">
                <div className="mx-section-title">数据源</div>
                <span className="mx-section-eyebrow">{readyCount}/{items.length} 就绪</span>
              </div>
              <div className="mx-card mx-list-card">
                {items.map((item) => (
                  <div key={item.connectorKey} className="mx-row">
                    <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                      <Plug size={18} strokeWidth={1.8} />
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{item.connectorName}</div>
                      {item.summary ? (
                        <div className="mx-row-desc">{sanitizeConnectorText(item.summary)}</div>
                      ) : null}
                      {item.nextActions && item.nextActions.length > 0 ? (
                        <div className="mx-row-desc" style={{ color: "var(--kaypal-v3-cobalt)" }}>
                          下一步:{formatNextAction(item.nextActions[0])}
                        </div>
                      ) : null}
                    </div>
                    <div className="mx-row-right">
                      <span className={`mx-badge ${connectorStatusMeta(item).tone === "success" ? "mx-badge-green" : "mx-badge-gold"}`}>
                        {connectorStatusMeta(item).label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <HubSpotVaultPanel />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Plug className="h-6 w-6" />
          </div>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">数据连接</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {sanitizeConnectorText(summary) || "把你的客户数据源接到系统里，自动同步"}
            </p>
          </div>
        </div>
        <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : items.length === 0 ? (
        <V2EmptyState
          icon={Plug}
          title="还没有数据源连接"
          description="客户数据可以从导入开始，先不用急着接外部系统"
          action={
            <V2GhostButton onClick={() => router.push("/crm-import")}>
              去导入客户
            </V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`数据源（${readyCount}/${items.length} 就绪）`}>
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.connectorKey} className="kaypal-v3-surface p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--kaypal-v3-ink)]">{item.connectorName}</h3>
                  <V2StatusChip tone={connectorStatusMeta(item).tone}>
                    {connectorStatusMeta(item).label}
                  </V2StatusChip>
                </div>
                {item.summary ? (
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">{sanitizeConnectorText(item.summary)}</p>
                ) : null}
                {item.nextActions && item.nextActions.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--kaypal-v3-accent-ink)]">
                    下一步:{formatNextAction(item.nextActions[0])}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mt-3 text-xs font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
                  disabled={proofBusy}
                  onClick={() => void handleProof(item.connectorKey)}
                >
                  {proofBusy ? "生成中…" : "生成连接记录"}
                </button>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {proofError ? (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {proofError}
        </p>
      ) : null}

      {proof ? (
        <V2Section title="连接记录" description="只读检查、安全边界和留存编号">
          <div className="kaypal-v3-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                {String((proof as { connectorName?: string }).connectorName || "连接器")} 连接记录
              </h3>
              <V2StatusChip tone="success">
                {String((proof as { status?: string }).status || "contract-ready") === "contract-ready" ? "方案已确认" : String((proof as { status?: string }).status || "")}
              </V2StatusChip>
            </div>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              只读检查、不写 CRM、不触碰外部系统；安全边界与留存编号已由系统记录。
            </p>
            {((proof as { auditId?: string }).auditId) ? (
              <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
                留存编号：{String((proof as { auditId?: string }).auditId)}
              </p>
            ) : null}
          </div>
        </V2Section>
      ) : null}

      <HubSpotVaultPanel />
    </div>
  );
}
