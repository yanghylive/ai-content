"use client";

import {
  KeyRound,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { KaypalAccountSections } from "./account-sections";

export function AccountCenter() {
  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="账号与团队"
        subtitle="管理你的登录账号、密码和安全设置"
        icon={UserRound}
        quickActions={[
          {
            key: "profile",
            title: "个人资料",
            description: "修改头像和昵称",
            icon: UserRound,
            href: "/settings",
          },
          {
            key: "password",
            title: "修改密码",
            description: "定期修改保障安全",
            icon: KeyRound,
            href: "/settings",
          },
          {
            key: "security",
            title: "安全设置",
            description: "登录保护和验证",
            icon: ShieldCheck,
            href: "/settings",
          },
          {
            key: "team",
            title: "团队成员",
            description: "管理子账号权限",
            icon: Users,
            href: "/capabilities/account",
          },
        ]}
      />
      <KaypalAccountSections />
    </div>
  );
}
