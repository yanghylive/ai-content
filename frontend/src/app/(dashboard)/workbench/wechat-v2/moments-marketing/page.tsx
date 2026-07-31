"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MomentsMarketingWizard } from "../../wechat/moments-marketing-wizard";
import { submitMomentsMarketingTask } from "@/lib/v2/wechat-wizard-submit";
import { toPublicError } from "@/lib/public-error";

export default function MomentsMarketingPage() {
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
      <MomentsMarketingWizard
        onCancel={() => router.push("/workbench/wechat")}
        onSubmit={async (data) => {
          setError(null);
          const targetContacts = data.targetContacts
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          const autoPlanName = `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 朋友圈营销`;

          try {
            await submitMomentsMarketingTask({
              planName: autoPlanName,
              mode: data.mode,
              targetContacts,
              autoLike: data.autoLike,
              autoComment: data.autoComment,
              commentMode: data.commentMode,
              fixedComment: data.fixedComment,
              customPrompt: data.customPrompt,
              dailyViewCount: data.dailyViewCount,
              executionTime: data.executionTime,
            });
            router.push("/workbench/wechat");
          } catch (err: unknown) {
            setError(toPublicError(err, "创建朋友圈营销计划失败，请稍后重试"));
            throw err;
          }
        }}
      />
    </div>
  );
}
