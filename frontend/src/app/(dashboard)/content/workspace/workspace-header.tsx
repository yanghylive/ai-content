"use client";

import { Button, Tooltip } from "@heroui/react";
import {
  AlertCircle,
  Check,
  Cloud,
  CloudOff,
  FilePlus2,
  Loader2,
  Save,
} from "lucide-react";
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
      <span className="flex items-center gap-1.5 text-xs text-default-500">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        正在保存
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-warning-700">
        <Cloud aria-hidden="true" className="h-3.5 w-3.5" />
        等待自动保存
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger-600">
        <CloudOff aria-hidden="true" className="h-3.5 w-3.5" />
        保存失败
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-default-500">
      <Check aria-hidden="true" className="h-3.5 w-3.5 text-success-600" />
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
    <header className="flex flex-col gap-3 border-b border-divider bg-content1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-foreground">
            内容工作室
          </h1>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="max-w-[260px] truncate text-xs text-default-400">
            {title || "从队列选择内容开始编辑"}
          </span>
          <span aria-hidden="true" className="text-default-300">·</span>
          <SaveIndicator lastSavedAt={lastSavedAt} state={saveState} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="新建一篇持久化内容草稿">
          <Button
            aria-label="新建内容草稿"
            isIconOnly
            isLoading={creating}
            radius="sm"
            size="sm"
            variant="flat"
            onPress={onCreate}
          >
            <FilePlus2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Button
          className="hidden xl:inline-flex"
          isDisabled={disabled || saveState === "saving"}
          radius="sm"
          size="sm"
          startContent={
            saveState === "error" ? (
              <AlertCircle aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )
          }
          variant="bordered"
          onPress={onSave}
        >
          {saveState === "error" ? "重试保存" : "保存"}
        </Button>
      </div>
    </header>
  );
}
