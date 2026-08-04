"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
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
import { FileText, Image as ImageIcon, LayoutTemplate, BookOpen } from "lucide-react";

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
  const router = useRouter();
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

  const backHref = fixedType === "template" ? "/templates" : "/styles";
  const pageTitle = fixedType === "template" ? "模板" : "风格";

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
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
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
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
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push(backHref)}>
          返回
        </V2GhostButton>
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
