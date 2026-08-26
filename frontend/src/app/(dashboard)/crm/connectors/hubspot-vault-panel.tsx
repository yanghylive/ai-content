"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, PlayCircle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import { toActionableError, toPublicError } from "@/lib/public-error";
import {
  V2Field,
  V2GhostButton,
  V2Input,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

interface HubSpotVaultStatus {
  connectorKey?: string;
  tokenState?: string;
  activeHandleCount?: number;
  latest?: {
    label?: string | null;
    status?: string | null;
    keyFingerprint?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  plaintextReturned?: boolean;
  encryptedSecretReturned?: boolean;
  warnings?: string[];
}

interface HubSpotReadOnlyRunResult {
  status?: string;
  mode?: string;
  maxRowsPerObject?: number;
  objectResults?: Array<{
    object?: string;
    displayName?: string;
    returnedCount?: number;
    hasMore?: boolean;
    rows?: Array<{
      id?: string | null;
      properties?: Record<string, string | null>;
    }>;
  }>;
  rawPayloadReturned?: boolean;
  rawPayloadPersisted?: boolean;
  audit?: { id?: string; proofHash?: string };
}

const HUBSPOT_OBJECTS = [
  { key: "companies", label: "公司" },
  { key: "contacts", label: "联系人" },
  { key: "deals", label: "交易" },
];

/**
 * HubSpot 只读检查接入：授权信息只进入安全保护区，页面不回显原文；
 * 只读检查只拉取脱敏样本，不写入客户管理系统。
 * 从 page-legacy 迁移而来。
 */
export function HubSpotVaultPanel() {
  const isMobile = useIsMobile();
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [portalId, setPortalId] = useState("");
  const [rows, setRows] = useState("3");
  const [objects, setObjects] = useState<string[]>(["contacts"]);
  const [status, setStatus] = useState<HubSpotVaultStatus | null>(null);
  const [result, setResult] = useState<HubSpotReadOnlyRunResult | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "run">("");
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get<HubSpotVaultStatus>("/crm/connectors/hubspot/vault-status"));
    } catch {
      // 未接入时静默，面板仍可用
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const active = status?.tokenState === "active";

  const saveToken = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("先填写 HubSpot 只读检查授权信息");
      return;
    }
    // 与后端 assertHubSpotPrivateAppTokenShape 同规则：≥20 字符且无空白
    if (trimmed.length < 20 || /\s/.test(trimmed)) {
      setError(
        "HubSpot token 需为无空格的 sandbox/private app token（≥20 字符），粘贴时不要带空格或换行",
      );
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await api.post("/crm/connectors/hubspot/vault-token", {
        token: trimmed,
        label: label.trim() || "HubSpot 只读检查环境",
        portalId: portalId.trim() || undefined,
      });
      setToken("");
      await loadStatus();
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        err.errorCode === "crm_hubspot_token_invalid"
      ) {
        setError(
          "HubSpot token 格式不正确，需使用无空格的 sandbox/private app token（≥20 字符）。",
        );
      } else {
        setError(
          toActionableError(err, "HubSpot 授权信息未能保存，请稍后重试。"),
        );
      }
    } finally {
      setBusy("");
    }
  };

  const runSandbox = async () => {
    setBusy("run");
    setError(null);
    try {
      setResult(
        await api.post<HubSpotReadOnlyRunResult>("/crm/connectors/hubspot/read-only-run", {
          objects,
          maxRowsPerObject: Number(rows) || 3,
        }),
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "HubSpot 连接检查未完成，请稍后重试。"));
    } finally {
      setBusy("");
    }
  };

  const toggleObject = (key: string) => {
    setObjects((current) => {
      if (current.includes(key)) {
        const next = current.filter((item) => item !== key);
        return next.length ? next : current;
      }
      return [...current, key];
    });
  };

  /* 移动端 */
  if (isMobile) {
    return (
      <div className="mx-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`mx-badge ${active ? "mx-badge-green" : "mx-badge-gold"}`} style={{ fontSize: 10 }}>
            {active ? "安全库已接入" : "安全库未接入"}
          </span>
          <span className="mx-badge mx-badge-green" style={{ fontSize: 10 }}>只读检查</span>
          <span className="mx-badge mx-badge-green" style={{ fontSize: 10 }}>不写 CRM</span>
        </div>
        <div className="mx-section-head" style={{ marginTop: 10 }}>HubSpot 只读检查接入</div>
        <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4, lineHeight: 1.5 }}>
          授权信息只进入安全保护区，页面不回显原文。只读检查只拉取脱敏样本，不写入客户管理系统。
        </p>

        {error && <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-danger)", marginTop: 8 }}>{error}</p>}

        <label style={{ display: "block", marginTop: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>授权信息（保存后不回显）</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="HubSpot 只读访问令牌（粘贴时不要带空格或换行）"
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
          />
        </label>
        <label style={{ display: "block", marginTop: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>备注（可选）</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：生产门户"
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
          />
        </label>
        <label style={{ display: "block", marginTop: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>Portal ID（可选）</span>
          <input
            value={portalId}
            onChange={(e) => setPortalId(e.target.value)}
            placeholder="HubSpot 门户 ID"
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
          />
        </label>
        <button
          type="button"
          className="mx-btn-gold"
          style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          disabled={busy === "save"}
          onClick={() => void saveToken()}
        >
          <Lock width={14} height={14} />
          {busy === "save" ? "保存中…" : "安全保存"}
        </button>

        <div className="mx-section-head" style={{ marginTop: 14 }}>只读检查</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {HUBSPOT_OBJECTS.map((obj) => (
            <button
              key={obj.key}
              type="button"
              onClick={() => toggleObject(obj.key)}
              className="mx-badge"
              style={{
                fontSize: 11.5,
                padding: "6px 10px",
                border: "1px solid rgba(142,165,190,.3)",
                background: objects.includes(obj.key) ? "rgba(222,150,57,.12)" : "transparent",
                color: objects.includes(obj.key) ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-muted)",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {obj.label}
            </button>
          ))}
        </div>
        <label style={{ display: "block", marginTop: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>每个对象最多读取行数</span>
          <input
            type="number"
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
          />
        </label>
        <button
          type="button"
          className="mx-btn-gold"
          style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          disabled={!active || busy === "run"}
          onClick={() => void runSandbox()}
        >
          <PlayCircle width={14} height={14} />
          {busy === "run" ? "检查中…" : "开始只读检查"}
        </button>

        {result ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>
              检查完成 · 每个对象最多 {result.maxRowsPerObject ?? "-"} 行
            </p>
            {result.objectResults?.map((r) => (
              <p key={r.object} style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 3 }}>
                {r.displayName || r.object}：返回 {r.returnedCount ?? 0} 行{r.hasMore ? "（还有更多）" : ""}
              </p>
            ))}
            {result.audit?.proofHash ? (
              <p style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 4 }}>留存编号：{result.audit.proofHash.slice(0, 12)}…</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  /* 桌面端 */
  return (
    <V2Section title="HubSpot 只读检查接入" description="授权信息只进入安全保护区，页面不回显原文；只读检查只拉取脱敏样本，不写入客户管理系统">
      <div className="flex flex-wrap items-center gap-2">
        <V2StatusChip tone={active ? "success" : "warning"}>
          {active ? "安全库已接入" : "安全库未接入"}
        </V2StatusChip>
        <V2StatusChip tone="success">只读检查</V2StatusChip>
        <V2StatusChip tone="success">不写 CRM</V2StatusChip>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--kaypal-v3-danger)]">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-5 md:grid-cols-3">
        <V2Field label="授权信息（保存后不回显）" hint="HubSpot 只读访问令牌">
          <V2Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="只读访问令牌（粘贴时不要带空格或换行）"
          />
        </V2Field>
        <V2Field label="备注（可选）">
          <V2Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：生产门户"
          />
        </V2Field>
        <V2Field label="Portal ID（可选）">
          <V2Input
            value={portalId}
            onChange={(e) => setPortalId(e.target.value)}
            placeholder="HubSpot 门户 ID"
          />
        </V2Field>
      </div>
      <div className="mt-3">
        <V2PrimaryButton icon={Lock} loading={busy === "save"} onClick={() => void saveToken()}>
          安全保存
        </V2PrimaryButton>
      </div>

      <div className="mt-6 border-t border-[var(--kaypal-v3-border)] pt-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--kaypal-v3-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">只读检查</h3>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {HUBSPOT_OBJECTS.map((obj) => (
            <button
              key={obj.key}
              type="button"
              onClick={() => toggleObject(obj.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                objects.includes(obj.key)
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                  : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]"
              }`}
            >
              {obj.label}
            </button>
          ))}
          <div className="ml-2 flex items-center gap-2">
            <span className="text-xs text-[var(--kaypal-v3-muted)]">每对象最多</span>
            <input
              type="number"
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              className="h-9 w-20 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-2 text-sm text-[var(--kaypal-v3-ink)] outline-none"
            />
            <span className="text-xs text-[var(--kaypal-v3-muted)]">行</span>
          </div>
        </div>
        <div className="mt-3">
          <V2GhostButton icon={PlayCircle} loading={busy === "run"} disabled={!active} onClick={() => void runSandbox()}>
            开始只读检查
          </V2GhostButton>
        </div>

        {result ? (
          <div className="mt-4 space-y-1 text-sm text-[var(--kaypal-v3-muted)]">
            <p className="font-medium text-[var(--kaypal-v3-ink)]">
              检查完成 · 每个对象最多 {result.maxRowsPerObject ?? "-"} 行
            </p>
            {result.objectResults?.map((r) => (
              <p key={r.object}>
                {r.displayName || r.object}：返回 {r.returnedCount ?? 0} 行{r.hasMore ? "（还有更多）" : ""}
              </p>
            ))}
            {result.audit?.proofHash ? (
              <p className="text-xs">留存编号：{result.audit.proofHash.slice(0, 16)}…</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </V2Section>
  );
}
