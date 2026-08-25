"use client";

import React from "react";
import { Button, Chip, Input } from "@heroui/react";
import { Layers, Plus, ExternalLink } from "lucide-react";
import toast from "@/lib/toast";
import { workspaceApi, type Workspace } from "@/lib/api/workspace";
import { useOctopLaunch } from "@/hooks/use-octop-launch";

type TabInfo = {
  id: string;
  title: string;
  workspaceId?: string | null;
} | null;

type WorkspaceTabsApi = NonNullable<Window["electronAPI"]>["workspaceTabs"];

function useElectronWorkspaceTabs(): WorkspaceTabsApi | null {
  const [api, setApi] = React.useState<WorkspaceTabsApi | null>(null);
  React.useEffect(() => {
    setApi(
      typeof window !== "undefined" && window.electronAPI?.workspaceTabs
        ? window.electronAPI.workspaceTabs
        : null,
    );
  }, []);
  return api;
}

/**
 * 4.4 多工作区标签壳 · 前端 React 切换器。
 * - 列出当前用户的工作区，选中后绑定到「当前 Electron 标签」（electronAPI.workspaceTabs.setWorkspaceId），
 *   由桌面壳把 x-workspace-id 注入该标签的 backend 请求。
 * - 支持新建工作区（创建后自动绑定到当前标签）。
 * - 支持「新标签」打开（桌面端多标签）。
 * - 非 Electron 环境（web）优雅降级：工作区列表/新建仍可用，绑定/多标签提示仅桌面端支持。
 * - Octop 拉起：与全局 OctopLaunchBridge 共用 useOctopLaunch（事件监听在根 layout，本组件只留按钮）。
 */
export function WorkspaceSwitcher() {
  const tabs = useElectronWorkspaceTabs();
  const { launchOctop } = useOctopLaunch();
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [active, setActive] = React.useState<TabInfo>(null);
  const [loading, setLoading] = React.useState(true);
  const [newName, setNewName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refreshWorkspaces = React.useCallback(async () => {
    try {
      const list = await workspaceApi.list();
      setWorkspaces(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载工作区失败");
    }
  }, []);

  const syncActive = React.useCallback(async () => {
    if (!tabs) return;
    try {
      const a = (await tabs.getActive()) as TabInfo;
      setActive(a);
    } catch {
      /* 桌面端取当前标签失败不阻塞 */
    }
  }, [tabs]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      await refreshWorkspaces();
      if (tabs) {
        try {
          const a = (await tabs.getActive()) as TabInfo;
          if (alive) setActive(a);
        } catch {
          /* 桌面端取当前标签失败不阻塞列表 */
        }
      }
      if (alive) setLoading(false);
    })();
    const onFocus = () => void syncActive();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshWorkspaces, tabs, syncActive]);

  const boundId = active?.workspaceId || "";

  const handleSelect = async (wsId: string) => {
    if (!tabs || !active) {
      toast.error("仅在桌面端可将工作区绑定到标签");
      return;
    }
    setBusy(true);
    try {
      await tabs.setWorkspaceId(active.id, wsId || null);
      setActive((prev) => (prev ? { ...prev, workspaceId: wsId || null } : prev));
      toast.success(wsId ? "已绑定工作区到当前标签" : "已解绑当前标签工作区");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("请填写工作区名称");
      return;
    }
    setBusy(true);
    try {
      const ws = await workspaceApi.create(name);
      setNewName("");
      await refreshWorkspaces();
      toast.success(`已创建工作区「${ws.name}」`);
      if (tabs && active) {
        await tabs.setWorkspaceId(active.id, ws.id);
        setActive((prev) => (prev ? { ...prev, workspaceId: ws.id } : prev));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenTab = async () => {
    if (!tabs) {
      toast.error("仅桌面端支持多标签");
      return;
    }
    setBusy(true);
    try {
      await tabs.open(boundId || null, boundId ? "工作区标签" : "新工作区");
      toast.success("已打开新标签");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开失败");
    } finally {
      setBusy(false);
    }
  };

  // launchOctop 来自共享 useOctopLaunch；octop:request-launch 事件监听已全局化到根 layout 的 OctopLaunchBridge
  //（之前只在 Dashboard 注册——登录页/非 Dashboard 页点顶部按钮无前端处理者，2026-08-24 审计 #6）

  if (loading) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-default-200 bg-content1 px-3 py-2 shadow-sm">
      <span className="flex items-center gap-1 text-13 font-semibold text-default-600">
        <Layers size={15} className="text-primary" aria-hidden="true" />
        工作区
      </span>
      <select
        aria-label="绑定到当前标签的工作区"
        className="rounded-[6px] border border-default-200 bg-background px-2 py-1 text-13 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        value={boundId}
        disabled={busy}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="">（未绑定）</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </select>
      {boundId ? (
        <Chip size="sm" variant="flat" color="primary">
          WS:{boundId.slice(0, 8)}
        </Chip>
      ) : null}
      <Input
        size="sm"
        placeholder="新工作区名称"
        value={newName}
        onValueChange={setNewName}
        className="w-40"
        classNames={{ inputWrapper: "rounded-[6px] bg-background" }}
      />
      <Button
        size="sm"
        color="primary"
        isLoading={busy}
        onPress={handleCreate}
        startContent={!busy ? <Plus size={14} /> : null}
      >
        新建
      </Button>
      <Button
        size="sm"
        variant="flat"
        isDisabled={busy || !tabs}
        onPress={handleOpenTab}
        startContent={!busy ? <ExternalLink size={14} /> : null}
      >
        新标签
      </Button>
      <Button
        size="sm"
        variant="flat"
        isDisabled={busy || !tabs}
        onPress={() => tabs?.switchBusiness()}
        startContent={!busy ? <Layers size={14} /> : null}
      >
        业务工作区
      </Button>
      <Button
        size="sm"
        color="warning"
        isDisabled={busy || !tabs}
        onPress={() => void launchOctop()}
        startContent={!busy ? <ExternalLink size={14} /> : null}
      >
        Octop 高级模式
      </Button>
      {!tabs ? (
        <span className="text-12 text-default-400">
          标签绑定仅桌面端可用
        </span>
      ) : null}
    </div>
  );
}

export default WorkspaceSwitcher;
