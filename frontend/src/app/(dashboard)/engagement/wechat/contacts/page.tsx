"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ContactsPanel } from "../../wechat/contacts-panel";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<
    { id: string; nickname: string; wxid: string; remark?: string; tags: string[] }[]
  >([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(toPublicError(err, "加载联系人失败"));
    }
  }, []);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await localEngineApi.syncWechatContacts();
      await fetchContacts();
    } catch (err: unknown) {
      setError(toPublicError(err, "同步失败，请稍后重试"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
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
