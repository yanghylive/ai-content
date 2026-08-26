"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import {
  V2Field,
  V2GhostButton,
  V2Input,
  V2PrimaryButton,
  V2Select,
  V2Textarea,
} from "@/components/v2/ui-kit";
import {
  getCrmOpportunity,
  updateCrmOpportunity,
  closeCrmOpportunity,
  type CrmOpportunity,
} from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

/** 商机阶段 8 态（对齐后端 OPPORTUNITY_STAGES + status-dictionary CRM_STATUS） */
const STAGES: Array<{ key: string; label: string }> = [
  { key: "new", label: "新商机" },
  { key: "qualified", label: "资格确认" },
  { key: "discovery", label: "发现阶段" },
  { key: "proposal", label: "提案" },
  { key: "negotiation", label: "谈判" },
  { key: "won", label: "成交" },
  { key: "lost", label: "失单" },
  { key: "nurture", label: "暂缓" },
];

/**
 * 商机详情弹窗（报告 7.4）：点击商机不再只跳客户详情，而是展示
 * 商机本身——阶段推进、金额、预计成交、下一步、失单原因，写回后端。
 */
export function OpportunityDetailModal({
  opportunityId,
  onClose,
  onChanged,
}: {
  opportunityId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [opp, setOpp] = useState<CrmOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [loseReason, setLoseReason] = useState("");
  const [winReason, setWinReason] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await getCrmOpportunity(opportunityId);
      setOpp(o);
      setStage(o.stage || "new");
      setAmountYuan(o.amountCents ? String((o.amountCents / 100).toFixed(2)) : "");
      setNextStep(o.nextStep || "");
      setLoseReason("");
      setWinReason(o.winReason || "");
      setCloseDate(o.closeDate ? o.closeDate.slice(0, 10) : "");
    } catch (err: unknown) {
      setError(toPublicError(err, "商机详情读取失败"));
    } finally {
      setLoading(false);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const amountCents = amountYuan
        ? Math.round(Number(amountYuan) * 100)
        : undefined;
      if (stage === "won") {
        // P2 T05：成交走语义接口（必填：金额>0 + closeDate + winReason）
        if (!amountCents || amountCents <= 0) {
          setError("成交商机必须填写大于 0 的金额");
          setSaving(false);
          return;
        }
        if (!closeDate) {
          setError("成交商机必须填写预计成交日期");
          setSaving(false);
          return;
        }
        await closeCrmOpportunity(opportunityId, {
          result: "won",
          winReason: winReason || "客户确认成交",
          amountCents,
          closeDate,
        });
      } else {
        await updateCrmOpportunity(opportunityId, {
          stage,
          ...(Number.isFinite(amountCents) ? { amountCents } : {}),
          nextStep: nextStep || undefined,
          ...(stage === "lost" ? { loseReason: loseReason || "未填写失单原因" } : {}),
        });
      }
      setSaved(true);
      onChanged();
      window.setTimeout(onClose, 600);
    } catch (err: unknown) {
      setError(toPublicError(err, "商机保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] p-5">
          <div>
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
              {opp?.name || "商机详情"}
            </h3>
            <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
              {opp?.primaryCustomerName
                ? `客户：${opp.primaryCustomerName}`
                : "未关联客户"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[var(--kaypal-v3-muted)]">
              <SkeletonList rows={3} />
            </div>
          ) : error && !saved ? (
            <p className="text-sm text-[var(--kaypal-v3-danger)]">{error}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <V2Field label="阶段" hint="推进阶段会写回时间线">
                <V2Select value={stage} onChange={(e) => setStage(e.target.value)}>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </V2Select>
              </V2Field>

              <V2Field label="预计金额（元）">
                <V2Input
                  inputMode="decimal"
                  value={amountYuan}
                  onChange={(e) => setAmountYuan(e.target.value)}
                  placeholder="如 12800.00"
                />
              </V2Field>

              <V2Field label="下一步" hint="下一步跟进动作，如「周五发报价单」">
                <V2Input
                  value={nextStep}
                  onChange={(e) => setNextStep(e.target.value)}
                  placeholder="下一步动作"
                />
              </V2Field>

              {stage === "lost" && (
                <V2Field label="失单原因" hint="失单必填，供复盘归因" required>
                  <V2Textarea
                    rows={3}
                    value={loseReason}
                    onChange={(e) => setLoseReason(e.target.value)}
                    placeholder="为什么没成交？价格 / 竞品 / 时机…"
                  />
                </V2Field>
              )}

              {stage === "won" && (
                <>
                  <V2Field label="成交日期" hint="成交必填（默认今天）" required>
                    <V2Input
                      type="date"
                      value={closeDate}
                      onChange={(e) => setCloseDate(e.target.value)}
                    />
                  </V2Field>
                  <V2Field label="成交原因" hint="成交必填，供复盘归因" required>
                    <V2Textarea
                      rows={3}
                      value={winReason}
                      onChange={(e) => setWinReason(e.target.value)}
                      placeholder="为什么成交？需求匹配 / 价格优势 / 信任…"
                    />
                  </V2Field>
                </>
              )}

              {saved && (
                <p className="text-sm text-[var(--kaypal-v3-success)]">已保存 ✓</p>
              )}
              {error && saved && (
                <p className="text-sm text-[var(--kaypal-v3-danger)]">{error}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--kaypal-v3-border)] p-4">
          <V2GhostButton onClick={onClose}>取消</V2GhostButton>
          <V2PrimaryButton
            icon={Save}
            loading={saving}
            disabled={
            loading ||
            (stage === "lost" && !loseReason.trim()) ||
            (stage === "won" && (!closeDate || !winReason.trim()))
          }
            onClick={() => void handleSave()}
          >
            保存
          </V2PrimaryButton>
        </div>
      </div>
    </div>
  );
}
