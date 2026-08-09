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

const PLATFORMS = [
  { value: "wechat", label: "微信公众号", desc: "公众号图文发布通道（私有发布服务）", icon: MessageCircle },
] as const;

export function PlatformAccountForm() {
  const router = useRouter();
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
