"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  Sparkles,
  UserPlus,
  XCircle,
} from "lucide-react";
import toast from "@/lib/toast";
import {
  listLeads,
  replyLead,
  reviewLead,
  scanAccount,
  type AcquisitionLead,
  type AcquisitionPlatform,
  type LeadStatus,
} from "@/lib/api/comment-acquisition";
import {
  V2Field,
  V2GhostButton,
  V2Input,
  V2PrimaryButton,
  V2Section,
  V2Select,
} from "@/components/v2/ui-kit";

const STATUS_LABEL: Record<LeadStatus, string> = {
  pending: "待处理",
  approved: "已审核",
  replied: "已回复",
  skipped: "已跳过",
  failed: "失败",
};

const STATUS_COLOR: Record<LeadStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  replied: "bg-green-100 text-green-700",
  skipped: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
};

export default function CommentAcquisitionPage() {
  const [platform, setPlatform] = useState<AcquisitionPlatform>("douyin");
  const [accountId, setAccountId] = useState("");
  const [autoReply, setAutoReply] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [leads, setLeads] = useState<AcquisitionLead[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">("");
  const [lastScan, setLastScan] = useState<{
    scanned: number;
    leads: number;
    replies: number;
    circuitOpen: boolean;
    retryAfterSeconds: number;
  } | null>(null);
  const [replying, setReplying] = useState<string | null>(null);

  const refreshLeads = useCallback(async () => {
    try {
      const res = await listLeads({
        platform,
        status: statusFilter || undefined,
        limit: 50,
      });
      setLeads(res.items);
      setTotal(res.total);
    } catch {
      /* 列表加载失败不打扰 */
    }
  }, [platform, statusFilter]);

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  const handleScan = async () => {
    if (!accountId.trim()) {
      toast.error("请先填写账号 ID");
      return;
    }
    setScanning(true);
    try {
      const res = await scanAccount({
        platform,
        accountId: accountId.trim(),
        autoReply,
        limit: 50,
      });
      setLastScan(res);
      toast.success(
        `扫描 ${res.scanned} 条，发现 ${res.leads} 个潜客${res.replies ? `，自动回复 ${res.replies} 条` : ""}`,
      );
      refreshLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (lead: AcquisitionLead) => {
    await reviewLead(lead.id, { action: "approve" });
    toast.success("已审核通过，可手动回复");
    refreshLeads();
  };

  const handleSkip = async (lead: AcquisitionLead) => {
    await reviewLead(lead.id, { action: "skip" });
    refreshLeads();
  };

  const handleSend = async (lead: AcquisitionLead) => {
    setReplying(lead.id);
    try {
      const res = await replyLead(lead.id, {
        platform: lead.platform,
        accountId: lead.accountId,
        commentText: lead.commentText,
        replyText: lead.replyText || "收到，回头我整理好发你～",
        sourceTitle: undefined,
      });
      if (res.ok) {
        toast.success("回复已发出");
      } else {
        toast.error("回复发送失败");
      }
      refreshLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setReplying(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--kaypal-v3-ink)]">
          评论获客
        </h1>
        <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
          扫描平台评论 → AI 识别潜客 → 真人感回复 → 潜客线索管理
        </p>
      </div>

      <V2Section title="扫描配置" description="选择平台账号，一键扫描最新评论">
        <div className="grid gap-4 sm:grid-cols-3">
          <V2Field label="平台">
            <V2Select
              value={platform}
              onChange={(e) =>
                setPlatform(e.target.value as AcquisitionPlatform)
              }
            >
              <option value="douyin">抖音</option>
              <option value="wechat-channel">视频号</option>
            </V2Select>
          </V2Field>
          <V2Field label="账号 ID" hint="平台账号列表里的账号 ID">
            <V2Input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="如 3（抖音创作者账号）"
            />
          </V2Field>
          <V2Field label="自动回复">
            <div className="flex h-10 items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
                <input
                  type="checkbox"
                  checked={autoReply}
                  onChange={(e) => setAutoReply(e.target.checked)}
                  className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                />
                扫描后直接自动回复潜客
              </label>
            </div>
          </V2Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <V2PrimaryButton
            icon={scanning ? Loader2 : Sparkles}
            loading={scanning}
            onClick={handleScan}
          >
            {scanning ? "扫描中…" : "扫描评论并识别潜客"}
          </V2PrimaryButton>
          <V2GhostButton icon={RefreshCcw} onClick={refreshLeads}>
            刷新列表
          </V2GhostButton>
        </div>
        {lastScan && (
          <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">
            上次扫描：共 {lastScan.scanned} 条评论，发现{" "}
            <span className="font-medium text-[var(--kaypal-v3-accent-ink)]">
              {lastScan.leads}
            </span>{" "}
            个潜客
            {lastScan.replies > 0 && `，已自动回复 ${lastScan.replies} 条`}
          </p>
        )}
        {lastScan?.circuitOpen && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <span aria-hidden>⚠️</span>
            该账号触发风控熔断（10 分钟内失败 ≥3 次），自动回复已暂停，约{" "}
            {lastScan.retryAfterSeconds} 秒后恢复；新潜客已入库待人工处理
          </p>
        )}
      </V2Section>

      <V2Section
        title={`潜客线索（${total}）`}
        description="AI 评分排序：分越高意向越强"
        action={
          <V2Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "")}
            className="w-32"
          >
            <option value="">全部状态</option>
            {(
              Object.keys(STATUS_LABEL) as LeadStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </V2Select>
        }
      >
        {leads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-[var(--kaypal-v3-muted)]">
            <MessageSquare className="h-8 w-8" />
            <p className="text-sm">还没有潜客线索，先扫描一下账号评论</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="rounded-xl border border-[var(--kaypal-v3-border)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {lead.platform === "douyin" ? "抖音" : "视频号"}
                        <span className="mx-1 text-[var(--kaypal-v3-muted)]">
                          #{lead.accountId}
                        </span>
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[lead.status]}`}
                      >
                        {STATUS_LABEL[lead.status]}
                      </span>
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)]">
                        <UserPlus className="h-3 w-3" />
                        意向 {lead.leadScore}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--kaypal-v3-ink)]">
                      {lead.commentText}
                    </p>
                    {lead.replyText && (
                      <div className="mt-2 rounded-lg bg-[var(--kaypal-v3-field-bg)] px-3 py-2">
                        <p className="text-xs text-[var(--kaypal-v3-muted)]">
                          AI 回复{lead.personaId ? `（${lead.personaId} 人格）` : ""}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--kaypal-v3-soft-ink)]">
                          {lead.replyText}
                        </p>
                      </div>
                    )}
                    {lead.error && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-[var(--kaypal-v3-danger)]">
                        <XCircle className="h-3 w-3" />
                        {lead.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {lead.status === "pending" && (
                      <>
                        <V2GhostButton
                          icon={CheckCircle2}
                          onClick={() => handleApprove(lead)}
                        >
                          通过
                        </V2GhostButton>
                        <V2GhostButton onClick={() => handleSkip(lead)}>
                          跳过
                        </V2GhostButton>
                      </>
                    )}
                    {(lead.status === "approved" || lead.status === "pending") && (
                      <V2PrimaryButton
                        icon={replying === lead.id ? Loader2 : Send}
                        loading={replying === lead.id}
                        onClick={() => handleSend(lead)}
                      >
                        发送回复
                      </V2PrimaryButton>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>
    </div>
  );
}
