"use client";

import React from "react";
import { Button, Card, CardBody, Progress, Chip } from "@heroui/react";
import { CheckCircle2, Download, Sparkles, X } from "lucide-react";
import toast from "react-hot-toast";

type UpdateState = {
  configured?: boolean;
  phase?: string;
  hasUpdate?: boolean;
  downloaded?: boolean;
  version?: string | null;
  releaseDate?: string | null;
  releaseNotes?: string | null;
  progress?: number;
  error?: string | null;
};

function useElectron() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setReady(typeof window !== "undefined" && !!window.electronAPI);
  }, []);
  return ready;
}

export function ElectronUpdateBanner() {
  const isElectron = useElectron();
  const [state, setState] = React.useState<UpdateState | null>(null);
  const [dismissedVersion, setDismissedVersion] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"download" | "install" | "skip" | null>(null);

  React.useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    const api = window.electronAPI;

    api.app
      .getUpdateStatus()
      .then((s) => setState(s as UpdateState))
      .catch(() => {});

    const stateKey = api.onUpdateState((s) => {
      setState(s as UpdateState);
      const v = (s as UpdateState).version;
      if (v && v !== dismissedVersion) {
        setDismissedVersion(null);
      }
    });
    const progressKey = api.onUpdateDownloadProgress((p) => {
      setState((prev) =>
        prev
          ? { ...prev, phase: "downloading", progress: p.percent }
          : { phase: "downloading", hasUpdate: true, progress: p.percent },
      );
    });

    return () => {
      api.removeListener(stateKey);
      api.removeListener(progressKey);
    };
  }, [isElectron, dismissedVersion]);

  const isHidden =
    !isElectron ||
    !state ||
    state.configured === false ||
    state.configured === undefined ||
    (!state.hasUpdate && !state.downloaded);

  if (isHidden) return null;

  const version = state.version || "新版本";
  const dismissed = dismissedVersion === state.version;
  if (dismissed && state.phase !== "downloading" && state.phase !== "downloaded") {
    return null;
  }

  const handleDownload = async () => {
    if (!window.electronAPI) return;
    setBusy("download");
    try {
      const r = await window.electronAPI.app.downloadUpdate();
      if (!r.success) toast.error("启动下载失败");
    } finally {
      setBusy(null);
    }
  };

  const handleInstall = async () => {
    if (!window.electronAPI) return;
    setBusy("install");
    try {
      await window.electronAPI.app.installUpdate();
    } finally {
      setBusy(null);
    }
  };

  const handleSkip = async () => {
    if (!window.electronAPI) return;
    setBusy("skip");
    try {
      await window.electronAPI.app.skipUpdate(state.version || null);
      setDismissedVersion(state.version || null);
      toast.success("已跳过此版本");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = () => {
    setDismissedVersion(state.version || null);
  };

  if (state.phase === "downloading") {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <Card className="pointer-events-auto w-full max-w-[420px] border border-default-200 bg-background shadow-lg">
          <CardBody className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold leading-tight">
                    正在下载 v{version}
                  </p>
                  <p className="text-[12px] text-default-500">
                    下载完成后会提示你重启
                  </p>
                </div>
              </div>
              <span className="text-[13px] font-semibold tabular-nums text-primary">
                {state.progress ?? 0}%
              </span>
            </div>
            <Progress
              size="sm"
              value={state.progress ?? 0}
              color="primary"
              aria-label="下载进度"
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (state.downloaded) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <Card className="pointer-events-auto w-full max-w-[420px] border border-success-200 bg-success-50 shadow-lg">
          <CardBody className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-tight text-success-700">
                  v{version} 已下载完成
                </p>
                <p className="mt-0.5 text-[12px] text-default-600">
                  重启应用即可安装新版本。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="light"
                onPress={handleDismiss}
                isDisabled={busy !== null}
              >
                稍后
              </Button>
              <Button
                size="sm"
                color="success"
                onPress={handleInstall}
                isLoading={busy === "install"}
                startContent={
                  busy !== "install" ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : null
                }
              >
                立即重启
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const note = state.releaseNotes
    ? state.releaseNotes.split("\n")[0].slice(0, 120)
    : "包含功能改进和问题修复";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <Card className="pointer-events-auto w-full max-w-[420px] border border-primary-200 bg-background shadow-lg">
        <CardBody className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-[14px] font-semibold leading-tight">
                发现新版本 v{version}
              </p>
              <Chip size="sm" color="primary" variant="flat">
                新
              </Chip>
            </div>
            <button
              type="button"
              aria-label="关闭"
              className="text-default-400 transition hover:text-default-700"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="text-[12px] leading-5 text-default-600">{note}</p>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="light"
              onPress={handleSkip}
              isDisabled={busy !== null}
              isLoading={busy === "skip"}
            >
              跳过此版本
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={handleDismiss}
              isDisabled={busy !== null}
            >
              稍后
            </Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleDownload}
              isLoading={busy === "download"}
              startContent={
                busy !== "download" ? (
                  <Download className="h-4 w-4" aria-hidden="true" />
                ) : null
              }
            >
              立即更新
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default ElectronUpdateBanner;
