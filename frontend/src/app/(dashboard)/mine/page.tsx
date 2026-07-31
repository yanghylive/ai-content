"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { autoUploadApi } from "@/lib/api/auto-upload";

export default function MineScene() {
  const user = useShellUser();
  const [accountIssue, setAccountIssue] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    autoUploadApi
      .accounts()
      .then((accounts) => {
        if (!active) return;
        setAccountIssue(
          (Array.isArray(accounts) ? accounts : []).filter(
            (a) => !(a.status === 1 || a.sessionStatus === "logged_in"),
          ).length,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScenePage
      title="我的"
      sub="账号、设备、设置、数据"
      before={
        user ? (
          <div className="kx-todo-card">
            <div className="kx-todo-ico kx-t-violet" style={{ borderRadius: "50%" }}>
              <ShellIcon name="user" size={22} />
            </div>
            <div className="kx-todo-body">
              <div className="kx-todo-title">{user.displayName}</div>
              <div className="kx-todo-desc">
                {user.planLabel} · {user.creditLabel} 积分
              </div>
            </div>
            <button
              className="kx-btn kx-btn-ghost"
              disabled={user.loggingOut}
              onClick={user.onLogout}
            >
              {user.loggingOut ? "正在退出..." : "退出登录"}
            </button>
          </div>
        ) : undefined
      }
      cards={[
        {
          icon: "phone",
          tint: "kx-t-blue",
          title: "平台账号",
          desc: "抖音、小红书等账号的登录状态",
          href: "/platforms",
          badge: accountIssue > 0 ? `${accountIssue} 失效` : undefined,
        },
        {
          icon: "cpu",
          tint: "kx-t-slate",
          title: "设备状态",
          desc: "本地引擎、微信桌面、运行检查",
          href: "/local-engine",
        },
        {
          icon: "grid",
          tint: "kx-t-violet",
          title: "应用与安装",
          desc: "开通更多能力（CRM、语音助手等）",
          href: "/apps",
        },
        {
          icon: "settings",
          tint: "kx-t-slate",
          title: "设置",
          desc: "AI 服务、内容来源、存储、通知",
          href: "/settings",
        },
        {
          icon: "mic",
          tint: "kx-t-violet",
          title: "语音控制台",
          desc: "白龙马语音助手，用声音控制整个系统",
          href: "/admin/voice-agent",
        },
        {
          icon: "file",
          tint: "kx-t-amber",
          title: "用量与费用",
          desc: "积分用量、费用明细、结果留存",
          href: "/intelligence/costs",
        },
        {
          icon: "users",
          tint: "kx-t-cyan",
          title: "账号与团队",
          desc: "个人资料、成员权限、版本更新",
          href: "/capabilities/account",
        },
      ]}
    />
  );
}
