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
import { useIsMobile } from "@/lib/hooks/use-media-query";

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
  const [runId, setRunId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

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

  /** Skill 试执行（dry-run，P1 接入） */
  const handleRun = async (skill: RedfoxSkill) => {
    setRunId(skill.code || skill.id);
    setError(null);
    try {
      const r = await redfoxApi.runSkill({
        code: skill.code,
        skillId: skill.id,
      });
      setRunResult(r.summary || r.message || (r.ok ? "试执行完成（dry-run）" : "执行失败"));
    } catch (err: unknown) {
      setRunResult(toPublicError(err, "试执行失败"));
    } finally {
      setRunId(null);
      setTimeout(() => setRunResult(null), 5000);
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

  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">数据能力</h1>
              <p className="mx-page-sub">数据能力目录 · 共 {skills.length} 个可用功能</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap" }}
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              <RefreshCcw size={13} style={{ marginRight: 3 }} />
              {syncing ? "同步中…" : "同步"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</p>
          ) : null}
          {notice ? (
            <p style={{ fontSize: 12, color: "#059669", marginBottom: 10 }}>{notice}</p>
          ) : null}
          {runResult ? (
            <p style={{ fontSize: 12, color: "#2563eb", marginBottom: 10 }}>{runResult}</p>
          ) : null}

          {/* 搜索 */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能名 / 平台 / 编码…"
            style={{ width: "100%", marginBottom: 12, padding: "10px 12px", borderRadius: 11, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />

          {loading ? (
            <div className="mx-card mx-list-card">
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>{query ? "没有匹配的技能" : "技能目录为空"}</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>{query ? "换个关键词试试" : "点上方「同步」从数据服务拉取"}</p>
            </div>
          ) : (
            platformGroups.map(([platform, group]) => (
              <section key={platform} className="mx-mt-lg" style={{ marginTop: 0, marginBottom: 14 }}>
                <div className="mx-section-head">
                  <div className="mx-section-title">{PLATFORM_LABELS[platform] || platform}</div>
                  <span className="mx-section-eyebrow">{group.length} 个</span>
                </div>
                <div className="mx-card mx-list-card">
                  {group.map((skill) => (
                    <div key={skill.id || skill.code} className="mx-row">
                      <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb", borderRadius: 999 }}>
                        <Zap size={18} strokeWidth={1.8} />
                      </span>
                      <div className="mx-row-main">
                        <div className="mx-row-title">{skill.name || skill.code}</div>
                        <div className="mx-row-desc">{skill.code}{skill.summary ? ` · ${skill.summary}` : ""}</div>
                      </div>
                      <div className="mx-row-right" style={{ flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span className={`mx-badge ${skill.enabled && skill.status === "available" ? "mx-badge-green" : ""}`}>
                          {skill.enabled && skill.status === "available" ? "可用" : "停用"}
                        </span>
                        <button
                          type="button"
                          style={{ fontSize: 10.5, padding: "4px 8px", borderRadius: 8, background: "rgba(37,99,235,.1)", color: "#2563eb", border: "none" }}
                          disabled={runId === (skill.code || skill.id)}
                          onClick={() => void handleRun(skill)}
                        >
                          {runId === (skill.code || skill.id) ? "执行中…" : "试运行"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

          <button
            type="button"
            style={{ marginTop: 4, fontSize: 12.5, color: "var(--mx-muted)", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => router.push("/intelligence/redfox")}
          >
            <ArrowLeft size={14} /> 返回连接
          </button>
        </div>
      </div>
    );
  }

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
                  <V2GhostButton
                    icon={Zap}
                    loading={runId === (skill.code || skill.id)}
                    onClick={() => void handleRun(skill)}
                  >
                    试运行
                  </V2GhostButton>
                </div>
              ))}
            </div>
          </V2Section>
        ))
      )}
      {runResult ? (
        <p className="text-xs text-[var(--kaypal-v3-accent-ink)]">{runResult}</p>
      ) : null}
    </div>
  );
}
