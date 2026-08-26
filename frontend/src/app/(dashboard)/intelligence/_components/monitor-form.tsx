"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Save,
  Search,
  UserRound,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import {
  intelligenceApi,
  type CreateIntelligenceMonitorInput,
} from "@/lib/api/intelligence";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const MONITOR_TYPES = [
  { value: "keyword", label: "关键词监控", desc: "盯着你关心的词", icon: Search },
  { value: "account", label: "账号监控", desc: "盯着某个博主/竞品", icon: UserRound },
  { value: "industry", label: "行业监控", desc: "盯着整个行业动态", icon: Building2 },
] as const;

// schedule 转人话
const FREQ_PRESETS = [
  { label: "每 30 分钟", value: "*/30 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "每天 12:00", value: "0 12 * * *" },
  { label: "每天 18:00", value: "0 18 * * *" },
] as const;

const PLATFORM_OPTIONS = [
  { value: "", label: "全部平台" },
  { value: "douyin", label: "抖音" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "gongzhonghao", label: "公众号" },
  { value: "bilibili", label: "B站" },
];

const INDUSTRY_OPTIONS = ["通用", "电商", "教育", "餐饮", "美业", "房产", "金融", "科技"];

export function MonitorForm() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 智能默认值：关键词监控 + 每小时 + 全部平台
  const [form, setForm] = useState({
    type: "keyword",
    keyword: "",
    platform: "",
    industry: "通用",
    schedule: "0 * * * *",
    costLimit: "",
  });

  const canSubmit =
    form.type === "industry" ? true : form.keyword.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const input: CreateIntelligenceMonitorInput = {
        type: form.type,
        schedule: form.schedule,
        platform: form.platform || undefined,
        keyword: form.type === "industry" ? form.industry : form.keyword.trim(),
        industry: form.type === "industry" ? form.industry : undefined,
        costLimitPoints: form.costLimit ? Number(form.costLimit) : undefined,
      };
      await intelligenceApi.createMonitor(input);
      router.push("/intelligence/monitors");
    } catch (err: unknown) {
      setError(toPublicError(err, "创建监控失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const keywordLabel =
    form.type === "keyword" ? "监控关键词" : form.type === "account" ? "账号名/链接" : "";

  /* 移动端原生视图（mx-* 明德 VP 风格）——intelligence-v2/monitor-new */
  if (isMobile) {
    const fieldStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--kaypal-v3-ink)",
      fontSize: 13,
    };
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/intelligence/monitors")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回监控列表
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>新建监控</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>三步：选类型 → 填对象 → 定频率</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 第 1 步：类型 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>第 1 步：监控什么？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {MONITOR_TYPES.map(({ value, label, desc, icon: TypeIcon }) => {
              const selected = form.type === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, type: value }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>
                    <TypeIcon width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 1 }}>{desc}</span>
                  </span>
                  {selected && <span style={{ color: "var(--kaypal-v3-amber)", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 第 2 步：对象 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 2 步：盯什么？</div>
          {form.type === "industry" ? (
            <select value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} style={fieldStyle}>
              {INDUSTRY_OPTIONS.map((ind) => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                placeholder={form.type === "keyword" ? "例如：空气净化器" : "例如：@某博主 或主页链接"}
                value={form.keyword}
                onChange={(e) => setForm((p) => ({ ...p, keyword: e.target.value }))}
                style={fieldStyle}
              />
              <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>
                {form.type === "keyword" ? "例如：你的品牌名、产品词、竞品词" : "粘贴对方主页链接或账号名"}
              </p>
            </>
          )}

          {/* 第 3 步：频率 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 3 步：多久看一次？</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {FREQ_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setForm((p) => ({ ...p, schedule: preset.value }))}
                style={{ padding: "7px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: form.schedule === preset.value ? "rgba(246,196,120,.18)" : "rgba(120,148,179,.12)", color: form.schedule === preset.value ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-ink)", border: "1px solid " + (form.schedule === preset.value ? "rgba(222,150,57,.5)" : "rgba(142,165,190,.3)") }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* 高级设置 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>高级设置（可选）</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>限定平台</span>
              <select value={form.platform} onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }}>
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>每日花费上限（积分）</span>
              <input type="number" placeholder="不限" value={form.costLimit} onChange={(e) => setForm((p) => ({ ...p, costLimit: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/intelligence/monitors")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!canSubmit || saving}
              onClick={() => void handleSubmit()}
            >
              <Save width={15} height={15} />
              {saving ? "正在创建…" : "创建监控"}
            </button>
          </div>
        </div>
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
            onClick={() => router.push("/intelligence/monitors")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              新建监控
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              三步：选类型 → 填对象 → 定频率
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：类型 */}
      <V2Section title="第 1 步：监控什么？">
        <div className="grid gap-3 sm:grid-cols-3">
          {MONITOR_TYPES.map(({ value, label, desc, icon }) => (
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

      {/* 第 2 步：对象 */}
      <V2Section title="第 2 步：盯什么？">
        {form.type === "industry" ? (
          <V2Field label="行业" required>
            <V2Select
              value={form.industry}
              onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))}
            >
              {INDUSTRY_OPTIONS.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </V2Select>
          </V2Field>
        ) : (
          <V2Field
            label={keywordLabel}
            required
            hint={form.type === "keyword" ? "例如：你的品牌名、产品词、竞品词" : "粘贴对方主页链接或账号名"}
          >
            <V2Input
              placeholder={form.type === "keyword" ? "例如：空气净化器" : "例如：@某博主 或主页链接"}
              value={form.keyword}
              onChange={(e) => setForm((p) => ({ ...p, keyword: e.target.value }))}
            />
          </V2Field>
        )}
      </V2Section>

      {/* 第 3 步：频率 */}
      <V2Section title="第 3 步：多久看一次？">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {FREQ_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={`rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2.5 text-sm font-medium transition ${
                form.schedule === preset.value
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() => setForm((p) => ({ ...p, schedule: preset.value }))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </V2Section>

      {/* 高级（可选） */}
      <V2Section>
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="限定平台">
              <V2Select
                value={form.platform}
                onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value }))}
              >
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </V2Select>
            </V2Field>
            <V2Field label="每日花费上限（积分）" hint="可选：控制监控成本">
              <V2Input
                type="number"
                placeholder="不限"
                value={form.costLimit}
                onChange={(e) => setForm((p) => ({ ...p, costLimit: e.target.value }))}
              />
            </V2Field>
          </div>
        </V2Disclosure>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/intelligence/monitors")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在创建..." : "创建监控"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
