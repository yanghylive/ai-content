"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  Send,
} from "lucide-react";
import {
  submitInquiry,
  type ContactType,
} from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { ApiError } from "@/lib/api/client";

/**
 * 咨询表单（M5 · 复用后端 POST /v1/inquiries）。
 *
 * 字段：称呼 / 联系方式类型 / 联系方式 / 需求简述 / 公司 / 职位 / 期望沟通时间 / 隐私同意。
 * - 提交中禁用按钮防重复提交；
 * - 成功后显示咨询编号与后续沟通说明；
 * - 失败时保留非敏感内容，字段级错误提示；
 * - 隐私同意不预选。
 */

const CONTACT_TYPE_OPTIONS: Array<{ value: ContactType; label: string }> = [
  { value: "phone", label: "手机号" },
  { value: "email", label: "邮箱" },
  { value: "wechat", label: "微信号" },
  { value: "other", label: "其他" },
];

interface InquiryFormProps {
  sourceCaseSlug?: string;
  sourceCollectionSlug?: string;
  channelCode?: string;
}

interface FormState {
  name: string;
  contactType: ContactType;
  contactValue: string;
  message: string;
  company: string;
  position: string;
  preferredTime: string;
  consent: boolean;
}

const INITIAL_FORM: FormState = {
  name: "",
  contactType: "phone",
  contactValue: "",
  message: "",
  company: "",
  position: "",
  preferredTime: "",
  consent: false,
};

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.name.trim();
  if (!name) errors.name = "请填写您的称呼";
  else if (name.length < 2) errors.name = "称呼至少 2 个字";
  else if (name.length > 30) errors.name = "称呼不超过 30 个字";

  const contact = form.contactValue.trim();
  if (!contact) errors.contactValue = "请填写联系方式";
  else if (form.contactType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    errors.contactValue = "邮箱格式不正确";
  }

  const message = form.message.trim();
  if (!message) errors.message = "请简述您的需求";
  else if (message.length < 10) errors.message = "需求简述至少 10 个字";
  else if (message.length > 1000) errors.message = "需求简述不超过 1000 个字";

  if (!form.consent) errors.consent = "请先同意隐私政策与联系用途";

  return errors;
}

export function InquiryForm({
  sourceCaseSlug,
  sourceCollectionSlug,
  channelCode,
}: InquiryFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;

    const fieldErrors = validate(form);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setStatus("submitting");
    setSubmitError(null);
    try {
      const result = await submitInquiry({
        name: form.name.trim(),
        contactType: form.contactType,
        contactValue: form.contactValue.trim(),
        message: form.message.trim(),
        company: form.company.trim() || undefined,
        position: form.position.trim() || undefined,
        preferredTime: form.preferredTime.trim() || undefined,
        consent: form.consent,
        sourceCaseSlug,
        sourceCollectionSlug,
        channelCode,
      });
      setInquiryId(result.inquiryId ?? null);
      setStatus("success");
      // 提交成功上报 inquiry_submit（仅 inquiry_id + 来源 + 渠道，不落联系方式/需求正文/客户名）
      trackCaseEvent("inquiry_submit", {
        inquiry_id: result.inquiryId,
        source_case_slug: sourceCaseSlug,
        source_collection_slug: sourceCollectionSlug,
        channel_code: channelCode,
      });
    } catch (error) {
      // 失败保留非敏感内容，仅提示错误，避免用户全部重填
      const message =
        error instanceof ApiError
          ? error.message
          : "提交失败，请稍后重试";
      setSubmitError(message);
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="kaypal-v3-panel flex flex-col items-center gap-3 p-8 text-center">
        <span
          className="kaypal-v3-icon-tile"
          style={{
            background: "var(--kaypal-v3-success-soft)",
            color: "var(--kaypal-v3-success)",
            height: 48,
            width: 48,
          }}
        >
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <h3 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
          咨询已提交
        </h3>
        {inquiryId && (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            咨询编号：
            <span className="font-semibold text-[var(--kaypal-v3-accent-ink)]">
              {inquiryId}
            </span>
          </p>
        )}
        <p className="max-w-md text-sm leading-6 text-[var(--kaypal-v3-muted)]">
          我们已收到您的需求，将在 1-2 个工作日内与您联系。如需进一步补充，
          可再次提交或通过官网渠道联系我们。
        </p>
      </div>
    );
  }

  const fieldClass = (hasError: boolean) =>
    `w-full rounded-[var(--kaypal-v3-radius-sm)] border bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] ${
      hasError ? "border-[var(--kaypal-v3-danger)]" : "border-[var(--kaypal-v3-border)]"
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
            称呼 <span className="text-[var(--kaypal-v3-danger)]">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="如：张先生"
            maxLength={30}
            className={fieldClass(!!errors.name)}
            aria-invalid={!!errors.name}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{errors.name}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
            联系方式类型
          </label>
          <select
            value={form.contactType}
            onChange={(e) => setField("contactType", e.target.value as ContactType)}
            className={fieldClass(false)}
          >
            {CONTACT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
          联系方式 <span className="text-[var(--kaypal-v3-danger)]">*</span>
        </label>
        <input
          type="text"
          value={form.contactValue}
          onChange={(e) => setField("contactValue", e.target.value)}
          placeholder={form.contactType === "email" ? "you@example.com" : "请输入您的联系方式"}
          maxLength={500}
          className={fieldClass(!!errors.contactValue)}
          aria-invalid={!!errors.contactValue}
        />
        {errors.contactValue && (
          <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{errors.contactValue}</p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
          需求简述 <span className="text-[var(--kaypal-v3-danger)]">*</span>
        </label>
        <textarea
          value={form.message}
          onChange={(e) => setField("message", e.target.value)}
          placeholder="请简要描述您的业务场景与需求（10-1000 字）"
          rows={4}
          maxLength={1000}
          className={fieldClass(!!errors.message)}
          aria-invalid={!!errors.message}
        />
        {errors.message && (
          <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{errors.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
            公司/组织
          </label>
          <input
            type="text"
            value={form.company}
            onChange={(e) => setField("company", e.target.value)}
            placeholder="选填"
            maxLength={200}
            className={fieldClass(false)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
            职位
          </label>
          <input
            type="text"
            value={form.position}
            onChange={(e) => setField("position", e.target.value)}
            placeholder="选填"
            maxLength={50}
            className={fieldClass(false)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
          期望沟通时间
        </label>
        <input
          type="text"
          value={form.preferredTime}
          onChange={(e) => setField("preferredTime", e.target.value)}
          placeholder="如：工作日下午 / 本周四上午"
          maxLength={200}
          className={fieldClass(false)}
        />
      </div>

      <div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => setField("consent", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--kaypal-v3-accent)]"
          />
          <span>
            我已阅读并同意
            <span className="font-medium text-[var(--kaypal-v3-accent-ink)]">
              《隐私政策》
            </span>
            ，同意九章智能为联系我而使用以上信息
            <span className="text-[var(--kaypal-v3-danger)]"> *</span>
          </span>
        </label>
        {errors.consent && (
          <p className="mt-1 text-xs text-[var(--kaypal-v3-danger)]">{errors.consent}</p>
        )}
      </div>

      {status === "error" && submitError && (
        <div
          className="rounded-[var(--kaypal-v3-radius-sm)] px-3 py-2 text-sm"
          style={{
            background: "var(--kaypal-v3-danger-soft)",
            color: "var(--kaypal-v3-danger)",
          }}
        >
          {submitError}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              提交中…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden />
              提交咨询
            </>
          )}
        </button>
        <p className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          您的联系方式将被加密存储，仅用于本次咨询联系
        </p>
      </div>
    </form>
  );
}

/** 咨询入口（CTA 区块 + 展开的表单），供详情页/合集页底部复用 */
export function InquiryCta({
  sourceCaseSlug,
  sourceCollectionSlug,
  channelCode,
  title = "有同类业务需求？",
  description = "告诉我们你的场景，九章智能帮你评估可落地的方案。",
}: {
  sourceCaseSlug?: string;
  sourceCollectionSlug?: string;
  channelCode?: string;
  title?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="kaypal-v3-panel p-6 sm:p-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) {
              trackCaseEvent("inquiry_start", {
                source_case_slug: sourceCaseSlug,
                source_collection_slug: sourceCollectionSlug,
              });
            }
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          <Mail className="h-4 w-4" aria-hidden />
          {open ? "收起表单" : "咨询同类项目"}
        </button>
      </div>
      {open && (
        <div className="mt-6 border-t border-[var(--kaypal-v3-border)] pt-6">
          <InquiryForm
            sourceCaseSlug={sourceCaseSlug}
            sourceCollectionSlug={sourceCollectionSlug}
            channelCode={channelCode}
          />
        </div>
      )}
    </section>
  );
}
