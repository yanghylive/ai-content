"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Image as ImageIcon,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

type MomentsStep = "content" | "media" | "schedule" | "confirm";

type MomentsFormData = {
  content: string;
  mediaPaths: string[];
  scheduleType: "immediate" | "in-10-min" | "custom";
  customTime: string;
  visibility: "public" | "private";
};

const LAST_MOMENTS_KEY = "wechat:last-moments-content";

function loadLastContent(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LAST_MOMENTS_KEY) || "";
  } catch {
    return "";
  }
}

export function MomentsPublishWizard({
  onSubmit,
  onCancel,
}: {
  onSubmit?: (data: MomentsFormData) => void;
  onCancel?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState<MomentsStep>("content");
  const [mediaInput, setMediaInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 智能默认值
  const [formData, setFormData] = useState<MomentsFormData>(() => ({
    content: loadLastContent(),
    mediaPaths: [],
    scheduleType: "immediate",
    customTime: "",
    visibility: "public",
  }));

  const steps: Array<{ key: MomentsStep; title: string }> = [
    { key: "content", title: "写什么？" },
    { key: "media", title: "配什么图？" },
    { key: "schedule", title: "什么时候发？" },
    { key: "confirm", title: "确认发布" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);

  // 自动生成的计划名称
  const autoPlanName = useMemo(() => {
    const date = new Date().toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    return `${date} 朋友圈发布`;
  }, []);

  const canGoNext = useMemo(() => {
    if (currentStep === "content") return formData.content.trim().length > 0;
    if (currentStep === "media") return true; // 图片可选
    if (currentStep === "schedule") {
      return formData.scheduleType !== "custom" || Boolean(formData.customTime);
    }
    return true;
  }, [currentStep, formData]);

  const handleNext = () => {
    if (!canGoNext) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) setCurrentStep(steps[nextIndex].key);
  };

  const handlePrevious = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) setCurrentStep(steps[prevIndex].key);
  };

  const addMedia = () => {
    const path = mediaInput.trim();
    if (!path) return;
    setFormData((prev) => ({
      ...prev,
      mediaPaths: [...prev.mediaPaths, path],
    }));
    setMediaInput("");
  };

  const removeMedia = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      mediaPaths: prev.mediaPaths.filter((_, i) => i !== index),
    }));
  };

  const scheduleLabel = useMemo(() => {
    if (formData.scheduleType === "immediate") return "立即发布";
    if (formData.scheduleType === "in-10-min") return "10 分钟后发布";
    return `定时 ${formData.customTime || "（未选择）"}`;
  }, [formData.scheduleType, formData.customTime]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      localStorage.setItem(LAST_MOMENTS_KEY, formData.content);
      await onSubmit?.(formData);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 步骤指示器 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isDone = index < currentStepIndex;
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${
                      isDone
                        ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success)] text-white"
                        : isActive
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent)] text-white"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)]"
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                  </div>
                  <p
                    className={`mt-2 text-center text-sm font-medium ${
                      isActive
                        ? "text-[var(--kaypal-v3-ink)]"
                        : "text-[var(--kaypal-v3-muted)]"
                    }`}
                  >
                    {step.title}
                  </p>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`mx-4 h-0.5 flex-1 rounded ${
                      isDone
                        ? "bg-[var(--kaypal-v3-success)]"
                        : "bg-[var(--kaypal-v3-border)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 步骤 1: 写什么 */}
      {currentStep === "content" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            输入朋友圈文案
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            计划名称将自动生成为：{autoPlanName}
          </p>

          <div className="mt-6">
            <textarea
              className="h-48 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder="输入朋友圈文案..."
              value={formData.content}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, content: e.target.value }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--kaypal-v3-muted)]">
              <span>{formData.content.length} 字</span>
              {formData.content.trim() && (
                <span className="inline-flex items-center gap-1 text-[var(--kaypal-v3-success)]">
                  <CheckCircle2 className="h-4 w-4" />
                  文案已填写
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
              onClick={() => {
                const last = loadLastContent();
                if (last) {
                  setFormData((prev) => ({ ...prev, content: last }));
                }
              }}
            >
              <Clock className="h-4 w-4" />
              用上次的文案
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              <Sparkles className="h-4 w-4" />
              AI 帮我写
            </button>
          </div>
        </section>
      )}

      {/* 步骤 2: 配什么图 */}
      {currentStep === "media" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            添加图片
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            可选，最多 9 张。不添加则发布纯文字朋友圈
          </p>

          <div className="mt-6 flex gap-3">
            <input
              className="h-12 flex-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder="粘贴素材路径或图片链接"
              value={mediaInput}
              onChange={(e) => setMediaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addMedia();
              }}
            />
            <button
              type="button"
              className="inline-flex h-12 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={!mediaInput.trim() || formData.mediaPaths.length >= 9}
              onClick={addMedia}
            >
              <ImageIcon className="h-4 w-4" />
              添加
            </button>
          </div>

          {formData.mediaPaths.length > 0 && (
            <div className="mt-4 space-y-2">
              {formData.mediaPaths.map((path, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ImageIcon className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]" />
                    <span className="truncate text-sm text-[var(--kaypal-v3-soft-ink)]">
                      {path}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-danger)]"
                    onClick={() => removeMedia(index)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <p className="text-sm text-[var(--kaypal-v3-muted)]">
                已添加 {formData.mediaPaths.length}/9 张
              </p>
            </div>
          )}
        </section>
      )}

      {/* 步骤 3: 什么时候发 */}
      {currentStep === "schedule" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            选择发布时间
          </h2>

          <div className="mt-6 space-y-3">
            {(
              [
                {
                  key: "immediate",
                  icon: Zap,
                  title: "立即发布（推荐）",
                  desc: "确认后立即发布到朋友圈",
                },
                {
                  key: "in-10-min",
                  icon: Clock,
                  title: "10 分钟后",
                  desc: "留出最后检查的时间",
                },
                {
                  key: "custom",
                  icon: Clock,
                  title: "自定义时间",
                  desc: "选择具体的发布时间",
                },
              ] as const
            ).map(({ key, icon: Icon, title, desc }) => (
              <button
                key={key}
                type="button"
                className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                  formData.scheduleType === key
                    ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                    : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
                }`}
                onClick={() =>
                  setFormData((prev) => ({ ...prev, scheduleType: key }))
                }
              >
                <div className="flex items-center gap-3">
                  <div className="kaypal-v3-icon-tile">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--kaypal-v3-ink)]">
                      {title}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                      {desc}
                    </p>
                  </div>
                  {formData.scheduleType === key && (
                    <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                  )}
                </div>
              </button>
            ))}

            {formData.scheduleType === "custom" && (
              <input
                type="datetime-local"
                className="h-12 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                value={formData.customTime}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    customTime: e.target.value,
                  }))
                }
              />
            )}
          </div>

          {/* 可见范围 */}
          <div className="mt-6">
            <label className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                可见范围
              </span>
              <select
                className="h-10 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                value={formData.visibility}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    visibility: e.target.value as "public" | "private",
                  }))
                }
              >
                <option value="public">公开（推荐）</option>
                <option value="private">仅自己可见</option>
              </select>
            </label>
          </div>
        </section>
      )}

      {/* 步骤 4: 确认发布 */}
      {currentStep === "confirm" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            确认发布
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            请检查以下内容，确认无误后点击发布
          </p>

          {/* 预览卡片 */}
          <div className="mt-6 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                <ImageIcon className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--kaypal-v3-ink)]">我</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--kaypal-v3-ink)]">
                  {formData.content}
                </p>
                {formData.mediaPaths.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {formData.mediaPaths.map((_, index) => (
                      <div
                        key={index}
                        className="flex aspect-square items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)]"
                      >
                        <ImageIcon className="h-6 w-6 text-[var(--kaypal-v3-muted)]" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 发布摘要 */}
          <div className="kaypal-v3-surface mt-4 p-4">
            <ul className="space-y-1 text-sm text-[var(--kaypal-v3-muted)]">
              <li>计划名称：{autoPlanName}</li>
              <li>文案长度：{formData.content.length} 字</li>
              <li>配图数量：{formData.mediaPaths.length} 张</li>
              <li>发布时间：{scheduleLabel}</li>
              <li>
                可见范围：
                {formData.visibility === "public" ? "公开" : "仅自己可见"}
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <div>
          {currentStepIndex > 0 ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={handlePrevious}
            >
              <ArrowLeft className="h-4 w-4" />
              上一步
            </button>
          ) : (
            onCancel && (
              <button
                type="button"
                className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={onCancel}
              >
                返回
              </button>
            )
          )}
        </div>

        <div>
          {currentStep === "confirm" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={submitting}
              onClick={handleSubmit}
            >
              <Send className="h-5 w-5" />
              {submitting ? "正在发布..." : "发布"}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={!canGoNext}
              onClick={handleNext}
            >
              下一步
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
