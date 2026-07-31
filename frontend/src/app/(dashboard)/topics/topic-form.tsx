"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
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
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/topics")}>
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
