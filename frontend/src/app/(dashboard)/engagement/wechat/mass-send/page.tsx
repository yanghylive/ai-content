"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "@/components/iconpark";
import { MassSendWizard } from "../mass-send-wizard";
import { localEngineApi, type CreateInteractionTaskInput } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { V2PrimaryButton, V2GhostButton } from "@/components/v2/ui-kit";

/** 微信群发：真实向导（电脑端微信 RPA 已通，之前占位页误标「路线图」） */
export default function MassSendPage() {
  const router = useRouter();
  const [totalContacts, setTotalContacts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await localEngineApi.wechatContacts();
        setTotalContacts(Number(res?.count) || res?.contacts?.length || res?.items?.length || 0);
      } catch {
        setTotalContacts(0);
      }
    })();
  }, []);

  const handleSubmit = useCallback(async (data: {
    recipientsType: "all" | "manual";
    manualNumbers: string;
    message: string;
    scheduleType: "immediate" | "scheduled";
    scheduledTime: string;
    dailyLimit: number;
    intervalSeconds: number;
    enableSegmentation: boolean;
  }) => {
    setError(null);
    const date = new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    const input: CreateInteractionTaskInput = {
      type: "wechat-group-broadcast",
      replyText: data.message,
      planName: `${date} 群发`,
      ...(data.scheduleType === "scheduled" && data.scheduledTime ? { planTime: data.scheduledTime } : {}),
      ...(data.dailyLimit ? { dailyLimit: data.dailyLimit } : {}),
      ...(data.intervalSeconds ? { minIntervalSeconds: data.intervalSeconds } : {}),
      metadata: {
        recipientsType: data.recipientsType,
        manualNumbers: data.manualNumbers,
        enableSegmentation: data.enableSegmentation,
      },
    };
    await localEngineApi.createGroupBroadcastPlan(input);
    setDone(true);
  }, []);

  if (done) {
    return (
      <div className="kaypal-v2-wechat flex flex-col items-center gap-4 py-16">
        <CheckCircle2 className="h-12 w-12 text-[var(--kaypal-v3-success)]" />
        <h1 className="kx-greet">群发计划已创建</h1>
        <p className="text-sm text-[var(--kaypal-v3-muted)]">系统会在本机微信按计划执行发送，可到任务中心查看进度。</p>
        <div className="flex gap-3">
          <V2PrimaryButton onClick={() => router.push("/engagement/wechat")}>去微信任务中心</V2PrimaryButton>
          <V2GhostButton onClick={() => setDone(false)}>再建一个</V2GhostButton>
        </div>
      </div>
    );
  }

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
          onClick={() => router.push("/engagement/wechat")}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">微信群发</h1>
          <p className="text-sm text-[var(--kaypal-v3-muted)]">选择联系人、写好消息、设定节奏，本机微信按计划发送</p>
        </div>
      </div>
      {error ? (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">{error}</div>
      ) : null}
      <MassSendWizard
        totalContacts={totalContacts}
        onSubmit={(data) => void handleSubmit(data).catch((e) => setError(toPublicError(e, "群发计划创建失败")))}
        onCancel={() => router.push("/engagement/wechat")}
      />
    </div>
  );
}
