"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Database, RefreshCcw, Search, Zap } from "lucide-react";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Input,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "公众号",
  bilibili: "B站",
  kuaishou: "快手",
  tiktok: "TikTok",
  web: "全网",
};

/** 数据能力（RedFox 技能目录）——真实技能列表，不再是写死的示例 */
export function RedfoxSkillsCenter() {
  const router = useRouter();
  const [skills, setSkills] = useState<RedfoxSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await redfoxApi.listSkills({ limit: 100 } as never);
      const data = result as { items?: RedfoxSkill[] } | RedfoxSkill[] | null;
      const items = Array.isArray(data) ? data : data?.items || [];
      setSkills(items);
    } catch (err: unknown) {
      setError(toPublicError(err, "技能目录读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await redfoxApi.syncSkills({} as never);
      setNotice("技能目录已同步");
      await load();
    } catch (err: unknown) {
      setError(toPublicError(err, "同步失败"));
    } finally {
      setSyncing(false);
      setTimeout(() => setNotice(null), 3000);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      [s.name, s.platform, s.code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [skills, query]);

  const platformGroups = useMemo(() => {
    const map = new Map<string, RedfoxSkill[]>();
    for (const s of filtered) {
      const p = s.platform || "web";
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              数据能力
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              数据能力目录 · 共 {skills.length} 个可用功能
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} loading={syncing} onClick={handleSync}>
            {syncing ? "正在同步..." : "同步目录"}
          </V2GhostButton>
          <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/intelligence/redfox")}>
            返回连接
          </V2GhostButton>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4 text-sm text-[var(--kaypal-v3-success)]">
          {notice}
        </p>
      )}

      {/* 搜索 */}
      <section>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
          <V2Input
            className="pl-9"
            placeholder="搜索技能名 / 平台 / 编码…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </section>

      {/* 技能列表（按平台分组） */}
      {loading ? (
        <div className="py-10 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <V2EmptyState
          icon={Zap}
          title={query ? "没有匹配的技能" : "技能目录为空"}
          description={query ? "换个关键词试试" : "点右上角「同步目录」从数据服务拉取"}
        />
      ) : (
        platformGroups.map(([platform, group]) => (
          <V2Section
            key={platform}
            title={`${PLATFORM_LABELS[platform] || platform}（${group.length}）`}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {group.map((skill) => (
                <div
                  key={skill.id || skill.code}
                  className="kaypal-v3-surface flex items-center justify-between p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {skill.name || skill.code}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-muted)]">
                      {skill.code}{skill.summary ? ` · ${skill.summary}` : ""}
                    </p>
                  </div>
                  <V2StatusChip tone={skill.enabled && skill.status === "available" ? "success" : "muted"}>
                    {skill.enabled && skill.status === "available" ? "可用" : "停用"}
                  </V2StatusChip>
                </div>
              ))}
            </div>
          </V2Section>
        ))
      )}
    </div>
  );
}
