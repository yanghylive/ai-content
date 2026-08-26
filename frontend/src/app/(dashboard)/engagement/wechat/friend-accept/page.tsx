"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { FriendAcceptPanel } from "../../wechat/friend-accept-panel";
import { submitFriendAcceptTask } from "@/lib/v2/wechat-wizard-submit";
import { toPublicError } from "@/lib/public-error";
import { V2EmptyState } from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

// 后端暂无"待处理好友申请"列表接口（申请来自微信桌面端事件推送，未持久化），
// 有申请时微信桌面会弹通知；这里不放假数据（会让人误以为真有人加好友）
const PENDING_APPLICATIONS: Array<{
  id: string;
  nickname: string;
  message: string;
  appliedAt: string;
}> = [];

export default function FriendAcceptPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [error, setError] = useState<string | null>(null);

  if (PENDING_APPLICATIONS.length === 0) {
    /* 移动端原生空态（申请来自微信桌面事件推送，暂无持久化列表） */
    if (isMobile) {
      return (
        <div className="kx-mobile-ambient">
          <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
            <div className="mx-header">
              <div className="mx-page-title">通过好友</div>
              <div className="mx-page-sub">有人加你微信时，申请会实时出现在这里</div>
            </div>
            <div className="mx-card mx-empty" style={{ marginTop: 14, padding: 30, textAlign: "center" }}>
              <UserPlus width={30} height={30} style={{ color: "var(--kaypal-v3-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--kaypal-v3-ink)", marginTop: 11 }}>没有待处理的好友申请</p>
              <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 5, lineHeight: 1.55 }}>
                也可以先去消息台看看有没有新会话
              </p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 14 }} onClick={() => router.push("/engagement/wechat")}>
                去消息台
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <V2EmptyState
          icon={UserPlus}
          title="没有待处理的好友申请"
          description="有人加你微信时，申请会实时出现在这里；也可以先去消息台看看有没有新会话"
          action={
            <button
              type="button"
              className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
              onClick={() => router.push("/engagement/wechat")}
            >
              去消息台
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">
            {error}
          </p>
        </div>
      )}
      <FriendAcceptPanel
        applications={PENDING_APPLICATIONS}
        onCancel={() => router.push("/engagement/wechat")}
        onSubmit={async (data) => {
          setError(null);
          try {
            await submitFriendAcceptTask({
              selectedIds: data.selectedIds,
              welcomeMessage: data.welcomeMessage,
              sendWelcome: data.sendWelcome,
              remarkStrategy: data.remarkStrategy,
              customRemark: data.customRemark,
            });
            router.push("/engagement/wechat");
          } catch (err: unknown) {
            setError(toPublicError(err, "创建通过好友任务失败，请稍后重试"));
            throw err;
          }
        }}
      />
    </div>
  );
}
