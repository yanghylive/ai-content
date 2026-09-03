"use client";

import Link from "next/link";
import { BrandIcon, type BrandIconName } from "@/components/shell/brand-icons";
import { SettingsPageHeader, AccountSettingsSection } from "../settings-sections";

const QUICK: Array<{ key: string; title: string; desc: string; brand: BrandIconName; href: string }> = [
  { key: "notifications", title: "通知设置", desc: "什么时候提醒你", brand: "notifications", href: "/settings/notifications" },
  { key: "data", title: "数据管理", desc: "导出和备份数据", brand: "database", href: "/settings/data" },
  { key: "appearance", title: "显示设置", desc: "文字大小等", brand: "settings", href: "/settings/appearance" },
  { key: "memory", title: "我的记忆", desc: "长期记忆与偏好", brand: "knowledge", href: "/settings/memory" },
];

/** 账号与安全页顶部「设置快捷入口」：金色品牌图形卡（层一品牌图形落点 4 桌面替身） */
function SettingsQuickLinks() {
  return (
    <section>
      <h2
        className="text-[var(--kaypal-v3-ink)]"
        style={{ fontSize: 17, fontWeight: 700, lineHeight: "24px", letterSpacing: "-0.2px" }}
      >
        设置快捷入口
      </h2>
      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">常用设置项直达</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map((q) => (
          <Link
            key={q.key}
            href={q.href}
            className="group flex items-center gap-3 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-accent-border)]/50 bg-[var(--kaypal-v3-paper)] p-3.5 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-[0_4px_16px_-4px_var(--kaypal-v3-accent-tint,transparent)]"
            style={{ textDecoration: "none" }}
          >
            <BrandIcon name={q.brand} size={30} tone="gold" />
            <span style={{ minWidth: 0 }}>
              <span className="block truncate text-sm font-semibold text-[var(--kaypal-v3-ink)]">{q.title}</span>
              <span className="block truncate text-xs text-[var(--kaypal-v3-muted)]">{q.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader title="账号与安全" sub="个人资料、登录密码" />
      <SettingsQuickLinks />
      <AccountSettingsSection />
    </div>
  );
}
