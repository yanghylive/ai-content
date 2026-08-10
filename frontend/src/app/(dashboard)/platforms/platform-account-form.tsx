"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  MessageCircle,
  Save,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import { publishingApi } from "@/lib/api/publishing";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const PLATFORMS = [
  { value: "wechat", label: "微信公众号", desc: "公众号图文发布通道（私有发布服务）", icon: MessageCircle },
] as const;

export function PlatformAccountForm() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    platform: "wechat",
    name: "",
    appId: "",
    apiToken: "",
    config: {
      apiUrl: "https://mp.idouq.com/api/open/article",
      baseUrl: "https://jpage.cn",
      categoryId: "" as string | number,
      defaultThumbMediaId: "",
      openComment: 1,
      onlyFansCanComment: 0,
      tags: "wechat-official-account,pre-draft-preview",
    },
  });

  const setConfig = <K extends keyof typeof form.config>(key: K, value: (typeof form.config)[K]) =>
    setForm((p) => ({ ...p, config: { ...p.config, [key]: value } }));

  const canSubmit = form.platform && form.name.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await publishingApi.createAccount({
        platform: form.platform,
        name: form.name,
        appId: form.appId || undefined,
        apiToken: form.apiToken || undefined,
        config: {
          apiUrl: form.config.apiUrl,
          baseUrl: form.config.baseUrl,
          openComment: form.config.openComment,
          onlyFansCanComment: form.config.onlyFansCanComment,
          ...(form.config.categoryId !== "" ? { categoryId: Number(form.config.categoryId) } : {}),
          ...(form.config.defaultThumbMediaId ? { defaultThumbMediaId: form.config.defaultThumbMediaId } : {}),
          tags: form.config.tags,
        },
      });
      router.push("/platforms");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——platforms/new */
  if (isMobile) {
    const fieldStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--mx-ink)",
      fontSize: 12.5,
    };
    const switchBtn = (checked: boolean, onToggle: () => void) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        style={{
          flexShrink: 0, width: 44, height: 26, borderRadius: 999, padding: 3,
          background: checked ? "#d98a2d" : "rgba(142,165,190,.4)",
          display: "flex", alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          transition: "all .2s", border: "none",
        }}
      >
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
      </button>
    );
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <button type="button" onClick={() => router.push("/platforms")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, marginBottom: 6 }}>
              <ArrowLeft width={14} height={14} /> 返回平台列表
            </button>
            <div className="mx-page-title">添加发布配置</div>
            <div className="mx-page-sub">两步搞定：选平台 → 填账号名</div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 第 1 步：选平台 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>第 1 步：选平台</div>
          {PLATFORMS.map(({ value, label, desc, icon: PlatformIcon }) => {
            const selected = form.platform === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setForm((p) => ({ ...p, platform: value }))}
                className="mx-card"
                style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", width: "100%", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
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

          {/* 第 2 步：账号信息 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 2 步：账号信息</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>配置名称 *</span>
              <input placeholder="例如：公司主号" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>发布服务地址 *</span>
              <input placeholder="https://你的发布服务地址" value={form.config.apiUrl} onChange={(e) => setConfig("apiUrl", e.target.value)} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>AppID</span>
              <input placeholder="公众号后台 → 设置与开发 → 基本配置" value={form.appId} onChange={(e) => setForm((p) => ({ ...p, appId: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>访问凭证</span>
              <input type="password" placeholder="发布服务里获取" value={form.apiToken} onChange={(e) => setForm((p) => ({ ...p, apiToken: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
          </div>

          {/* 第 3 步：发布细节（可选） */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 3 步：发布细节（可选）</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <p style={{ fontSize: 10.5, color: "var(--mx-muted)", marginBottom: 9 }}>已按推荐预填，一般不用改</p>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>默认封面 media_id</span>
              <input placeholder="可选" value={form.config.defaultThumbMediaId} onChange={(e) => setConfig("defaultThumbMediaId", e.target.value)} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>分类 ID</span>
              <input type="number" placeholder="可选" value={String(form.config.categoryId)} onChange={(e) => setConfig("categoryId", e.target.value)} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>页面服务地址</span>
              <input placeholder="https://jpage.cn" value={form.config.baseUrl} onChange={(e) => setConfig("baseUrl", e.target.value)} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>开启留言</span>
              {switchBtn(form.config.openComment === 1, () => setConfig("openComment", form.config.openComment === 1 ? 0 : 1))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>仅限粉丝留言</span>
              {switchBtn(form.config.onlyFansCanComment === 1, () => setConfig("onlyFansCanComment", form.config.onlyFansCanComment === 1 ? 0 : 1))}
            </div>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/platforms")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
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
              {saving ? "正在保存…" : "保存配置"}
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
            onClick={() => router.push("/platforms")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              添加发布配置
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              两步搞定：选平台 → 填账号名
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：选平台 */}
      <V2Section title="第 1 步：选平台">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map(({ value, label, desc, icon }) => (
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

      {/* 第 2 步：账号信息 */}
      <V2Section title="第 2 步：账号信息">
        <div className="grid gap-5">
          <V2Field label="配置名称" required hint="给自己看的名字，例如：公司主号">
            <V2Input
              placeholder="例如：公司主号"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </V2Field>

          <V2Field label="发布服务地址" required hint="公众号发布服务的服务地址">
            <V2Input
              placeholder="https://你的发布服务地址"
              value={form.config.apiUrl}
              onChange={(e) => setConfig("apiUrl", e.target.value)}
            />
          </V2Field>

          <V2Field label="AppID" hint="公众号的 AppID 或原始 ID">
            <V2Input
              placeholder="公众号后台 → 设置与开发 → 基本配置"
              value={form.appId}
              onChange={(e) => setForm((p) => ({ ...p, appId: e.target.value }))}
            />
          </V2Field>

          <V2Field label="访问凭证" hint="在发布服务中获取的访问凭证">
            <V2Input
              type="password"
              placeholder="发布服务里获取"
              value={form.apiToken}
              onChange={(e) => setForm((p) => ({ ...p, apiToken: e.target.value }))}
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 第 3 步：发布细节（高级，预填默认值） */}
      <V2Section title="第 3 步：发布细节（可选）" description="已按推荐预填，一般不用改">
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="默认封面 media_id" hint="微信永久素材的 media_id，发文没封面时用">
              <V2Input
                placeholder="可选"
                value={form.config.defaultThumbMediaId}
                onChange={(e) => setConfig("defaultThumbMediaId", e.target.value)}
              />
            </V2Field>

            <V2Field label="分类 ID" hint="公众号文章分类，数字">
              <V2Input
                type="number"
                placeholder="可选"
                value={String(form.config.categoryId)}
                onChange={(e) => setConfig("categoryId", e.target.value)}
              />
            </V2Field>

            <V2Field label="页面服务地址">
              <V2Input
                placeholder="https://jpage.cn"
                value={form.config.baseUrl}
                onChange={(e) => setConfig("baseUrl", e.target.value)}
              />
            </V2Field>

            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">开启留言</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.config.openComment === 1}
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                    form.config.openComment === 1
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={() => setConfig("openComment", form.config.openComment === 1 ? 0 : 1)}
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">仅限粉丝留言</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.config.onlyFansCanComment === 1}
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                    form.config.onlyFansCanComment === 1
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={() =>
                    setConfig("onlyFansCanComment", form.config.onlyFansCanComment === 1 ? 0 : 1)
                  }
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </label>
            </div>
          </div>
        </V2Disclosure>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/platforms")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : "保存配置"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
