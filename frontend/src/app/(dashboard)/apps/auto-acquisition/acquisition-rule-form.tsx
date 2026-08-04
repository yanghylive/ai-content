"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  MessageCircle,
  Music2,
  Save,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthPlatform } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

const PLATFORM_OPTIONS = [
  { value: "douyin", label: "抖音", desc: "评论区找客户", icon: Music2 },
  { value: "xiaohongshu", label: "小红书", desc: "笔记和评论", icon: BookOpen },
  { value: "wechat", label: "微信", desc: "微信群和朋友圈", icon: MessageCircle },
] as const;

export function AcquisitionRuleForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 智能默认值
  const [form, setForm] = useState({
    taskName: "",
    platform: "douyin" as GrowthPlatform,
    keywords: "",
    dailyLimit: 20,
    commentTemplate: "你好，看到你关注这个话题，我们正好在做这个，可以聊聊～",
    privateTemplate: "你好，我是{品牌}，看到你对我们这个领域感兴趣，方便加个微信详聊吗？",
    riskMode: "confirm-first" as "auto" | "confirm-first" | "draft-only",
    excludeKeywords: "",
    blacklistNicknames: "",
    perTargetLimit: 3,
    scheduleEnabled: false,
    beginTime: "09:00",
  });

  // 任务名自动生成
  const keywords = form.keywords
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const autoTaskName =
    form.taskName ||
    (keywords.length > 0
      ? `${PLATFORM_OPTIONS.find((p) => p.value === form.platform)?.label}获客：${keywords[0]}`
      : "");

  const canSubmit = keywords.length > 0 && form.dailyLimit > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await growthApi.createConfig({
        taskName: autoTaskName,
        platform: form.platform,
        sourceInputs: keywords,
        includeKeywords: keywords,
        excludeKeywords: form.excludeKeywords
          .split(/[,，\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        commentTemplates: [form.commentTemplate],
        privateMessageTemplates: [form.privateTemplate],
        dailyLimit: form.dailyLimit,
        perTargetLimit: form.perTargetLimit,
        deduplicate: true,
        blacklistNicknames: form.blacklistNicknames
          .split(/[,，\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        scheduleEnabled: form.scheduleEnabled,
        beginTime: form.scheduleEnabled ? form.beginTime : "",
        riskMode: form.riskMode,
        status: "enabled",
      });
      router.push("/apps/auto-acquisition");
    } catch (err: unknown) {
      setError(toPublicError(err, "创建获客任务失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/apps/auto-acquisition")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              新建获客任务
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              告诉系统你的客户在哪，它自动帮你去找
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：平台 */}
      <V2Section title="第 1 步：你的客户在哪个平台？">
        <div className="grid gap-3 sm:grid-cols-3">
          {PLATFORM_OPTIONS.map(({ value, label, desc, icon }) => (
            <V2OptionCard
              key={value}
              icon={icon}
              title={label}
              description={desc}
              selected={form.platform === value}
              onClick={() => setForm((p) => ({ ...p, platform: value }))}
            />
          ))}
        </div>
      </V2Section>

      {/* 第 2 步：关键词 */}
      <V2Section title="第 2 步：他们会搜/聊什么词？">
        <V2Field
          label="关键词"
          required
          hint="你的客户会关注的话题词，逗号分隔。系统会去找聊这些词的人"
        >
          <V2Textarea
            placeholder="例如：空气净化器, 除甲醛, 新房装修"
            value={form.keywords}
            onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
          />
        </V2Field>
        {keywords.length > 0 && (
          <p className="mt-2 text-sm text-[var(--kaypal-v3-success)]">
            ✓ 将监控 {keywords.length} 个关键词：{keywords.join("、")}
          </p>
        )}
      </V2Section>

      {/* 第 3 步：说什么 */}
      <V2Section title="第 3 步：找到后说什么？" description="已帮你写好一版，改成你的风格">
        <div className="grid gap-5">
          <V2Field label="评论话术" hint="在对方内容下的第一条评论">
            <V2Textarea
              value={form.commentTemplate}
              onChange={(e) =>
                setForm((p) => ({ ...p, commentTemplate: e.target.value }))
              }
            />
          </V2Field>
          <V2Field label="私信话术" hint="对方回复后的私信">
            <V2Textarea
              value={form.privateTemplate}
              onChange={(e) =>
                setForm((p) => ({ ...p, privateTemplate: e.target.value }))
              }
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 高级设置 */}
      <V2Section>
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="每天最多触达" hint="建议 10-30，太多容易被平台限制">
              <V2Input
                type="number"
                min={1}
                max={100}
                value={form.dailyLimit}
                onChange={(e) =>
                  setForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))
                }
              />
            </V2Field>
            <V2Field label="排除关键词" hint="含这些词的人不触达，逗号分隔">
              <V2Input
                placeholder="例如：同行, 广告"
                value={form.excludeKeywords}
                onChange={(e) =>
                  setForm((p) => ({ ...p, excludeKeywords: e.target.value }))
                }
              />
            </V2Field>
            <V2Field label="昵称黑名单" hint="命中这些昵称的人跳过不碰，逗号分隔">
              <V2Input
                placeholder="例如：某某官方旗舰店"
                value={form.blacklistNicknames}
                onChange={(e) =>
                  setForm((p) => ({ ...p, blacklistNicknames: e.target.value }))
                }
              />
            </V2Field>
            <V2Field label="同一个人最多触达几次" hint="防骚扰，建议 1-3 次">
              <V2Input
                type="number"
                min={1}
                max={10}
                value={form.perTargetLimit}
                onChange={(e) =>
                  setForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))
                }
              />
            </V2Field>
            <V2Field label="定时启动" hint="开启后每天在固定时间自动跑一轮">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                  checked={form.scheduleEnabled}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))
                  }
                />
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">每天</span>
                <V2Input
                  type="time"
                  value={form.beginTime}
                  disabled={!form.scheduleEnabled}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, beginTime: e.target.value }))
                  }
                />
                <span className="text-sm text-[var(--kaypal-v3-muted)]">自动执行</span>
              </div>
            </V2Field>
            <V2Field label="发送方式">
              <div className="grid gap-2">
                {[
                  { value: "confirm-first" as const, label: "每条都先给我确认（推荐）" },
                  { value: "draft-only" as const, label: "只存草稿，我自己发" },
                  { value: "auto" as const, label: "自动发送（高风险）" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="riskMode"
                      className="h-4 w-4"
                      checked={form.riskMode === opt.value}
                      onChange={() => setForm((p) => ({ ...p, riskMode: opt.value }))}
                    />
                    <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </V2Field>
          </div>
        </V2Disclosure>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/apps/auto-acquisition")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在创建..." : "创建获客任务"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
