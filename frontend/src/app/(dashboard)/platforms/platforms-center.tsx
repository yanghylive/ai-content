"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { publishingApi, type PublishAccount } from "@/lib/api/publishing";
import { toPublicError } from "@/lib/public-error";

const PLATFORM_LABELS: Record<string, string> = {
  gongzhonghao: "公众号",
  wechat: "微信",
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  shipinhao: "视频号",
  weibo: "微博",
  zhihu: "知乎",
  toutiao: "头条",
  "wechat-official": "公众号",
};

export function PlatformsCenter() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await publishingApi.getAccounts();
      setAccounts(Array.isArray(data) ? data : []);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载平台账号失败"));
      reportLoadError(error, "平台账号列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const items: ResourceItem[] = accounts.map((account) => ({
    id: account.id,
    title: account.name,
    description: account.statusLabel || undefined,
    badges: [
      PLATFORM_LABELS[account.platform] || account.platform,
      account.hasApiToken ? "已授权" : "未授权",
    ].filter(Boolean),
    enabled: account.hasApiToken !== false,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchAccounts()} />
      ) : null}
      <ResourceCenter
        title="发布平台"
        subtitle="管理各平台的发布账号和授权状态 · 平台账号登录在发布中心处理"
        resourceName="平台账号"
        icon={Share2}
        items={items}
        loading={loading}
        onCreate={() => router.push("/platforms/new")}
        onItemClick={(item) => router.push(`/platforms/edit?id=${item.id}`)}
      />
    </div>
  );
}
