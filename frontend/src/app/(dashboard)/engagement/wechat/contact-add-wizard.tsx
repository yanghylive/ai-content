"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  ShieldAlert,
  Upload,
  UserRoundPlus,
} from "lucide-react";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type ContactAddStep = "targets" | "message";

type ContactAddFormData = {
  numbers: string;
  verifyMessage: string;
  dailyLimit: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  remarkStrategy: "request_name" | "phone_wechat" | "custom";
  customRemark: string;
};

const LAST_VERIFY_KEY = "wechat:last-verify-message";

const VERIFY_TEMPLATES = [
  "朋友推荐，想跟你聊聊",
  "我是 XX 公司的小王，想认识一下",
  "看到你的分享很有收获，想交流学习",
];

function loadLastVerifyMessage(): string {
  if (typeof window === "undefined") return VERIFY_TEMPLATES[0];
  try {
    return localStorage.getItem(LAST_VERIFY_KEY) || VERIFY_TEMPLATES[0];
  } catch {
    return VERIFY_TEMPLATES[0];
  }
}

export function ContactAddWizard({
  onSubmit,
  onCancel,
}: {
  onSubmit?: (data: ContactAddFormData) => void;
  onCancel?: () => void;
}) {
  const isMobile = useIsMobile();
  const [currentStep, setCurrentStep] = useState<ContactAddStep>("targets");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 智能默认值
  const [formData, setFormData] = useState<ContactAddFormData>(() => ({
    numbers: "",
    verifyMessage: loadLastVerifyMessage(),
    dailyLimit: 15,
    minIntervalSeconds: 60,
    maxIntervalSeconds: 120,
    remarkStrategy: "request_name",
    customRemark: "",
  }));

  const numberCount = useMemo(
    () => formData.numbers.split("\n").filter((line) => line.trim()).length,
    [formData.numbers],
  );

  // 自动生成的计划名称
  const autoPlanName = useMemo(() => {
    const date = new Date().toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    return `${date} 加好友 ${numberCount} 人`;
  }, [numberCount]);

  const canGoNext =
    currentStep === "targets"
      ? numberCount > 0
      : formData.verifyMessage.trim().length > 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      localStorage.setItem(LAST_VERIFY_KEY, formData.verifyMessage);
      await onSubmit?.(formData);
    } finally {
      setSubmitting(false);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——两步向导 */
  if (isMobile) {
    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "9px 11px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--mx-ink)",
      fontSize: 12.5,
    };
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">添加好友</div>
            <div className="mx-page-sub">第 {currentStep === "targets" ? 1 : 2} / 2 步 · {currentStep === "targets" ? "加谁？" : "说什么？"}</div>
          </div>

          {/* 步骤条 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 99, background: "var(--kaypal-v3-amber)" }} />
            <div style={{ flex: 1, height: 4, borderRadius: 99, background: currentStep === "message" ? "var(--kaypal-v3-amber)" : "rgba(142,165,190,.3)" }} />
          </div>

          {currentStep === "targets" && (
            <>
              <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--mx-ink)" }}>粘贴要添加的号码</h2>
                <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 3 }}>计划名称将自动生成为：{autoPlanName}</p>
                <textarea
                  value={formData.numbers}
                  onChange={(e) => setFormData((prev) => ({ ...prev, numbers: e.target.value }))}
                  placeholder={"粘贴手机号或微信号，每行一个\n13800001111\nwxid_abc123"}
                  rows={7}
                  style={{ ...inputStyle, marginTop: 10, minHeight: 130, resize: "vertical", lineHeight: 1.6 }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7, fontSize: 11.5, color: "var(--mx-muted)" }}>
                  <span>已输入 {numberCount} 个号码</span>
                  {numberCount > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--kaypal-v3-success)", fontWeight: 600 }}>
                      <CheckCircle2 width={13} height={13} /> 可以下一步
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                <button type="button" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Upload width={14} height={14} /> 从 Excel 导入
                </button>
                <button type="button" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Download width={14} height={14} /> 下载模板
                </button>
              </div>
            </>
          )}

          {currentStep === "message" && (
            <>
              <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--mx-ink)" }}>设置验证消息</h2>
                <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 3 }}>将向 {numberCount} 个号码发送好友申请</p>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 9, padding: 10, borderRadius: 10, background: "rgba(222,150,57,.1)", border: "1px solid rgba(222,150,57,.35)" }}>
                  <ShieldAlert width={16} height={16} style={{ color: "var(--kaypal-v3-amber)", flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-amber)", lineHeight: 1.5 }}>加好友是高风险操作，建议 24 小时内不超过 15 人。系统已默认按安全参数执行。</p>
                </div>
                <label style={{ display: "block", marginTop: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>验证消息</span>
                  <textarea
                    value={formData.verifyMessage}
                    onChange={(e) => setFormData((prev) => ({ ...prev, verifyMessage: e.target.value }))}
                    placeholder="我是..."
                    rows={3}
                    style={{ ...inputStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
                  />
                </label>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)", marginTop: 10 }}>常用模板</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                  {VERIFY_TEMPLATES.map((template) => (
                    <button
                      key={template}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, verifyMessage: template }))}
                      style={{ padding: "6px 11px", borderRadius: 9, fontSize: 11.5, fontWeight: 500, background: formData.verifyMessage === template ? "rgba(246,196,120,.18)" : "rgba(120,148,179,.12)", color: formData.verifyMessage === template ? "var(--kaypal-v3-amber)" : "var(--mx-ink)", border: "1px solid " + (formData.verifyMessage === template ? "rgba(222,150,57,.45)" : "rgba(142,165,190,.3)") }}
                    >
                      {template}
                    </button>
                  ))}
                </div>

                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--mx-muted)", background: "none", border: "none", padding: 0 }}>
                  {showAdvanced ? "收起高级设置" : "高级设置（可选）"}
                </button>
                {showAdvanced && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 9 }}>
                    <label style={{ display: "block" }}>
                      <span style={{ fontSize: 11.5, color: "var(--mx-muted)" }}>24 小时上限</span>
                      <input type="number" min={1} max={20} value={formData.dailyLimit} onChange={(e) => setFormData((prev) => ({ ...prev, dailyLimit: Number(e.target.value) || 15 }))} style={{ ...inputStyle, marginTop: 5 }} />
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ fontSize: 11.5, color: "var(--mx-muted)" }}>备注策略</span>
                      <select value={formData.remarkStrategy} onChange={(e) => setFormData((prev) => ({ ...prev, remarkStrategy: e.target.value as ContactAddFormData["remarkStrategy"] }))} style={{ ...inputStyle, marginTop: 5 }}>
                        <option value="request_name">沿用申请名</option>
                        <option value="phone_wechat">电话/微信</option>
                        <option value="custom">统一备注</option>
                      </select>
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ fontSize: 11.5, color: "var(--mx-muted)" }}>最小间隔（秒）</span>
                      <input type="number" min={30} value={formData.minIntervalSeconds} onChange={(e) => setFormData((prev) => ({ ...prev, minIntervalSeconds: Number(e.target.value) || 60 }))} style={{ ...inputStyle, marginTop: 5 }} />
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ fontSize: 11.5, color: "var(--mx-muted)" }}>最大间隔（秒）</span>
                      <input type="number" min={60} value={formData.maxIntervalSeconds} onChange={(e) => setFormData((prev) => ({ ...prev, maxIntervalSeconds: Number(e.target.value) || 120 }))} style={{ ...inputStyle, marginTop: 5 }} />
                    </label>
                  </div>
                )}

                {/* 任务摘要 */}
                <div style={{ marginTop: 12, padding: 11, borderRadius: 10, background: "rgba(120,148,179,.08)" }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--mx-ink)" }}>任务摘要</p>
                  <ul style={{ marginTop: 5, fontSize: 11.5, color: "var(--mx-muted)", lineHeight: 1.7 }}>
                    <li>计划名称：{autoPlanName}</li>
                    <li>添加人数：{numberCount} 人</li>
                    <li>验证消息：{formData.verifyMessage || "（未填写）"}</li>
                    <li>风控参数：24h 上限 {formData.dailyLimit} 人，间隔 {formData.minIntervalSeconds}-{formData.maxIntervalSeconds} 秒</li>
                  </ul>
                </div>
              </div>
            </>
          )}

          {/* 底部操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {currentStep === "message" ? (
              <>
                <button type="button" onClick={() => setCurrentStep("targets")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <ArrowLeft width={14} height={14} /> 上一步
                </button>
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  disabled={submitting || !canGoNext}
                  onClick={() => void handleSubmit()}
                >
                  <UserRoundPlus width={15} height={15} />
                  {submitting ? "正在创建…" : `开始添加 ${numberCount} 人`}
                </button>
              </>
            ) : (
              <>
                {onCancel && (
                  <button type="button" onClick={onCancel} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
                    返回
                  </button>
                )}
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  disabled={!canGoNext}
                  onClick={() => setCurrentStep("message")}
                >
                  下一步 <ArrowRight width={14} height={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 步骤指示器 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-center gap-4">
          {[
            { key: "targets", title: "加谁？" },
            { key: "message", title: "说什么？" },
          ].map((step, index) => {
            const isActive =
              (currentStep === "targets" && index === 0) ||
              (currentStep === "message" && index === 1);
            const isDone = currentStep === "message" && index === 0;
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

      {/* 步骤 1: 加谁 */}
      {currentStep === "targets" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            粘贴要添加的号码
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            计划名称将自动生成为：{autoPlanName}
          </p>

          <div className="mt-6">
            <textarea
              className="h-56 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder={"粘贴手机号或微信号，每行一个\n13800001111\nwxid_abc123"}
              value={formData.numbers}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, numbers: e.target.value }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--kaypal-v3-muted)]">
              <span>已输入 {numberCount} 个号码</span>
              {numberCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[var(--kaypal-v3-success)]">
                  <CheckCircle2 className="h-4 w-4" />
                  可以下一步
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              <Upload className="h-4 w-4" />
              从 Excel 导入
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              <Download className="h-4 w-4" />
              下载导入模板
            </button>
          </div>
        </section>
      )}

      {/* 步骤 2: 说什么 */}
      {currentStep === "message" && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            设置验证消息
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            将向 {numberCount} 个号码发送好友申请
          </p>

          {/* 事前风险提示（替代事后弹窗） */}
          <div className="mt-4 flex items-start gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--kaypal-v3-amber)]" />
            <p className="text-sm text-[var(--kaypal-v3-amber)]">
              加好友是高风险操作，建议 24 小时内不超过 15 人。系统已默认按安全参数执行。
            </p>
          </div>

          <div className="mt-6">
            <label className="block">
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                验证消息
              </span>
              <textarea
                className="mt-2 h-28 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] p-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                placeholder="我是..."
                value={formData.verifyMessage}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    verifyMessage: e.target.value,
                  }))
                }
              />
            </label>
          </div>

          {/* 常用模板 */}
          <div className="mt-4">
            <p className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
              常用模板
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {VERIFY_TEMPLATES.map((template) => (
                <button
                  key={template}
                  type="button"
                  className={`rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-2 text-sm font-medium transition ${
                    formData.verifyMessage === template
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, verifyMessage: template }))
                  }
                >
                  {template}
                </button>
              ))}
            </div>
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
              <div className="kaypal-v3-surface mt-3 grid gap-4 p-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    24 小时上限
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.dailyLimit}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        dailyLimit: Number(e.target.value) || 15,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    备注策略
                  </span>
                  <select
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.remarkStrategy}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        remarkStrategy: e.target
                          .value as ContactAddFormData["remarkStrategy"],
                      }))
                    }
                  >
                    <option value="request_name">沿用申请名</option>
                    <option value="phone_wechat">电话/微信</option>
                    <option value="custom">统一备注</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    最小间隔（秒）
                  </span>
                  <input
                    type="number"
                    min={30}
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.minIntervalSeconds}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        minIntervalSeconds: Number(e.target.value) || 60,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    最大间隔（秒）
                  </span>
                  <input
                    type="number"
                    min={60}
                    className="mt-1 h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
                    value={formData.maxIntervalSeconds}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        maxIntervalSeconds: Number(e.target.value) || 120,
                      }))
                    }
                  />
                </label>
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
              <li>添加人数：{numberCount} 人</li>
              <li>验证消息：{formData.verifyMessage || "（未填写）"}</li>
              <li>
                风控参数：24 小时上限 {formData.dailyLimit} 人，间隔{" "}
                {formData.minIntervalSeconds}-{formData.maxIntervalSeconds} 秒
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <div>
          {currentStep === "message" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={() => setCurrentStep("targets")}
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
          {currentStep === "message" ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={submitting || !canGoNext}
              onClick={handleSubmit}
            >
              <UserRoundPlus className="h-5 w-5" />
              {submitting ? "正在创建..." : `开始添加 ${numberCount} 人`}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={!canGoNext}
              onClick={() => setCurrentStep("message")}
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
