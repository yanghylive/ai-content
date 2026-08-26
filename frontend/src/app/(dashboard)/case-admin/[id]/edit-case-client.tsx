"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button, Textarea, addToast } from "@heroui/react";
import { Check, Loader2, X, RotateCcw } from "lucide-react";
import { caseAdminApi, type AdminCase } from "@/lib/api/case-admin";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { OpsDesktopPage, OpsPanel, OpsStatusPill } from "../../components/desktop-ops-ui";
import { CaseForm } from "../case-form";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

const STATUS_META: Record<string, { label: string; tone: "default" | "success" | "warning" | "danger" | "brand" }> = {
  draft: { label: "草稿", tone: "default" },
  submitted: { label: "待审核", tone: "warning" },
  approved: { label: "已批准", tone: "brand" },
  published: { label: "已发布", tone: "success" },
  unpublished: { label: "已下线", tone: "danger" },
  archived: { label: "已归档", tone: "default" },
};

export function EditCaseClient({ id }: { id: string }) {
  const [record, setRecord] = useState<AdminCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setRecord(await caseAdminApi.get(id));
    } catch (e) {
      addToast({ title: "加载失败", description: String((e as Error)?.message ?? e), color: "danger" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (decision: "approved" | "rejected" | "requested_changes") => {
      setActing(true);
      try {
        await caseAdminApi.review(id, { decision, comments: reason || undefined });
        addToast({
          title: decision === "approved" ? "已批准" : decision === "rejected" ? "已驳回" : "已要求修改",
          color: "success",
        });
        setReason("");
        await load();
      } catch (e) {
        addToast({ title: "操作失败", description: String((e as Error)?.message ?? e), color: "danger" });
      } finally {
        setActing(false);
      }
    },
    [id, reason, load],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-default-500">
        案例不存在或已被删除
      </div>
    );
  }

  const status = STATUS_META[record.status] ?? STATUS_META.draft;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <V2BackButton label="返回" to="/case-admin" />
      <OpsDesktopPage
        title={`编辑案例 · ${record.title}`}
        description={`状态：${status.label} · /${record.slug}`}
        actions={<OpsStatusPill tone={status.tone}>{status.label}</OpsStatusPill>}
      >
        {record.status === "submitted" ? (
          <OpsPanel title="审核操作">
            <div className="flex flex-col gap-3">
              <Textarea
                size="sm"
                minRows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="审核意见（批准可留空，驳回/要求修改建议填写原因）"
              />
              <div className="flex flex-wrap gap-2">
                <Button color="success" isLoading={acting} onPress={() => void act("approved")}>
                  <Check className="h-4 w-4" /> 批准
                </Button>
                <Button color="danger" isLoading={acting} onPress={() => void act("rejected")}>
                  <X className="h-4 w-4" /> 驳回
                </Button>
                <Button color="warning" isLoading={acting} onPress={() => void act("requested_changes")}>
                  <RotateCcw className="h-4 w-4" /> 要求修改
                </Button>
              </div>
            </div>
          </OpsPanel>
        ) : null}

        <CaseForm caseId={id} initial={record} />
      </OpsDesktopPage>
    </div>
  );
}
