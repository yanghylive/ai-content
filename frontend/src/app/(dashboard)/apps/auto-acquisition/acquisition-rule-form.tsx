"use client";

import { useEffect, useState } from "react";
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
import { growthApi, type GrowthAccountHealth, type GrowthPlatform } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const PLATFORM_OPTIONS = [
  { value: "douyin", label: "抖音", desc: "评论区找客户", icon: Music2 },
  { value: "xiaohongshu", label: "小红书", desc: "笔记和评论", icon: BookOpen },
  { value: "wechat", label: "微信", desc: "微信群和朋友圈", icon: MessageCircle },
] as const;

export function AcquisitionRuleForm() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 执行账号：自动拉取账号健康列表，默认选中该平台 online+normal 的真实账号
  const [accounts, setAccounts] = useState<GrowthAccountHealth[]>([]);
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    growthApi
      .listAccountHealth()
      .then((list) => {
        if (cancelled) return;
        const next = Array.isArray(list) ? list : [];
        setAccounts(next);
        const preferred = next.find(
          (a) =>
            a.platform === "douyin" &&
            a.loginStatus === "online" &&
            a.riskStatus === "normal",
        );
        const fallback = next[0];
        const chosen = preferred || fallback;
        if (chosen) {
          setAccountId(chosen.accountId);
          setAccountName(chosen.accountName);
        }
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!accountId) {
      setError("请先选择执行账号（账号健康列表为空或未加载到可用账号）");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await growthApi.createConfig({
        taskName: autoTaskName,
        platform: form.platform,
        accountId,
        accountName,
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

  /* 移动端原生视图（mx-* 明德 VP 风格）——auto-acquisition-v2/create */
  if (isMobile) {
    const fieldStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--mx-ink)",
      fontSize: 13,
    };
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <button type="button" onClick={() => router.push("/apps/auto-acquisition")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, marginBottom: 6 }}>
              <ArrowLeft width={14} height={14} /> 返回获客任务
            </button>
            <div className="mx-page-title">新建获客任务</div>
            <div className="mx-page-sub">告诉系统你的客户在哪，它自动帮你去找</div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 第 1 步：平台 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>第 1 步：客户在哪个平台？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PLATFORM_OPTIONS.map(({ value, label, desc, icon: PlatformIcon }) => {
              const selected = form.platform === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, platform: value }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "#d98a2d", flexShrink: 0 }}>
                    <PlatformIcon width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1 }}>{desc}</span>
                  </span>
                  {selected && <span style={{ color: "#d98a2d", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 执行账号（移动端） */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>执行账号</div>
          {accountsLoading ? (
            <p style={{ fontSize: 12, color: "var(--mx-muted)" }}>正在加载账号…</p>
          ) : accounts.length === 0 ? (
            <p style={{ fontSize: 12, color: "#e05c5c" }}>
              暂无可用执行账号：请先到「平台账号」页完成账号授权登录
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {accounts.map((account) => {
                const selected = account.accountId === accountId;
                const usable =
                  account.loginStatus === "online" &&
                  account.riskStatus === "normal";
                return (
                  <button
                    key={`${account.platform}:${account.accountId}`}
                    type="button"
                    disabled={!usable}
                    onClick={() => {
                      setAccountId(account.accountId);
                      setAccountName(account.accountName);
                    }}
                    className="mx-card"
                    style={{
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      textAlign: "left",
                      borderColor: selected ? "rgba(222,150,57,.6)" : undefined,
                      background: selected ? "rgba(246,196,120,.1)" : undefined,
                      opacity: usable ? 1 : 0.5,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        background: usable ? "#22c55e" : "#e05c5c",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>
                        {account.accountName || `${account.platform} ${account.accountId}`}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1 }}>
                        {account.platform} · 登录 {account.loginStatus} · 风险 {account.riskStatus}
                        {!usable ? "（不可用，请先处理账号状态）" : ""}
                      </span>
                    </span>
                    {selected && <span style={{ color: "#d98a2d", fontSize: 14, flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* 第 2 步：关键词 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 2 步：他们会搜/聊什么词？</div>
          <textarea
            placeholder="例如：空气净化器, 除甲醛, 新房装修"
            value={form.keywords}
            onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.6 }}
          />
          <p style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 5 }}>你的客户会关注的话题词，逗号分隔</p>
          {keywords.length > 0 && (
            <p style={{ fontSize: 11.5, color: "#059669", marginTop: 4 }}>✓ 将监控 {keywords.length} 个关键词：{keywords.join("、")}</p>
          )}

          {/* 第 3 步：话术 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 3 步：找到后说什么？</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>评论话术</span>
              <textarea
                value={form.commentTemplate}
                onChange={(e) => setForm((p) => ({ ...p, commentTemplate: e.target.value }))}
                rows={2}
                style={{ ...fieldStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
              />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>私信话术</span>
              <textarea
                value={form.privateTemplate}
                onChange={(e) => setForm((p) => ({ ...p, privateTemplate: e.target.value }))}
                rows={2}
                style={{ ...fieldStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
              />
            </label>
          </div>

          {/* 高级设置 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>高级设置</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>每天最多触达</span>
              <input type="number" min={1} max={100} value={form.dailyLimit} onChange={(e) => setForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))} style={{ ...fieldStyle, marginTop: 6 }} />
              <span style={{ fontSize: 10.5, color: "var(--mx-muted)" }}>建议 10-30，太多容易被平台限制</span>
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>排除关键词</span>
              <input placeholder="例如：同行, 广告" value={form.excludeKeywords} onChange={(e) => setForm((p) => ({ ...p, excludeKeywords: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>昵称黑名单</span>
              <input placeholder="例如：某某官方旗舰店" value={form.blacklistNicknames} onChange={(e) => setForm((p) => ({ ...p, blacklistNicknames: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>同一个人最多触达几次</span>
              <input type="number" min={1} max={10} value={form.perTargetLimit} onChange={(e) => setForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            {/* 定时启动 */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>定时启动</span>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
                <input type="checkbox" checked={form.scheduleEnabled} onChange={(e) => setForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 12, color: "var(--mx-ink)" }}>每天</span>
                <input type="time" value={form.beginTime} disabled={!form.scheduleEnabled} onChange={(e) => setForm((p) => ({ ...p, beginTime: e.target.value }))} style={{ ...fieldStyle, flex: 1, padding: "7px 10px", opacity: form.scheduleEnabled ? 1 : 0.5 }} />
              </div>
            </div>
            {/* 发送方式 */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>发送方式</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 7 }}>
                {[
                  { value: "confirm-first" as const, label: "每条都先给我确认（推荐）" },
                  { value: "draft-only" as const, label: "只存草稿，我自己发" },
                  { value: "auto" as const, label: "自动发送（高风险）" },
                ].map((opt) => (
                  <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="radio" name="riskMode" checked={form.riskMode === opt.value} onChange={() => setForm((p) => ({ ...p, riskMode: opt.value }))} style={{ width: 15, height: 15 }} />
                    <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/apps/auto-acquisition")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
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
              {saving ? "正在创建…" : "创建获客任务"}
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

      {/* 执行账号 */}
      <V2Section title="执行账号">
        <p className="mb-2 text-sm text-[var(--kaypal-v3-muted)]">
          任务将使用下面这个已登录的平台账号真实执行（发评论/私信）
        </p>
        {accountsLoading ? (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">正在加载账号…</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-[var(--kaypal-v3-danger)]">
            暂无可用执行账号：请先到「平台账号」页完成平台账号授权登录
          </p>
        ) : (
          <div className="grid gap-2">
            {accounts.map((account) => {
              const selected = account.accountId === accountId;
              const usable =
                account.loginStatus === "online" &&
                account.riskStatus === "normal";
              return (
                <button
                  key={`${account.platform}:${account.accountId}`}
                  type="button"
                  disabled={!usable}
                  onClick={() => {
                    setAccountId(account.accountId);
                    setAccountName(account.accountName);
                  }}
                  className="flex items-center gap-3 rounded-[var(--kaypal-v3-radius-sm)] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: selected
                      ? "var(--kaypal-v3-primary)"
                      : "var(--kaypal-v3-border)",
                    background: selected
                      ? "var(--kaypal-v3-primary-soft)"
                      : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: usable
                        ? "var(--kaypal-v3-success)"
                        : "var(--kaypal-v3-danger)",
                      flexShrink: 0,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {account.accountName || `${account.platform} ${account.accountId}`}
                    </span>
                    <span className="block text-xs text-[var(--kaypal-v3-muted)]">
                      {account.platform} · 登录 {account.loginStatus} · 风险{" "}
                      {account.riskStatus}
                      {!usable ? "（不可用，请先处理账号状态）" : ""}
                    </span>
                  </span>
                  {selected && (
                    <span style={{ color: "var(--kaypal-v3-primary)" }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
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
