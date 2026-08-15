"use client";

import React, { useCallback, useState } from "react";
import { ConfirmModal, type ConfirmModalKind } from "@/components/confirm-modal";

type ConfirmOptions = {
  kind: ConfirmModalKind;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

/**
 * 可复用确认 hook：把 window.confirm 替换为产品内 ConfirmModal。
 *
 * 用法：
 *   const { confirm, modal } = useConfirm();
 *   const ok = await confirm({ kind: "danger", title: "删除", description: "..." });
 *   渲染 {modal}
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const modal = pending ? (
    <ConfirmModal
      open
      kind={pending.kind}
      title={pending.title}
      description={pending.description}
      confirmText={pending.confirmText}
      cancelText={pending.cancelText}
      onConfirm={() => {
        pending.resolve(true);
        setPending(null);
      }}
      onCancel={() => {
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, modal };
}
