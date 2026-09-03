"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Send,
  Sparkles,
  Users,
  Zap,
} from "@/components/iconpark";

type MassSendStep = "recipients" | "content" | "schedule";
type RecipientsType = "all" | "manual";

type MassSendFormData = {
  recipientsType: RecipientsType;
  manualNumbers: string;
  message: string;
  scheduleType: "immediate" | "scheduled";
  scheduledTime: string;
  dailyLimit: number;
  intervalSeconds: number;
  enableSegmentation: boolean;
};

const LAST_MESSAGE_KEY = "wechat:last-message:mass-send";

function loadLastMessage(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LAST_MESSAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function MassSendWizard({
  totalContacts = 0,
  onSubmit,
  onCancel,
}: {
  totalContacts?: number;
  onSubmit?: (data: MassSendFormData) => void;
  onCancel?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState<MassSendStep>("recipients");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 智能默认值
  const [formData, setFormData] = useState<MassSendFormData>(() => ({
    recipientsType: "all",
    manualNumbers: "",
    message: loadLastMessage(),
    scheduleType: "immediate",
    scheduledTime: "",
    dailyLimit: 20,
    intervalSeconds: 30,
    enableSegmentation: true,
  }));

  const steps: Array<{
    key: MassSendStep;
    title: string;
    description: string;
  }> = [
    { key: "recipients", title: "发给谁？", description: "选择接收消息的联系人" },
    { key: "content", title: "发什么？", description: "输入消息内容" },
    { key: "schedule", title: "什么时候发？", description: "选择发送时间" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);

  const manualCount = useMemo(
    () => formData.manualNumbers.split("\n").filter((line) => line.trim()).length,
    [formData.manualNumbers],
  );

  const recipientCount =
    formData.recipientsType === "all" ? totalContacts : manualCount;

  // 自动生成的计划名称（智能默认值）
  const autoPlanName = useMemo(() => {
    const date = new Date().toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    return `${date} 群发给 ${recipientCount.toLocaleString()} 人`;
  }, [recipientCount]);

  const canGoNext = useMemo(() => {
    if (currentStep === "recipients") {
      if (formData.recipientsType === "all") return totalContacts > 0;
      return manualCount > 0;
    }
    if (currentStep === "content") {
      return formData.message.trim().length > 0;
    }
    return true;
  }, [currentStep, formData.recipientsType, formData.message, totalContacts, manualCount]);

  const handleNext = () => {
    if (!canGoNext) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].key);
    }
  };

  const handlePrevious = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].key);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      localStorage.setItem(LAST_MESSAGE_KEY, formData.message);
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
                  <div className="mt-2 text-center">
                    <p
                      className={`text-sm font-medium ${
                        isActive
                          ? "text-[var(--kaypal-v3-ink)]"
                          : "text-[var(--kaypal-v3-muted)]"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="mt-0.5 hidden text-xs text-[var(--kaypal-v3-muted)] sm:block">
                      {step.description}
                    </p>
                  </div>
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

      {/* 步骤 1: 发给谁 */}
      {currentStep === "recipients" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            选择接收人
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            计划名称将自动生成为：{autoPlanName}
          </p>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.recipientsType === "all"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, recipientsType: "all" }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Users className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    全部联系人（推荐）
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    发给已同步的 {totalContacts.toLocaleString()} 个联系人
                  </p>
                </div>
                {formData.recipientsType === "all" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.recipientsType === "manual"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, recipientsType: "manual" }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    手动输入
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    粘贴微信号或手机号，每行一个
                  </p>
                </div>
                {formData.recipientsType === "manual" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            {formData.recipientsType === "manual" && (
              <textarea
                className="h-32 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                placeholder={"wxid_abc123\n13800001111\nwxid_def456"}
                value={formData.manualNumbers}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    manualNumbers: e.target.value,
                  }))
                }
              />
            )}

            {formData.recipientsType === "manual" && manualCount > 0 && (
              <p className="text-sm text-[var(--kaypal-v3-muted)]">
                已输入 {manualCount} 个号码
              </p>
            )}

            {formData.recipientsType === "all" && totalContacts === 0 && (
              <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4">
                <p className="text-sm text-[var(--kaypal-v3-amber)]">
                  还没有同步联系人，请先到"联系人管理"同步，或选择手动输入
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 步骤 2: 发什么 */}
      {currentStep === "content" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            输入消息内容
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            将发送给 {recipientCount.toLocaleString()} 个联系人
          </p>

          <div className="mt-6">
            <textarea
              className="h-48 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder="输入要发送的消息内容..."
              value={formData.message}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, message: e.target.value }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--kaypal-v3-muted)]">
              <span>{formData.message.length} 字</span>
              {formData.message.trim() && (
                <span className="inline-flex items-center gap-1 text-[var(--kaypal-v3-success)]">
                  <CheckCircle2 className="h-4 w-4" />
                  内容已填写
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
              onClick={() => {
                const last = loadLastMessage();
                if (last) {
                  setFormData((prev) => ({ ...prev, message: last }));
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
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              <ImageIcon className="h-4 w-4" />
              添加图片/文件
            </button>
          </div>
        </section>
      )}

      {/* 步骤 3: 什么时候发 */}
      {currentStep === "schedule" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            选择发送时间
          </h2>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.scheduleType === "immediate"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, scheduleType: "immediate" }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    立即发送（推荐）
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    确认后立即开始群发
                  </p>
                </div>
                {formData.scheduleType === "immediate" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            <button
              type="button"
              className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
                formData.scheduleType === "scheduled"
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, scheduleType: "scheduled" }))
              }
            >
              <div className="flex items-center gap-3">
                <div className="kaypal-v3-icon-tile">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    定时发送
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    在指定时间自动开始
                  </p>
                </div>
                {formData.scheduleType === "scheduled" && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
                )}
              </div>
            </button>

            {formData.scheduleType === "scheduled" && (
              <input
                type="datetime-local"
                className="h-12 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                value={formData.scheduledTime}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    scheduledTime: e.target.value,
                  }))
                }
              />
            )}
          </div>

          {/* 高级设置（渐进式披露） */}
          <div className="mt-6">
            <button
              type="button"
              className="text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "收起高级设置" : "高级设置（可选）"}
            </button>

            {showAdvanced && (
              <div className="kaypal-v3-surface mt-3 grid gap-4 p-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    每日上限
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.dailyLimit}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        dailyLimit: Number(e.target.value) || 20,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    发送间隔（秒）
                  </span>
                  <input
                    type="number"
                    min={5}
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.intervalSeconds}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        intervalSeconds: Number(e.target.value) || 30,
                      }))
                    }
                  />
                </label>
                <label className="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
                    checked={formData.enableSegmentation}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        enableSegmentation: e.target.checked,
                      }))
                    }
                  />
                  <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                    分段发送（防风控）
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* 发送摘要 */}
          <div className="kaypal-v3-surface mt-6 p-4">
            <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
              发送摘要
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--kaypal-v3-muted)]">
              <li>计划名称：{autoPlanName}</li>
              <li>接收人：{recipientCount.toLocaleString()} 个联系人</li>
              <li>内容长度：{formData.message.length} 字</li>
              <li>
                发送方式：
                {formData.scheduleType === "immediate"
                  ? "立即发送"
                  : `定时 ${formData.scheduledTime || "（未选择时间）"}`}
              </li>
              <li>
                风控参数：每日上限 {formData.dailyLimit}，间隔{" "}
                {formData.intervalSeconds} 秒
                {formData.enableSegmentation ? "，分段发送" : ""}
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
          {currentStep === "schedule" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              disabled={
                submitting ||
                (formData.scheduleType === "scheduled" &&
                  !formData.scheduledTime)
              }
              onClick={handleSubmit}
            >
              <Send className="h-5 w-5" />
              {submitting ? "正在创建..." : "开始群发"}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
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
