"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MomentsPublishWizard } from "../../wechat/moments-publish-wizard";
import { submitMomentsPublishTask } from "@/lib/v2/wechat-wizard-submit";
import { toPublicError } from "@/lib/public-error";

export default function MomentsPublishPage() {
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
      <MomentsPublishWizard
        onCancel={() => router.push("/workbench/wechat")}
        onSubmit={async (data) => {
          setError(null);
          const autoPlanName = `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 朋友圈发布`;

          try {
            await submitMomentsPublishTask({
              planName: autoPlanName,
              content: data.content,
              mediaPaths: data.mediaPaths,
              scheduleType: data.scheduleType,
              customTime: data.customTime,
              visibility: data.visibility,
            });
            router.push("/workbench/wechat");
          } catch (err: unknown) {
            setError(toPublicError(err, "创建朋友圈发布计划失败，请稍后重试"));
            throw err;
          }
        }}
      />
    </div>
  );
}
