"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ContactsPanel } from "../../wechat/contacts-panel";
import { localEngineApi } from "@/lib/api/local-engine";
import { toActionableError } from "@/lib/public-error";

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<
    { id: string; nickname: string; wxid: string; remark?: string; tags: string[] }[]
  >([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparingNote, setPreparingNote] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await localEngineApi.wechatContacts();
      const items = data.items || [];
      setContacts(
        items.map((c) => ({
          id: c.wxid,
          nickname: c.nickname || c.wxid,
          wxid: c.wxid,
          remark: c.remark,
          tags: c.tags || [],
        })),
      );
    } catch (err: unknown) {
      setError(toActionableError(err, "加载联系人失败"));
    }
  }, []);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setPreparingNote(null);
    try {
      // 首次使用先探组件是否就绪（Windows 需云端下载 db-helper），给用户明确的准备反馈
      try {
        const readiness = await localEngineApi.wechatContactsReadiness();
        const needsComponent = readiness.checks.some(
          (c) => c.key === "db-helper" && c.status === "warning",
        );
        if (needsComponent) {
          setPreparingNote("首次使用需准备本地微信数据组件（自动下载），请稍候…");
        }
      } catch {
        /* readiness 探测失败不阻塞同步 */
      }
      await localEngineApi.syncWechatContacts();
      await fetchContacts();
    } catch (err: unknown) {
      setError(toActionableError(err, "同步失败，请稍后重试"));
    } finally {
      setSyncing(false);
      setPreparingNote(null);
    }
  };

  const exportDiagnostics = async () => {
    try {
      const res = await fetch(
        "/api/local-engine/wechat/contacts/diagnostics/export",
      );
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `微信联系人同步排查-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* 导出失败静默，不打扰用户 */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
          <button
            type="button"
            onClick={() => void exportDiagnostics()}
            className="mt-2 text-xs font-medium text-[var(--kaypal-v3-danger)] underline underline-offset-2 hover:opacity-80"
          >
            导出排查资料（可发给客服定位问题）
          </button>
        </div>
      )}
      {preparingNote && !error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-warning)] bg-[var(--kaypal-v3-warning-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-warning)]">{preparingNote}</p>
        </div>
      )}
      <ContactsPanel
        contacts={contacts}
        syncing={syncing}
        onSync={() => void handleSync()}
        onDelete={(id) => console.log("删除联系人:", id)}
        onCancel={() => router.push("/engagement/wechat")}
      />
    </div>
  );
}
