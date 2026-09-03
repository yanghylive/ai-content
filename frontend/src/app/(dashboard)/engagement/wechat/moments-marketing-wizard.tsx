"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Heart,
  MessageSquareText,
  Shuffle,
  Sparkles,
  Target,
  TrendingUp,
} from "@/components/iconpark";

type MarketingStep = "audience" | "actions";
type MarketingMode = "random" | "targeted";

type MarketingFormData = {
  mode: MarketingMode;
  targetContacts: string;
  autoLike: boolean;
  autoComment: boolean;
  commentMode: "ai" | "fixed";
  fixedComment: string;
  customPrompt: string;
  dailyViewCount: number;
  executionTime: string;
};

export function MomentsMarketingWizard({
  onSubmit,
  onCancel,
}: {
  onSubmit?: (data: MarketingFormData) => void;
  onCancel?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState<MarketingStep>("audience");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 智能默认值（修正旧版错误默认：点赞/评论默认开启）
  const [formData, setFormData] = useState<MarketingFormData>(() => ({
    mode: "random",
    targetContacts: "",
    autoLike: true,
    autoComment: true,
    commentMode: "ai",
    fixedComment: "",
    customPrompt: "",
    dailyViewCount: 20,
    executionTime: "09:00",
  }));

  const targetCount = useMemo(
    () =>
      formData.targetContacts.split("\n").filter((line) => line.trim()).length,
    [formData.targetContacts],
  );

  const autoPlanName = useMemo(() => {
    const date = new Date().toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    return `${date} 朋友圈营销`;
  }, []);

  const canGoNext =
    currentStep === "audience"
      ? formData.mode === "random" || targetCount > 0
      : formData.autoLike ||
        (formData.autoComment &&
          (formData.commentMode === "ai" ||
            formData.fixedComment.trim().length > 0));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit?.(formData);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 步骤指示器 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-center gap-4">
          {[
            { key: "audience", title: "营销谁？" },
            { key: "actions", title: "做什么？" },
          ].map((step, index) => {
            const isActive =
              (currentStep === "audience" && index === 0) ||
              (currentStep === "actions" && index === 1);
            const isDone = currentStep === "actions" && index === 0;
            return (
              <div key={step.key} className="flex items-center gap-4">
                <div className="flex items-center gap-3">
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
                    className={`text-sm font-medium ${
                      isActive
                        ? "text-[var(--kaypal-v3-ink)]"
                        : "text-[var(--kaypal-v3-muted)]"
                    }`}
                  >
                    {step.title}
                  </p>
                </div>
                {index === 0 && (
                  <div
                    className={`h-0.5 w-16 rounded ${
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

      {/* 步骤 1: 营销谁 */}
      {currentStep === "audience" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            选择营销对象
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            计划名称将自动生成为：{autoPlanName}
          </p>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.mode === "random"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() => setFormData((prev) => ({ ...prev, mode: "random" }))}
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Shuffle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    随机浏览朋友圈（推荐新手）
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    系统随机浏览好友朋友圈并互动，最自然
                  </p>
                </div>
                {formData.mode === "random" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.mode === "targeted"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, mode: "targeted" }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Target className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    定向给指定好友
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    只浏览指定好友的朋友圈并互动
                  </p>
                </div>
                {formData.mode === "targeted" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            {formData.mode === "targeted" && (
              <>
                <textarea
                  className="h-32 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                  placeholder={"粘贴好友微信号，每行一个\nwxid_abc123"}
                  value={formData.targetContacts}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      targetContacts: e.target.value,
                    }))
                  }
                />
                {targetCount > 0 && (
                  <p className="text-sm text-[var(--kaypal-v3-muted)]">
                    已输入 {targetCount} 个好友
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* 步骤 2: 做什么 */}
      {currentStep === "actions" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            设置互动动作
          </h2>

          <div className="mt-6 space-y-3">
            {/* 自动点赞 */}
            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.autoLike
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, autoLike: !prev.autoLike }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Heart className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    自动点赞
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    浏览时自动给朋友圈点赞
                  </p>
                </div>
                <div
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                    formData.autoLike
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                >
                  <div className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
                </div>
              </div>
            </button>

            {/* 自动评论 */}
            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.autoComment
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  autoComment: !prev.autoComment,
                }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <MessageSquareText className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    自动评论
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    浏览时自动评论朋友圈
                  </p>
                </div>
                <div
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                    formData.autoComment
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                >
                  <div className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
                </div>
              </div>
            </button>

            {/* 评论方式（依赖自动评论开启） */}
            {formData.autoComment && (
              <div className="kaypal-v3-surface ml-6 space-y-3 p-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-2 text-sm font-medium transition ${
                      formData.commentMode === "ai"
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, commentMode: "ai" }))
                    }
                  >
                    <Sparkles className="h-4 w-4" />
                    AI 生成（推荐）
                  </button>
                  <button
                    type="button"
                    className={`rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-2 text-sm font-medium transition ${
                      formData.commentMode === "fixed"
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, commentMode: "fixed" }))
                    }
                  >
                    固定评论
                  </button>
                </div>

                {formData.commentMode === "fixed" && (
                  <textarea
                    className="h-20 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)]"
                    placeholder="输入固定评论内容"
                    value={formData.fixedComment}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        fixedComment: e.target.value,
                      }))
                    }
                  />
                )}
              </div>
            )}
          </div>

          {/* 执行频率 */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                每天执行
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="h-10 w-24 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                  value={formData.dailyViewCount}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      dailyViewCount: Number(e.target.value) || 20,
                    }))
                  }
                />
                <span className="text-sm text-[var(--kaypal-v3-muted)]">条</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                执行时间
              </span>
              <input
                type="time"
                className="mt-1 h-10 w-32 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                value={formData.executionTime}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    executionTime: e.target.value,
                  }))
                }
              />
            </label>
          </div>

          {/* 高级设置（渐进式披露） */}
          <div className="mt-6">
            <button
              type="button"
              className="text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "收起高级设置" : "自定义 AI 提示词（可选）"}
            </button>

            {showAdvanced && (
              <div className="kaypal-v3-surface mt-3 p-4">
                <textarea
                  className="h-24 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)]"
                  placeholder="告诉 AI 你希望评论的风格，例如：语气亲切，像朋友一样聊天"
                  value={formData.customPrompt}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      customPrompt: e.target.value,
                    }))
                  }
                />
              </div>
            )}
          </div>

          {/* 任务摘要 */}
          <div className="kaypal-v3-surface mt-6 p-4">
            <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
              任务摘要
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--kaypal-v3-muted)]">
              <li>计划名称：{autoPlanName}</li>
              <li>
                营销对象：
                {formData.mode === "random"
                  ? "随机浏览"
                  : `定向 ${targetCount} 个好友`}
              </li>
              <li>
                互动动作：
                {[
                  formData.autoLike ? "自动点赞" : null,
                  formData.autoComment
                    ? formData.commentMode === "ai"
                      ? "AI 评论"
                      : "固定评论"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || "（未选择）"}
              </li>
              <li>
                执行频率：每天 {formData.dailyViewCount} 条，{" "}
                {formData.executionTime} 开始
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <div>
          {currentStep === "actions" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={() => setCurrentStep("audience")}
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
          {currentStep === "actions" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              disabled={submitting || !canGoNext}
              onClick={handleSubmit}
            >
              <TrendingUp className="h-5 w-5" />
              {submitting ? "正在创建..." : "开始营销"}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              disabled={!canGoNext}
              onClick={() => setCurrentStep("actions")}
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
