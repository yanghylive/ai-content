"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2Textarea,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { useConfirm } from "@/hooks/use-confirm";
import { growthApi, type GrowthLead, type GrowthLeadStatus } from "@/lib/api/growth";
import { createCrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

const STATUS_LABELS: Record<GrowthLeadStatus, { label: string; tone: "success" | "warning" | "accent" | "muted" | "danger" }> = {
  new: { label: "新线索", tone: "accent" },
  contacted: { label: "已触达", tone: "warning" },
  replied: { label: "已回复", tone: "warning" },
  qualified: { label: "高意向", tone: "accent" },
  converted: { label: "已成交", tone: "success" },
  ignored: { label: "已忽略", tone: "muted" },
  blocked: { label: "已屏蔽", tone: "danger" },
};

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信",
  bilibili: "B站",
};

type FilterKey = "all" | "new" | "contacted" | "qualified" | "converted";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "new", label: "新线索" },
  { key: "contacted", label: "已触达" },
  { key: "qualified", label: "高意向" },
  { key: "converted", label: "已成交" },
];

export function LeadsPool() {
  const { confirm, modal } = useConfirm();
  // 手动补充线索
  const [addOpen, setAddOpen] = useState(false);
  const [newLead, setNewLead] = useState({ nickname: "", platform: "douyin", sourceText: "" });
  const [adding, setAdding] = useState(false);
  // 批量操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState<string | null>(null);
  const router = useRouter();
  const [leads, setLeads] = useState<GrowthLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listLeads();
      setLeads(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载线索失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  const filtered = useMemo(
    () => leads.filter((lead) => filter === "all" || lead.status === filter),
    [leads, filter],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = { all: 0, new: 0, contacted: 0, qualified: 0, converted: 0 };
    leads.forEach((lead) => {
      result.all += 1;
      if (lead.status in result) {
        result[lead.status as FilterKey] += 1;
      }
    });
    return result;
  }, [leads]);

  // 高意向/已回复 → 一键转为 CRM 客户（真实创建客户记录 + 标记线索已转化）
  const handleConvert = async (lead: GrowthLead) => {
    setActingId(lead.id);
    setError(null);
    try {
      // 第一步：在 CRM 里真实创建客户
      const customer = await createCrmCustomer({
        displayName: lead.nickname || "未命名客户",
        status: "new",
        sourcePlatform: lead.platform,
        sourceKeyword: lead.matchedKeywords?.[0],
        sourceText: lead.sourceText,
        sourceUrl: lead.sourceUrl,
        score: lead.score,
      });
      // 第二步：标记线索已转化并关联 CRM 客户 ID
      await growthApi.updateLead(lead.id, {
        status: "converted",
        crmCustomerId: customer.id,
      });
      await fetchLeads();
    } catch (err: unknown) {
      setError(toPublicError(err, "转客户失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  const handleAddLead = async () => {
    if (!newLead.nickname.trim()) {
      setError("先填昵称");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await growthApi.createLead({
        nickname: newLead.nickname.trim(),
        platform: newLead.platform as GrowthLead["platform"],
        sourceText: newLead.sourceText.trim(),
        status: "new",
        sourceType: "manual",
      });
      setAddOpen(false);
      setNewLead({ nickname: "", platform: "douyin", sourceText: "" });
      await fetchLeads();
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "添加失败"));
    } finally {
      setAdding(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStatus = async (status: GrowthLeadStatus, label: string) => {
    if (selectedIds.size === 0) return;
    setBulkActing(status);
    setError(null);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => growthApi.updateLead(id, { status })),
      );
      setSelectedIds(new Set());
      await fetchLeads();
    } catch (err: unknown) {
      setError(toPublicError(err, `批量${label}失败`));
    } finally {
      setBulkActing(null);
    }
  };

  // 删除单条线索（带确认，二次防误删）
  const handleDeleteOne = async (lead: GrowthLead) => {
    const ok = await confirm({
      kind: "danger",
      title: `删除线索「${lead.nickname || "未知用户"}」`,
      description: "删除后不可恢复，相关跟进记录一并清除。",
      confirmText: "删除",
    });
    if (!ok) return;
    setActingId(lead.id);
    setError(null);
    try {
      await growthApi.deleteLead(lead.id);
      await fetchLeads();
    } catch (err: unknown) {
      setError(toPublicError(err, "删除线索失败"));
    } finally {
      setActingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      kind: "danger",
      title: `删除选中的 ${selectedIds.size} 条线索`,
      description: "删除后不可恢复，相关跟进记录一并清除。",
      confirmText: "删除",
    });
    if (!ok) return;
    setBulkActing("delete");
    setError(null);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => growthApi.deleteLead(id)),
      );
      setSelectedIds(new Set());
      await fetchLeads();
    } catch (err: unknown) {
      setError(toPublicError(err, "批量删除失败"));
    } finally {
      setBulkActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/growth")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              线索池
            </h1>
            <div className="mt-3">
              <V2PrimaryButton onClick={() => setAddOpen(true)}>
                手动补充线索
              </V2PrimaryButton>
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统抓到的潜在客户，高意向的转成 CRM 客户重点跟进
            </p>
            <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              评分在抓取时由 AI 自动给出（依据命中关键词与留言内容，悬停分数可见）；你可以通过「转为客户 / 忽略」人工复核评分是否准确
            </p>
          </div>
          <V2StatusChip tone="accent">
            {loading ? "加载中" : `共 ${leads.length} 条`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filter === key
                ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
            {counts[key] > 0 && (
              <span className="ml-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={UsersRound}
            title="还没有线索"
            description="创建获客任务后，系统抓到的潜在客户会出现在这里"
            action={
              <V2PrimaryButton
                icon={ArrowRight}
                onClick={() => router.push("/auto-acquisition/create")}
              >
                新建获客任务
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((lead) => {
              const status = STATUS_LABELS[lead.status] || STATUS_LABELS.new;
              const canConvert =
                (lead.status === "qualified" || lead.status === "replied") &&
                !lead.crmCustomerId;
              return (
                <div key={lead.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--kaypal-v3-accent)]"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                    />
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                      <UserRound className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {lead.nickname || "未知用户"}
                        </p>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                        {lead.score > 0 && (
                          <span
                            className="text-xs font-medium text-[var(--kaypal-v3-amber)]"
                            title={
                              lead.scoreReasons?.length
                                ? `评分依据：${lead.scoreReasons.join("；")}`
                                : undefined
                            }
                          >
                            {lead.score} 分
                          </span>
                        )}
                      </div>
                      {lead.scoreReasons?.length > 0 && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-[var(--kaypal-v3-muted)]">
                          评分依据：{lead.scoreReasons.join("；")}
                        </p>
                      )}
                      <p className="mt-0.5 line-clamp-1 text-sm text-[var(--kaypal-v3-muted)]">
                        {PLATFORM_LABELS[lead.platform] || lead.platform}
                        {lead.matchedKeywords?.length
                          ? ` · 命中：${lead.matchedKeywords.slice(0, 3).join("、")}`
                          : ""}
                      </p>
                      {lead.sourceText && (
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--kaypal-v3-muted)]">
                          "{lead.sourceText}"
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {lead.crmCustomerId ? (
                      <V2StatusChip tone="success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        已入 CRM
                      </V2StatusChip>
                    ) : canConvert ? (
                      <V2PrimaryButton
                        icon={CheckCircle2}
                        loading={actingId === lead.id}
                        onClick={() => void handleConvert(lead)}
                      >
                        转为客户
                      </V2PrimaryButton>
                    ) : null}
                    <button
                      type="button"
                      title="删除线索"
                      className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)] disabled:opacity-50"
                      disabled={actingId === lead.id}
                      onClick={() => void handleDeleteOne(lead)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <section className="kaypal-v3-panel flex items-center justify-between p-4">
          <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
            已选 {selectedIds.size} 条
          </span>
          <div className="flex items-center gap-2">
            <V2GhostButton
              loading={bulkActing === "contacted"}
              onClick={() => void handleBulkStatus("contacted", "标记已触达")}
            >
              标记已触达
            </V2GhostButton>
            <V2GhostButton
              loading={bulkActing === "ignored"}
              onClick={() => void handleBulkStatus("ignored", "忽略")}
            >
              忽略
            </V2GhostButton>
            <V2GhostButton
              loading={bulkActing === "delete"}
              onClick={() => void handleBulkDelete()}
            >
              删除
            </V2GhostButton>
            <V2GhostButton onClick={() => setSelectedIds(new Set())}>
              取消选择
            </V2GhostButton>
          </div>
        </section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/growth")}>
          返回增长控制台
        </V2GhostButton>
      </section>

      {/* 手动补充线索弹窗 */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                手动补充线索
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setAddOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <V2Field label="昵称" required hint="对方的平台昵称">
                <V2Input
                  placeholder="例如：装修小王"
                  value={newLead.nickname}
                  onChange={(e) => setNewLead((p) => ({ ...p, nickname: e.target.value }))}
                />
              </V2Field>
              <V2Field label="来源平台">
                <V2Select
                  value={newLead.platform}
                  onChange={(e) => setNewLead((p) => ({ ...p, platform: e.target.value }))}
                >
                  <option value="douyin">抖音</option>
                  <option value="xiaohongshu">小红书</option>
                  <option value="wechat">微信</option>
                </V2Select>
              </V2Field>
              <V2Field label="TA 说了什么" hint="原文/留言，帮你判断意向">
                <V2Textarea
                  rows={3}
                  placeholder="例如：你们这个怎么收费？"
                  value={newLead.sourceText}
                  onChange={(e) => setNewLead((p) => ({ ...p, sourceText: e.target.value }))}
                />
              </V2Field>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <V2GhostButton onClick={() => setAddOpen(false)}>取消</V2GhostButton>
              <V2PrimaryButton loading={adding} onClick={handleAddLead}>
                {adding ? "正在添加..." : "加入线索池"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}
      {modal}
    </div>
  );
}
