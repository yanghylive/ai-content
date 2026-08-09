"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);

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
