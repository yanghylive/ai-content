"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Send,
  MessageSquareText,
  Phone,
  UserRound,
  Building2,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { getCrmCustomer, prepareCrmWelcomeMessage, type CrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "accent" | "muted" }> = {
  new: { label: "新客户", tone: "accent" },
  follow_up: { label: "跟进中", tone: "warning" },
  following: { label: "跟进中", tone: "warning" },
  won: { label: "已成交", tone: "success" },
  lost: { label: "已流失", tone: "muted" },
};

export function CustomerProfile({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getCrmCustomer(customerId);
      setCustomer(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载客户详情失败"));
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void fetchCustomer();
  }, [fetchCustomer]);

  // 抖音测试发送：先准备欢迎消息，再跳到私信台
  const handleTestSend = async () => {
    if (!customer) return;
    setPreparing(true);
    setError(null);
    try {
      const preparation = await prepareCrmWelcomeMessage(customer.id, {
        channel: "douyin",
      });
      router.push(
        `/engagement/douyin-messages?crmCustomerId=${encodeURIComponent(customer.id)}&crmPreparationId=${encodeURIComponent(preparation.id)}`,
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "准备测试发送失败，请稍后重试"));
    } finally {
      setPreparing(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
      </div>
    );
  }

  if (!customer) {
    return (
      <V2Section>
        <V2EmptyState
          icon={UserRound}
          title="没找到这个客户"
          action={
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/crm")}>
              返回客户列表
            </V2GhostButton>
          }
        />
      </V2Section>
    );
  }

  const status = STATUS_LABELS[customer.status] || {
    label: customer.status,
    tone: "muted" as const,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 客户名片 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/crm")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
            <UserRound className="h-7 w-7 text-[var(--kaypal-v3-accent-ink)]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {customer.displayName}
              </h1>
              <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
              {customer.score > 0 && (
                <span className="text-sm font-medium text-[var(--kaypal-v3-amber)]">
                  评分 {customer.score}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {customer.title || ""}
              {customer.companyName ? ` · ${customer.companyName}` : ""}
              {customer.sourcePlatform ? ` · 来自${customer.sourcePlatform}` : ""}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 联系方式 */}
      <V2Section title="联系方式" padding={false}>
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {[
            { icon: Phone, label: "电话", value: customer.phone },
            { icon: MessageSquareText, label: "微信", value: customer.wechat },
            { icon: Mail, label: "邮箱", value: customer.email },
            { icon: Building2, label: "公司", value: customer.companyName },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-4 p-4">
              <Icon className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
              <span className="w-16 text-sm text-[var(--kaypal-v3-muted)]">{label}</span>
              <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                {value || "—"}
              </span>
            </div>
          ))}
        </div>
      </V2Section>

      {/* 来源 */}
      {(customer.sourceText || customer.sourceKeyword) && (
        <V2Section title="客户来源">
          {customer.sourceKeyword && (
            <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">
              匹配关键词：{customer.matchedKeyword || customer.sourceKeyword}
            </p>
          )}
          {customer.sourceText && (
            <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
              {customer.sourceText}
            </p>
          )}
        </V2Section>
      )}

      {/* 最新互动 */}
      {customer.latestReply && (
        <V2Section title="最新互动">
          <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">{customer.latestReply}</p>
        </V2Section>
      )}

      {/* 标签 */}
      {customer.tags && customer.tags.length > 0 && (
        <V2Section title="标签">
          <div className="flex flex-wrap gap-2">
            {customer.tags.map((tag) => (
              <V2StatusChip key={tag} tone="accent">
                {tag}
              </V2StatusChip>
            ))}
          </div>
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/crm")}>
          返回客户列表
        </V2GhostButton>
        <V2PrimaryButton
          icon={preparing ? Loader2 : Send}
          loading={preparing}
          onClick={handleTestSend}
        >
          {preparing ? "正在准备..." : "抖音测试发送"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
