"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Sparkle } from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { topicsApi } from "@/lib/api/topics";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function TopicForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    keywords: "",
  });

  const canSubmit = form.title.trim().length >= 4;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await topicsApi.create({
        title: form.title,
        description: form.description || undefined,
        sourceType: "manual",
        keywords: form.keywords
          .split(/[,，\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
      });
      router.push("/topics");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  if (isMobile) {
    const inputStyle = { width: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 13, border: "1px solid var(--kaypal-v3-border)", outline: "none", background: "var(--kaypal-v3-paper)", color: "var(--kaypal-v3-ink)" };
    const fieldLabel = { fontSize: 12, fontWeight: 700, color: "var(--kaypal-v3-muted)", marginBottom: 6 };
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--kaypal-v3-ink)", flexShrink: 0 }} onClick={() => router.push("/topics")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="mx-page-title" style={{ fontSize: 20 }}>新增选题</h1>
              <p className="mx-page-sub">想到一个好选题？一句话记下来就行</p>
            </div>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-danger-soft)", fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</div>
          )}

          <div className="mx-card" style={{ padding: 16 }}>
            <div className="mx-section-title" style={{ marginBottom: 14 }}>
              <span className="mx-sec-icon"><Sparkle /></span>
              选题内容
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={fieldLabel}>选题标题 <span style={{ fontWeight: 400, color: "var(--kaypal-v3-danger)" }}>*</span></p>
              <input placeholder="例如：为什么 90% 的人选空气净化器都买错了" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} />
              <p style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>一句话说清楚要写什么</p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={fieldLabel}>补充说明 <span style={{ fontWeight: 400, color: "var(--kaypal-v3-muted)" }}>（可选）</span></p>
              <textarea placeholder="例如：从滤芯成本角度切入，对比 3 款热门机型" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
              <p style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>可选：这个选题的角度、素材线索</p>
            </div>

            <div style={{ marginBottom: 6 }}>
              <p style={fieldLabel}>关键词 <span style={{ fontWeight: 400, color: "var(--kaypal-v3-muted)" }}>（可选）</span></p>
              <input placeholder="例如：空气净化器, 滤芯, 避坑" value={form.keywords} onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))} style={inputStyle} />
              <p style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>逗号分隔，帮助 AI 生成时聚焦</p>
            </div>
          </div>

          <button type="button" className="mx-btn-gold" style={{ width: "100%", fontSize: 13, padding: "12px 0", marginTop: 16, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit || saving} onClick={handleSubmit}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" style={{ marginRight: 4 }}><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z" /><path d="M14 3v4a2 2 0 0 0 2 2h4" /></svg>
            {saving ? "正在保存…" : "保存选题"}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/topics")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              新增选题
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              想到一个好选题？一句话记下来就行
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section title="选题内容">
        <div className="grid gap-5">
          <V2Field label="选题标题" required hint="一句话说清楚要写什么">
            <V2Input
              placeholder="例如：为什么 90% 的人选空气净化器都买错了"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            />
          </V2Field>

          <V2Field label="补充说明" hint="可选：这个选题的角度、素材线索">
            <V2Textarea
              placeholder="例如：从滤芯成本角度切入，对比 3 款热门机型"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
            />
          </V2Field>

          <V2Field label="关键词" hint="可选：逗号分隔，帮助 AI 生成时聚焦">
            <V2Input
              placeholder="例如：空气净化器, 滤芯, 避坑"
              value={form.keywords}
              onChange={(e) =>
                setForm((p) => ({ ...p, keywords: e.target.value }))
              }
            />
          </V2Field>
        </div>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/topics")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : "保存选题"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
