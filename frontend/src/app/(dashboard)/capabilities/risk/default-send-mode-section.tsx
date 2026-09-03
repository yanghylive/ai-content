"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "@/components/iconpark";
import {
  localEngineApi,
  type InteractionReplyRuleConfig,
  type InteractionSendMode,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { V2PrimaryButton, V2Section } from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/** unwrap { data } / 裸数据 两种返回形态 */
function unwrap<T>(value: T | { data?: T } | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value === "object" && "data" in value) {
    return (value as { data?: T }).data ?? null;
  }
  return value as T;
}

/**
 * 默认发送策略：用户能选的「自动执行 / 确认后执行」开关。
 * 从 page-legacy 迁移而来（原 DefaultSendModeSection）。
 */
export function DefaultSendModeSection() {
  const isMobile = useIsMobile();
  const [rule, setRule] = useState<InteractionReplyRuleConfig | null>(null);
  const [draft, setDraft] = useState<InteractionSendMode>("auto-send");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    localEngineApi
      .replyRule()
      .then((r) => {
        const resolved = unwrap<InteractionReplyRuleConfig>(r);
        setRule(resolved);
        setDraft(resolved?.defaultSendMode ?? "auto-send");
      })
      .catch(() => {
        setRule(null);
        setDraft("auto-send");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!rule || draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await localEngineApi.updateReplyRule({
        ...rule,
        defaultSendMode: draft,
      });
      setRule(unwrap<InteractionReplyRuleConfig>(updated));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e: unknown) {
      setError(toPublicError(e, "默认发送策略未能保存，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  };

  const isAutoSend = draft === "auto-send";
  const dirty = rule != null && draft !== rule.defaultSendMode;

  const description =
    "开启「自动执行」：高风险动作（发布 / 发送 / 删除 / 写文件 / 群发 / 朋友圈）直接执行，不再停下等人确认。关闭则每个高风险动作都会进待确认列表，等待你确认。";

  /* 移动端 */
  if (isMobile) {
    return (
      <div className="mx-card" style={{ padding: 14 }}>
        <div className="mx-section-head" style={{ marginTop: 0 }}>默认发送策略</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <span className={`mx-badge ${isAutoSend ? "mx-badge-green" : "mx-badge-gold"}`} style={{ fontSize: 10 }}>
            {isAutoSend ? "自动执行" : "确认后执行"}
          </span>
          {dirty ? (
            <span className="mx-badge mx-badge-gold" style={{ fontSize: 10 }}>有改动未保存</span>
          ) : savedFlash ? (
            <span className="mx-badge mx-badge-green" style={{ fontSize: 10 }}>已保存</span>
          ) : null}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 6, lineHeight: 1.5 }}>{description}</p>
        {error && <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-danger)", marginTop: 6 }}>{error}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: isAutoSend ? "var(--kaypal-v3-muted)" : "var(--kaypal-v3-ink)", fontWeight: isAutoSend ? 400 : 600 }}>
            确认后执行
          </span>
          <input
            type="checkbox"
            checked={isAutoSend}
            disabled={loading || saving}
            onChange={(e) => setDraft(e.target.checked ? "auto-send" : "approval-send")}
            style={{ width: 40, height: 22, accentColor: "#22a06b" }}
          />
          <span style={{ fontSize: 12, color: isAutoSend ? "var(--kaypal-v3-ink)" : "var(--kaypal-v3-muted)", fontWeight: isAutoSend ? 600 : 400 }}>
            自动执行
          </span>
        </div>
        <button
          type="button"
          className="mx-btn-gold"
          style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          <Save width={14} height={14} />
          {saving ? "正在保存…" : "保存"}
        </button>
      </div>
    );
  }

  /* 桌面端 */
  return (
    <V2Section title="默认发送策略">
      <div className="kaypal-v3-surface flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">默认发送策略</p>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                isAutoSend
                  ? "bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]"
                  : "bg-[var(--kaypal-v3-warning-soft)] text-[var(--kaypal-v3-warning)]"
              }`}
            >
              {isAutoSend ? "自动执行" : "确认后执行"}
            </span>
            {dirty && (
              <span className="inline-flex items-center rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-accent-ink)]">
                有改动未保存
              </span>
            )}
            {savedFlash && !dirty && (
              <span className="inline-flex items-center rounded-full bg-[var(--kaypal-v3-success-soft)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-success)]">
                已保存
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">{description}</p>
          <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
            建议日常使用自动执行；遇到目标不明确、风险内容、权限缺失或你主动切换时，再进入确认后执行。
          </p>
          {error && (
            <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{error}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${isAutoSend ? "text-[var(--kaypal-v3-muted)]" : "font-semibold text-[var(--kaypal-v3-warning)]"}`}>
            确认后执行
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--kaypal-v3-success)]"
            checked={isAutoSend}
            disabled={loading || saving}
            onChange={(e) => setDraft(e.target.checked ? "auto-send" : "approval-send")}
          />
          <span className={`text-sm ${isAutoSend ? "font-semibold text-[var(--kaypal-v3-success)]" : "text-[var(--kaypal-v3-muted)]"}`}>
            自动执行
          </span>
          <V2PrimaryButton
            icon={Save}
            loading={saving}
            disabled={!dirty || saving}
            onClick={save}
          >
            保存
          </V2PrimaryButton>
        </div>
      </div>
    </V2Section>
  );
}
