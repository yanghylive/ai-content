"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BellRing,
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
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
