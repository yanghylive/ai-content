"use client";

import React from "react";
import { Button, Chip, Switch, addToast } from "@heroui/react";
import {
  FolderSearch,
  Gauge,
  MonitorCog,
  RefreshCw,
  UploadCloud,
} from "@/components/iconpark";
import { SkeletonList } from "@/components/skeleton";

type DesktopConfigBridge = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
};

type SettingRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: string;
  statusColor?: "default" | "primary" | "success" | "warning" | "danger";
  control?: React.ReactNode;
};

function SettingRow({
  icon,
  title,
  description,
  status,
  statusColor = "default",
  control,
}: SettingRowProps) {
  return (
    <div className="desktop-setting-row grid min-w-0 gap-3 border-b border-divider py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-default-100 text-default-600">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-default-900">{title}</h3>
            <Chip color={statusColor} size="sm" variant="flat">
              {status}
            </Chip>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-default-500">
            {description}
          </p>
        </div>
      </div>
      {control ? (
        <div className="desktop-setting-row__control flex min-w-0 justify-start sm:justify-end">
          {control}
        </div>
      ) : null}
    </div>
  );
}

function readBooleanPreference(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function DesktopSettings() {
  const [bridge, setBridge] = React.useState<DesktopConfigBridge | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [autoReconnect, setAutoReconnect] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    const configBridge = window.electronAPI?.config as
      | DesktopConfigBridge
      | undefined;

    if (!configBridge) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setBridge(configBridge);
    configBridge
      .get("autoStartService")
      .then((value) => {
        if (!active) return;
        setAutoReconnect(readBooleanPreference(value, true));
        setLoadFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const reloadPreference = async () => {
    if (!bridge || loading) return;
    setLoading(true);
    try {
      const value = await bridge.get("autoStartService");
      setAutoReconnect(readBooleanPreference(value, true));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      addToast({
        title: "桌面设置仍无法读取",
        description: "请确认桌面服务已经启动，再重新读取。",
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoReconnectChange = async (nextValue: boolean) => {
    if (!bridge || saving) return;
    const previousValue = autoReconnect;
    setAutoReconnect(nextValue);
    setSaving(true);
    try {
      await bridge.set("autoStartService", nextValue);
      addToast({
        title: nextValue ? "自动恢复连接已开启" : "自动恢复连接已关闭",
        description: nextValue
          ? "桌面服务中断后会自动尝试恢复。"
          : "桌面服务中断后需要手动重新打开应用。",
        color: nextValue ? "success" : "warning",
      });
    } catch {
      setAutoReconnect(previousValue);
      addToast({
        title: "设置未更新",
        description: "自动恢复连接暂时无法修改，请重试。",
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const isDesktop = Boolean(bridge);
  const desktopStatus = loading
    ? "正在读取"
    : isDesktop
      ? loadFailed
        ? "需重新读取"
        : "桌面版已连接"
      : "仅桌面版可用";

  return (
    <div className="desktop-settings min-w-0">
      <div className="flex min-w-0 flex-col gap-3 border-b border-divider pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-default-900">
              桌面运行设置
            </h2>
            <Chip
              color={isDesktop && !loadFailed ? "success" : "default"}
              size="sm"
              variant="flat"
            >
              {desktopStatus}
            </Chip>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-default-500">
            管理当前电脑上的连接恢复方式，并查看仍由桌面应用自动处理的选项。
          </p>
        </div>
        {loading ? (
          <SkeletonList rows={3} />
        ) : loadFailed && bridge ? (
          <Button
            size="sm"
            startContent={<RefreshCw aria-hidden="true" size={15} />}
            variant="flat"
            onPress={() => void reloadPreference()}
          >
            重新读取
          </Button>
        ) : null}
      </div>

      <SettingRow
        description={
          isDesktop
            ? "桌面应用会自动查找已安装的微信。当前版本暂不支持在这里手动修改位置。"
            : "请在 JIUZHANG AI 桌面版中查看。浏览器不会读取电脑上的微信位置。"
        }
        icon={<FolderSearch aria-hidden="true" size={17} />}
        status={isDesktop ? "自动识别" : "桌面版可用"}
        title="微信应用位置"
      />

      <SettingRow
        control={
          <Switch
            aria-label="自动恢复连接"
            color="success"
            isDisabled={!isDesktop || loading || loadFailed || saving}
            isSelected={isDesktop && !loadFailed && autoReconnect}
            onValueChange={handleAutoReconnectChange}
          >
            {!isDesktop
              ? "桌面版中设置"
              : loadFailed
                ? "暂时无法读取"
                : saving
                  ? "正在更新"
                  : autoReconnect
                    ? "已开启"
                    : "已关闭"}
          </Switch>
        }
        description={
          isDesktop
            ? "桌面服务意外中断时自动尝试恢复；重新打开应用后继续沿用此设置。"
            : "此开关由桌面版保存，浏览器中不会显示为已更新。"
        }
        icon={
          saving ? (
            <RefreshCw aria-hidden="true" className="animate-spin" size={17} />
          ) : (
            <MonitorCog aria-hidden="true" size={17} />
          )
        }
        status={
          !isDesktop
            ? "桌面版可用"
            : loadFailed
              ? "暂时无法读取"
              : "可设置"
        }
        statusColor={
          isDesktop && !loadFailed
            ? autoReconnect
              ? "success"
              : "warning"
            : "default"
        }
        title="自动恢复连接"
      />

      <SettingRow
        description="当前版本采用固定的状态更新频率，尚未提供自定义选项。"
        icon={<Gauge aria-hidden="true" size={17} />}
        status="暂不可设置"
        title="AI 专家状态更新"
      />

      <SettingRow
        control={
          <Button as="a" href="/tasks/records" size="sm" variant="flat">
            查看任务记录
          </Button>
        }
        description="当前只支持从任务记录导出问题资料，不会自动发送。资料发送功能尚未提供。"
        icon={<UploadCloud aria-hidden="true" size={17} />}
        status="仅支持导出"
        title="问题资料发送"
      />
    </div>
  );
}
