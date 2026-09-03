"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  UserRoundCheck,
  Users,
} from "@/components/iconpark";

type FriendApplication = {
  id: string;
  nickname: string;
  message: string;
  appliedAt: string;
};

type FriendAcceptFormData = {
  selectedIds: string[];
  welcomeMessage: string;
  sendWelcome: boolean;
  remarkStrategy: "request_name" | "phone_wechat" | "custom";
  customRemark: string;
};

const LAST_WELCOME_KEY = "wechat:last-welcome-message";
const DEFAULT_WELCOME = "你好，很高兴认识你";

function loadLastWelcome(): string {
  if (typeof window === "undefined") return DEFAULT_WELCOME;
  try {
    return localStorage.getItem(LAST_WELCOME_KEY) || DEFAULT_WELCOME;
  } catch {
    return DEFAULT_WELCOME;
  }
}

export function FriendAcceptPanel({
  applications = [],
  onSubmit,
  onCancel,
}: {
  applications?: FriendApplication[];
  onSubmit?: (data: FriendAcceptFormData) => void;
  onCancel?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  // 智能默认值：默认全选、欢迎语复用上次、备注沿用申请名
  const [formData, setFormData] = useState<FriendAcceptFormData>(() => ({
    selectedIds: applications.map((a) => a.id),
    welcomeMessage: loadLastWelcome(),
    sendWelcome: true,
    remarkStrategy: "request_name",
    customRemark: "",
  }));

  const allSelected =
    applications.length > 0 &&
    formData.selectedIds.length === applications.length;

  const toggleAll = () => {
    setFormData((prev) => ({
      ...prev,
      selectedIds: allSelected ? [] : applications.map((a) => a.id),
    }));
  };

  const toggleOne = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedIds: prev.selectedIds.includes(id)
        ? prev.selectedIds.filter((x) => x !== id)
        : [...prev.selectedIds, id],
    }));
  };

  const selectedCount = formData.selectedIds.length;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (formData.sendWelcome) {
        localStorage.setItem(LAST_WELCOME_KEY, formData.welcomeMessage);
      }
      await onSubmit?.(formData);
    } finally {
      setSubmitting(false);
    }
  };

  // 空状态
  if (applications.length === 0) {
    return (
      <div className="kaypal-v2-wechat flex flex-col gap-6">
        <section className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-paper-muted)]">
            <UserRoundCheck className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            暂无待处理的好友申请
          </h3>
          <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
            有新的好友申请时会显示在这里
          </p>
          {onCancel && (
            <button
              type="button"
              className="mt-6 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={onCancel}
            >
              返回任务中心
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 待处理申请列表 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              通过好友申请
            </h2>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              当前有 {applications.length} 个待处理申请
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-[var(--kaypal-v3-accent)] transition hover:text-[var(--kaypal-v3-accent-ink)]"
            onClick={toggleAll}
          >
            {allSelected ? "取消全选" : "全选"}
          </button>
        </div>

        <div className="mt-4 divide-y divide-[var(--kaypal-v3-border)] rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)]">
          {applications.map((app) => {
            const checked = formData.selectedIds.includes(app.id);
            return (
              <button
                key={app.id}
                type="button"
                className={`flex w-full items-center gap-4 p-4 text-left transition ${
                  checked
                    ? "bg-[var(--kaypal-v3-accent-soft)]"
                    : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                }`}
                onClick={() => toggleOne(app.id)}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                    checked
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent)]"
                      : "border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper)]"
                  }`}
                >
                  {checked && <CheckCircle2 className="h-4 w-4 text-white" />}
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-paper-muted)]">
                  <Users className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                    {app.nickname}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
                    申请语：{app.message}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--kaypal-v3-muted)]">
                  {app.appliedAt}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 通过后设置 */}
      <section className="kaypal-v3-panel p-6">
        <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
          通过后
        </h3>

        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
              checked={formData.sendWelcome}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  sendWelcome: e.target.checked,
                }))
              }
            />
            <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
              发送欢迎语
            </span>
          </label>

          {formData.sendWelcome && (
            <textarea
              className="h-24 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder="你好，很高兴认识你"
              value={formData.welcomeMessage}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  welcomeMessage: e.target.value,
                }))
              }
            />
          )}

          <label className="block">
            <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
              备注方式
            </span>
            <select
              className="mt-2 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)] sm:max-w-xs"
              value={formData.remarkStrategy}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  remarkStrategy: e.target
                    .value as FriendAcceptFormData["remarkStrategy"],
                }))
              }
            >
              <option value="request_name">沿用申请名（推荐）</option>
              <option value="phone_wechat">电话/微信</option>
              <option value="custom">统一备注</option>
            </select>
          </label>

          {formData.remarkStrategy === "custom" && (
            <input
              className="h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)] sm:max-w-xs"
              placeholder="输入统一备注内容"
              value={formData.customRemark}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  customRemark: e.target.value,
                }))
              }
            />
          )}
        </div>
      </section>

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <div>
          {onCancel && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={onCancel}
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </button>
          )}
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
          disabled={submitting || selectedCount === 0}
          onClick={handleSubmit}
        >
          <UserRoundCheck className="h-5 w-5" />
          {submitting ? "正在处理..." : `通过选中的 ${selectedCount} 人`}
        </button>
      </section>
    </div>
  );
}
