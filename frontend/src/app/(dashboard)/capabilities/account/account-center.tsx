"use client";

import { KaypalAccountSections } from "./account-sections";

/**
 * 账号与团队（2026-09-01 WorkBuddy 化去重）
 *
 * 原 4 个 quickAction（个人资料/修改密码/安全设置 → /settings，团队成员 → 自己）
 * 全是重复跳转且 /settings 已重定向，删除。真实内容由 KaypalAccountSections
 * （Kaypal 档案 / 设备 / 订阅）提供。
 */
export function AccountCenter() {
  return (
    <div className="flex flex-col gap-6">
      <KaypalAccountSections />
    </div>
  );
}
