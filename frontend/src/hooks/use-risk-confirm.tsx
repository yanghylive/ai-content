"use client";

import { useCallback, useState, type ReactNode } from "react";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";

type RiskLevel = "low" | "medium" | "high";

export interface RiskConfirmOptions {
  title: string;
  description: string;
  riskLevel?: RiskLevel;
  confirmLabel?: string;
  cancelLabel?: string;
  impactItems?: Array<{ label: string; value: ReactNode }>;
  checklist?: string[];
}

/**
 * P0 规范层 · 风险确认 hook（对应 PRD 验收 check 8）
 *
 * 复用已有 RiskConfirmationDialog（@/components/risk-confirmation-dialog），
 * 把「打开 → 执行真实外部动作 → loading → 关闭」收敛成一个调用，
 * 让发布 / 群发 / 外部触达 / 权限 / 删除等不可逆动作统一走确认。
 *
 * 用法：
 *   const { request, dialog } = useRiskConfirm();
 *   return (<>
 *     <Button onPress={() => request({ title:'发布', description:'...', riskLevel:'high' }, doPublish)}>发布</Button>
 *     {dialog}
 *   </>);
 */
export function useRiskConfirm() {
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [options, setOptions] = useState<RiskConfirmOptions | null>(null);
  const [confirm, setConfirm] = useState<() => Promise<void> | void>(() => () => {});

  const request = useCallback((opts: RiskConfirmOptions, onConfirm: () => Promise<void> | void) => {
    setOptions(opts);
    setConfirm(() => onConfirm);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (isLoading) return; // 执行中禁止误关
    setOpen(false);
  }, [isLoading]);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      await confirm();
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }, [confirm]);

  const dialog = options ? (
    <RiskConfirmationDialog
      isOpen={isOpen}
      isLoading={isLoading}
      onCancel={close}
      onConfirm={handleConfirm}
      title={options.title}
      description={options.description}
      riskLevel={options.riskLevel ?? "high"}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      impactItems={options.impactItems}
      checklist={options.checklist}
    />
  ) : null;

  return { request, dialog };
}
