"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MassSendWizard } from "../../wechat/mass-send-wizard";
import {
  fetchAllContactTargets,
  submitMassSendTask,
} from "@/lib/v2/wechat-wizard-submit";
import { toPublicError } from "@/lib/public-error";

export default function MassSendWizardPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">
            {error}
          </p>
        </div>
      )}
      <MassSendWizard
        totalContacts={0}
        onCancel={() => router.push("/workbench/wechat")}
        onSubmit={async (data) => {
          setError(null);
          // "全部联系人"模式：拉取真实联系人列表
          const targets =
            data.recipientsType === "all"
              ? await fetchAllContactTargets()
              : data.manualNumbers
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean);

          if (targets.length === 0) {
            setError("没有可发送的联系人，请先同步联系人或手动输入");
            return;
          }

          const autoPlanName = `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 群发给 ${targets.length.toLocaleString()} 人`;

          try {
            await submitMassSendTask({
              planName: autoPlanName,
              message: data.message,
              targets,
              scheduleType: data.scheduleType,
              scheduledTime: data.scheduledTime,
              dailyLimit: data.dailyLimit,
              intervalSeconds: data.intervalSeconds,
              enableSegmentation: data.enableSegmentation,
            });
            router.push("/workbench/wechat");
          } catch (err: unknown) {
            setError(toPublicError(err, "创建群发任务失败，请稍后重试"));
            throw err;
          }
        }}
      />
    </div>
  );
}
