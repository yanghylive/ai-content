"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContactAddWizard } from "../../wechat/contact-add-wizard";
import { submitContactAddTask } from "@/lib/v2/wechat-wizard-submit";
import { toPublicError } from "@/lib/public-error";

export default function ContactAddWizardPage() {
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
      <ContactAddWizard
        onCancel={() => router.push("/workbench/wechat")}
        onSubmit={async (data) => {
          setError(null);
          const numbers = data.numbers
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          const autoPlanName = `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 加好友 ${numbers.length} 人`;

          try {
            await submitContactAddTask({
              planName: autoPlanName,
              numbers,
              verifyMessage: data.verifyMessage,
              dailyLimit: data.dailyLimit,
              minIntervalSeconds: data.minIntervalSeconds,
              maxIntervalSeconds: data.maxIntervalSeconds,
              remarkStrategy: data.remarkStrategy,
              customRemark: data.customRemark,
            });
            router.push("/workbench/wechat");
          } catch (err: unknown) {
            setError(toPublicError(err, "创建加好友任务失败，请稍后重试"));
            throw err;
          }
        }}
      />
    </div>
  );
}
