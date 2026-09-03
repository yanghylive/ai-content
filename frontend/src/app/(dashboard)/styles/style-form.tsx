"use client";

import { useConfirm } from "@/hooks/use-confirm";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "@/components/iconpark";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2Disclosure,
  V2OptionCard,
} from "@/components/v2/ui-kit";
import { stylesApi, type Style } from "@/lib/api/styles";
import { toPublicError } from "@/lib/public-error";
import { FileText, Image as ImageIcon, LayoutTemplate, BookOpen } from "@/components/iconpark";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

const TYPE_OPTIONS = [
  { value: "article", label: "文章", desc: "图文内容", icon: FileText },
  { value: "image", label: "图片", desc: "配图和海报", icon: ImageIcon },
  { value: "template", label: "模板", desc: "可复用的内容结构", icon: LayoutTemplate },
  { value: "xiaohongshu", label: "小红书", desc: "小红书笔记风格", icon: BookOpen },
] as const;

export function StyleForm({
  styleId,
  fixedType,
}: {
  styleId?: string;
  fixedType?: Style["type"];
}) {
  const { confirm, modal } = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(styleId));

  const [form, setForm] = useState({
    name: "",
    description: "",
    promptTemplate: "",
    type: (fixedType || "article") as Style["type"],
    isDefault: false,
  });

  const loadStyle = useCallback(async () => {
    if (!styleId) return;
    try {
      setLoading(true);
      const data = await stylesApi.getById(styleId);
      setForm({
        name: data.name,
        description: data.description || "",
        promptTemplate: data.promptTemplate || "",
        type: data.type,
        isDefault: data.isDefault,
      });
    } catch (err: unknown) {
      setError(toPublicError(err, "加载风格失败"));
    } finally {
      setLoading(false);
    }
  }, [styleId]);

  useEffect(() => {
    void loadStyle();
  }, [loadStyle]);

  const canSubmit = form.name.trim() && form.promptTemplate.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (styleId) {
        await stylesApi.update(styleId, form);
      } else {
        await stylesApi.create(form);
      }
      router.push(fixedType === "template" ? "/templates" : "/styles");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!styleId) return;
    const ok = await confirm({ kind: "danger", title: "删除样式", description: "确定删除吗？删除后无法恢复。" });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await stylesApi.remove(styleId);
      router.push(fixedType === "template" ? "/templates" : "/styles");
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const backHref = fixedType === "template" ? "/templates" : "/styles";
  const pageTitle = fixedType === "template" ? "模板" : "风格";

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <SkeletonList rows={5} />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
    );
  }

  /* 移动端原生视图（mx-* 明德 VP 风格）——一改转 4 页（styles|templates 的 new|edit） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push(backHref)} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回{pageTitle}列表
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>{styleId ? `编辑${pageTitle}` : `新建${pageTitle}`}</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>带 * 的是必填项</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 类型 */}
          {!fixedType && (
            <>
              <div className="mx-section-head" style={{ marginTop: 14 }}>类型</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {TYPE_OPTIONS.map(({ value, label, desc, icon: TypeIcon }) => {
                  const selected = form.type === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, type: value }))}
                      className="mx-card"
                      style={{ padding: 11, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                    >
                      <TypeIcon width={16} height={16} style={{ color: "var(--kaypal-v3-amber)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>{label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", lineHeight: 1.4 }}>{desc}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* 基础信息 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>基础信息</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>{pageTitle}名称 *</span>
              <input
                placeholder={`例如：${form.type === "xiaohongshu" ? "种草笔记风" : "专业测评风"}`}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }}
              />
            </label>
            <label style={{ display: "block", marginTop: 11 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>风格指令 *</span>
              <textarea
                placeholder="例如：语言亲切口语化，多用真实场景和感受，避免硬广腔；开头用提问吸引注意"
                value={form.promptTemplate}
                onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
                rows={4}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5, resize: "vertical", lineHeight: 1.6 }}
              />
              <span style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)" }}>告诉 AI 你希望的语言风格，越具体越好</span>
            </label>
          </div>

          {/* 补充 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>补充说明（可选）</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <textarea
              placeholder="补充说明这个风格的用途"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              style={{ width: "100%", padding: "9px 11px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5, resize: "vertical", lineHeight: 1.55 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 12.5, color: "var(--kaypal-v3-ink)" }}>设为默认{pageTitle}</span>
            </label>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push(backHref)} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            {styleId && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(220,80,80,.12)", color: "var(--kaypal-v3-danger)", border: "1px solid rgba(220,80,80,.35)", fontSize: 12.5, fontWeight: 600 }}
              >
                删除
              </button>
            )}
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!canSubmit || saving}
              onClick={() => void handleSubmit()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : styleId ? "保存修改" : `创建${pageTitle}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {modal}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {styleId ? `编辑${pageTitle}` : `新建${pageTitle}`}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              带 * 的是必填项
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {!fixedType && (
        <V2Section title="类型" description="这个风格用在什么内容上">
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_OPTIONS.map(({ value, label, desc, icon }) => (
              <V2OptionCard
                key={value}
                icon={icon}
                title={label}
                description={desc}
                selected={form.type === value}
                onClick={() => setForm((p) => ({ ...p, type: value }))}
              />
            ))}
          </div>
        </V2Section>
      )}

      <V2Section title="基础信息">
        <div className="grid gap-5">
          <V2Field label={`${pageTitle}名称`} required hint="给自己看的名字">
            <V2Input
              placeholder={`例如：${form.type === "xiaohongshu" ? "种草笔记风" : "专业测评风"}`}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </V2Field>

          <V2Field
            label="风格指令"
            required
            hint="告诉 AI 你希望的语言风格，越具体越好"
          >
            <V2Textarea
              placeholder="例如：语言亲切口语化，多用真实场景和感受，避免硬广腔；开头用提问吸引注意"
              value={form.promptTemplate}
              onChange={(e) =>
                setForm((p) => ({ ...p, promptTemplate: e.target.value }))
              }
            />
          </V2Field>
        </div>
      </V2Section>

      <V2Section>
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="风格描述">
              <V2Textarea
                placeholder="补充说明这个风格的用途"
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </V2Field>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
                checked={form.isDefault}
                onChange={(e) =>
                  setForm((p) => ({ ...p, isDefault: e.target.checked }))
                }
              />
              <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                设为默认{pageTitle}
              </span>
            </label>
          </div>
        </V2Disclosure>
      </V2Section>

      <section className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push(backHref)}>
            返回
          </V2GhostButton>
          {styleId && (
            <V2GhostButton onClick={() => void handleDelete()}>删除</V2GhostButton>
          )}
        </div>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : styleId ? "保存修改" : `创建${pageTitle}`}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
