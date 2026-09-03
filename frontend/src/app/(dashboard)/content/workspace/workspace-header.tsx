"use client";

import {
  AlertCircle,
  Check,
  Cloud,
  CloudOff,
  FilePlus2,
  Loader2,
  Save,
} from "@/components/iconpark";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { V2GhostButton, V2PrimaryButton } from "@/components/v2/ui-kit";
import type { SaveState } from "./workspace-types";

type WorkspaceHeaderProps = {
  title: string;
  saveState: SaveState;
  lastSavedAt: string;
  disabled: boolean;
  creating: boolean;
  onCreate: () => void;
  onSave: () => void;
};

function SaveIndicator({
  state,
  lastSavedAt,
}: {
  state: SaveState;
  lastSavedAt: string;
}) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        正在保存
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-amber)]">
        <Cloud aria-hidden="true" className="h-3.5 w-3.5" />
        等待自动保存
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-danger)]">
        <CloudOff aria-hidden="true" className="h-3.5 w-3.5" />
        保存失败
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
      <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--kaypal-v3-success)]" />
      {lastSavedAt ? `${lastSavedAt} 已保存` : "所有修改已保存"}
    </span>
  );
}

export function WorkspaceHeader({
  title,
  saveState,
  lastSavedAt,
  disabled,
  creating,
  onCreate,
  onSave,
}: WorkspaceHeaderProps) {
  return (
    <header className="border-b border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-3">
      <V2BackButton label="返回" />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate kx-greet text-[var(--kaypal-v3-ink)]">
            {title || "新建内容"}
          </h1>
          <div className="mt-0.5">
            <SaveIndicator lastSavedAt={lastSavedAt} state={saveState} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <V2GhostButton
            aria-label="新建内容草稿"
            icon={FilePlus2}
            loading={creating}
            onClick={onCreate}
          >
            新建
          </V2GhostButton>
          <V2PrimaryButton
            icon={saveState === "error" ? AlertCircle : Save}
            disabled={disabled || saveState === "saving"}
            onClick={onSave}
          >
            {saveState === "error" ? "重试保存" : "保存"}
          </V2PrimaryButton>
        </div>
      </div>
    </header>
  );
}
