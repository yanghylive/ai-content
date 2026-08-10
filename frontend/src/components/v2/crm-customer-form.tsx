"use client";

import { useCallback, useState } from "react";
import { Loader2, Plus, UserRoundPlus, X } from "lucide-react";
import { createCrmCustomer, type CreateCrmCustomerInput } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "手动录入" },
  { value: "douyin", label: "抖音" },
  { value: "wechat", label: "微信" },
  { value: "wechat-channel", label: "视频号" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "growth", label: "增长获客" },
];

const inputCls =
  "w-full rounded-lg border border-default-200 bg-background px-3 py-2 text-sm text-default-900 outline-none transition placeholder:text-default-400 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 dark:border-default-800";

/**
 * CRM v2 内嵌「新增客户」表单弹窗——不跳 legacy，同页完成创建。
 */
export function CrmCustomerFormModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (customerId: string) => void;
}) {
  const [form, setForm] = useState<CreateCrmCustomerInput>({
    displayName: "",
    companyName: "",
    phone: "",
    wechat: "",
    sourcePlatform: "manual",
    tags: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(
    <K extends keyof CreateCrmCustomerInput>(key: K, value: CreateCrmCustomerInput[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    setForm({
      displayName: "",
      companyName: "",
      phone: "",
      wechat: "",
      sourcePlatform: "manual",
      tags: [],
    });
    setError(null);
  }, []);

  const submit = async () => {
    const name = form.displayName.trim();
    if (!name) {
      setError("请填写客户姓名或昵称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createCrmCustomer({
        ...form,
        displayName: name,
        companyName: form.companyName?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        wechat: form.wechat?.trim() || undefined,
      });
      reset();
      onCreated?.(created.id);
      onClose();
    } catch (err) {
      setError(toPublicError(err, "创建客户失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新增客户"
        className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-default-200 bg-background shadow-xl sm:max-w-md sm:rounded-2xl dark:border-default-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-default-100 px-5 py-4 dark:border-default-800">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserRoundPlus className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-default-900">新增客户</h2>
              <p className="text-xs text-default-500">手动录入客户档案</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-default-400 transition hover:bg-default-100 hover:text-default-700"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-default-700 dark:text-default-300">
              姓名 / 昵称 <span className="text-danger">*</span>
            </label>
            <input
              className={inputCls}
              value={form.displayName ?? ""}
              placeholder="客户姓名或昵称"
              autoFocus
              onChange={(e) => set("displayName", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-default-700 dark:text-default-300">
              公司
            </label>
            <input
              className={inputCls}
              value={form.companyName ?? ""}
              placeholder="公司名称（可选）"
              onChange={(e) => set("companyName", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-default-700 dark:text-default-300">
                手机号
              </label>
              <input
                className={inputCls}
                value={form.phone ?? ""}
                placeholder="手机号（可选）"
                inputMode="tel"
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-default-700 dark:text-default-300">
                微信号
              </label>
              <input
                className={inputCls}
                value={form.wechat ?? ""}
                placeholder="微信号（可选）"
                onChange={(e) => set("wechat", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-default-700 dark:text-default-300">
              来源平台
            </label>
            <select
              className={inputCls}
              value={form.sourcePlatform ?? "manual"}
              onChange={(e) => set("sourcePlatform", e.target.value)}
            >
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-400">
              {error}
            </p>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2.5 border-t border-default-100 px-5 py-4 dark:border-default-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-default-200 px-4 py-2 text-sm font-medium text-default-700 transition hover:bg-default-100 dark:border-default-800 dark:text-default-300"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !form.displayName?.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {saving ? "创建中..." : "创建客户"}
          </button>
        </div>
      </div>
    </div>
  );
}
