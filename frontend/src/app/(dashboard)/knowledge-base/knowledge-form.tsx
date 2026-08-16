"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, Save, Sparkles } from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import { kaypalApi } from "@/lib/api/auth";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/** 从内容首行/首句自动提炼标题 */
function suggestTitle(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";
  const firstSentence = firstLine.split(/[。！？.!?]/)[0] || firstLine;
  return firstSentence.slice(0, 20);
}

export function KnowledgeForm() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({
    title: "",
    content: "",
    syncCloud: true,
  });

  // 智能默认值：用户没动过标题时，从内容自动生成
  const handleContentChange = (content: string) => {
    setForm((prev) => ({
      ...prev,
      content,
      title: titleTouched ? prev.title : suggestTitle(content),
    }));
  };

  const canSubmit = form.content.trim().length >= 10;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await kaypalApi.createKnowledgeText({
        title: form.title || undefined,
        content: form.content,
        syncCloud: form.syncCloud,
      });
      router.push("/knowledge-base");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await kaypalApi.uploadKnowledgeFile(formData);
      router.push("/knowledge-base");
    } catch (err: unknown) {
      setError(toPublicError(err, "文件未上传，请重试。"));
    } finally {
      setUploading(false);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——knowledge-base/new */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/knowledge-base")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回知识库
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>新增知识</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>粘贴你的产品资料、FAQ、案例——AI 写内容时会用上</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 知识内容 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>知识内容</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>内容 *</span>
              <textarea
                rows={8}
                placeholder="粘贴你的产品资料、FAQ 或案例内容…"
                value={form.content}
                onChange={(e) => handleContentChange(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, resize: "vertical", lineHeight: 1.6 }}
              />
              <span style={{ fontSize: 10.5, color: "var(--mx-muted)" }}>产品参数、常见问题、客户案例、品牌介绍都可以</span>
            </label>
            <label style={{ display: "block", marginTop: 11 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>标题</span>
              <div style={{ position: "relative", marginTop: 6 }}>
                <input
                  placeholder="自动从内容生成"
                  value={form.title}
                  onChange={(e) => {
                    setTitleTouched(true);
                    setForm((p) => ({ ...p, title: e.target.value }));
                  }}
                  style={{ width: "100%", padding: "10px 52px 10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 13 }}
                />
                {!titleTouched && form.title && (
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#d98a2d" }}>
                    <Sparkles width={11} height={11} /> 自动
                  </span>
                )}
              </div>
              <span style={{ fontSize: 10.5, color: "var(--mx-muted)" }}>已从内容自动取了一个，不满意可以改</span>
            </label>
          </div>

          {/* 上传文件 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>或上传知识文件</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ fontSize: 12, color: "var(--mx-muted)" }}
            />
            {file ? (
              <p style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 6 }}>{file.name} · {Math.ceil(file.size / 1024)} KB</p>
            ) : null}
            <button
              type="button"
              className="mx-btn-gold"
              style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!file || uploading}
              onClick={() => void handleUploadFile()}
            >
              <FileUp width={14} height={14} />
              {uploading ? "正在上传…" : "上传到本机知识库"}
            </button>
          </div>

          {/* 同步 */}
          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={form.syncCloud} onChange={(e) => setForm((p) => ({ ...p, syncCloud: e.target.checked }))} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>同步到云端（多设备可用）</span>
          </label>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => router.push("/knowledge-base")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!canSubmit || saving}
              onClick={() => void handleSubmit()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : "保存知识"}
            </button>
          </div>
        </div>
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
            onClick={() => router.push("/knowledge-base")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              新增知识
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              粘贴你的产品资料、FAQ、案例——AI 写内容时会用上
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 内容优先：用户只需粘贴，标题系统自动生成 */}
      <V2Section title="知识内容" description="直接粘贴文字就行，标题会自动帮你取">
        <div className="grid gap-5">
          <V2Field
            label="内容"
            required
            hint="产品参数、常见问题、客户案例、品牌介绍都可以"
          >
            <V2Textarea
              rows={10}
              placeholder="粘贴你的产品资料、FAQ 或案例内容..."
              value={form.content}
              onChange={(e) => handleContentChange(e.target.value)}
            />
          </V2Field>

          <V2Field
            label="标题"
            hint="已从内容自动取了一个，不满意可以改"
          >
            <div className="relative">
              <V2Input
                placeholder="自动从内容生成"
                value={form.title}
                onChange={(e) => {
                  setTitleTouched(true);
                  setForm((p) => ({ ...p, title: e.target.value }));
                }}
              />
              {!titleTouched && form.title && (
                <span className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-xs text-[var(--kaypal-v3-accent-ink)]">
                  <Sparkles className="h-3.5 w-3.5" />
                  自动
                </span>
              )}
            </div>
          </V2Field>
        </div>
      </V2Section>

      <V2Section title="或上传知识文件" description="文件会先保存到本机知识库，需要团队共享时在列表里同步到云端">
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            className="flex-1 text-sm text-[var(--kaypal-v3-muted)] file:mr-3 file:rounded-[var(--kaypal-v3-radius-sm)] file:border-0 file:bg-[var(--kaypal-v3-accent-soft)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--kaypal-v3-accent-ink)]"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <V2PrimaryButton
            icon={FileUp}
            loading={uploading}
            disabled={!file}
            onClick={handleUploadFile}
          >
            上传
          </V2PrimaryButton>
        </div>
        {file ? (
          <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
            {file.name} · {Math.ceil(file.size / 1024)} KB
          </p>
        ) : null}
      </V2Section>

      <V2Section>
        <V2Disclosure>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
              checked={form.syncCloud}
              onChange={(e) =>
                setForm((p) => ({ ...p, syncCloud: e.target.checked }))
              }
            />
            <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
              同步到云端（多设备可用）
            </span>
          </label>
        </V2Disclosure>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/knowledge-base")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : "保存知识"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
