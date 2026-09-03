"use client";

import {
  Bell,
  Database,
  KeyRound,
  Settings2,
  UserRound,
} from "@/components/iconpark";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function SettingsCenter() {
  return (
    <WorkbenchCenter
      title="系统设置"
      subtitle="账号、通知、数据和安全的统一设置入口"
      icon={Settings2}
      quickActions={[
        {
          key: "profile",
          title: "账号信息",
          description: "修改头像、昵称和密码",
          icon: UserRound,
          href: "/settings?tab=profile",
        },
        {
          key: "notifications",
          title: "通知设置",
          description: "配置消息提醒方式",
          icon: Bell,
          href: "/settings?tab=notifications",
        },
        {
          key: "api",
          title: "访问凭证",
          description: "管理第三方服务凭证",
          icon: KeyRound,
          href: "/settings?tab=api",
        },
        {
          key: "data",
          title: "数据管理",
          description: "备份、导出和清理",
          icon: Database,
          href: "/settings?tab=data",
        },
      ]}
    />
  );
}
