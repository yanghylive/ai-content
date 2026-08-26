"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import {
  contentStrategiesApi,
  strategyTemplateApi,
  type ContentStrategy,
  type IndustryInfo,
  type StrategyTemplate,
} from "@/lib/api/content-strategies";
import { toPublicError } from "@/lib/public-error";

export function StrategiesCenter() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  // 行业模板库（2026-08-09 R1）
  const [industries, setIndustries] = useState<IndustryInfo[]>([]);
  const [activeIndustry, setActiveIndustry] = useState<string>("");
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const fetchStrategies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await contentStrategiesApi.list();
      setStrategies(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载内容策略失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIndustries = useCallback(async () => {
    try {
      const data = await strategyTemplateApi.industries();
      const list = data.items || [];
      setIndustries(list);
      if (list.length > 0 && !activeIndustry) {
        setActiveIndustry(list[0].industry);
      }
    } catch {
      /* 模板库不可用静默（策略列表仍可用） */
    }
  }, [activeIndustry]);

  useEffect(() => {
    void fetchStrategies();
    void fetchIndustries();
  }, [fetchStrategies, fetchIndustries]);

  const fetchTemplates = useCallback(
    async (industry: string, type: string) => {
      setTemplatesLoading(true);
      try {
        const data = await strategyTemplateApi.templates({ industry, type, limit: 12 });
        setTemplates(data.items || []);
      } catch {
        setTemplates([]);
      } finally {
        setTemplatesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeIndustry) void fetchTemplates(activeIndustry, "title");
  }, [activeIndustry, fetchTemplates]);

  const items: ResourceItem[] = strategies.map((s) => ({
    id: s.id,
    title: s.name,
    description: s.description || s.commercialGoal || undefined,
    badges: [s.industry, s.targetAudience].filter(Boolean) as string[],
    isDefault: s.isDefault,
    enabled: s.enabled,
  }));

  const typeLabel: Record<string, string> = {
    title: "标题",
    article: "文案",
    topic: "选题",
    image_prompt: "配图",
  };

  return (
    <div>
      <ResourceCenter
        title="内容策略"
        subtitle="定义你的内容方向和目标，AI 按策略生成内容"
        resourceName="策略"
        icon={Compass}
        items={items}
        loading={loading}
        onCreate={() => router.push("/strategies/new")}
        onItemClick={(item) => router.push(`/strategies/edit?id=${encodeURIComponent(item.id)}`)}
      />

      {/* 行业模板库（2026-08-09 R1：14 行业 × 标题/文案/选题/配图） */}
      {industries.length > 0 ? (
        <section className="mx-px" style={{ marginTop: 16, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🏭 行业模板库</div>
            <div style={{ fontSize: 11, color: "rgba(148,163,184,.7)", marginBottom: 12, lineHeight: 1.6 }}>
              按行业挑选现成标题、文案、选题与配图思路，一键生成同款
            </div>

            {/* 行业 chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {industries.map((ind) => (
                <button
                  key={ind.industry}
                  type="button"
                  onClick={() => setActiveIndustry(ind.industry)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    border: activeIndustry === ind.industry ? "1px solid var(--kaypal-v3-amber)" : "1px solid rgba(142,165,190,.3)",
                    background: activeIndustry === ind.industry ? "rgba(246,196,120,.12)" : "transparent",
                    color: activeIndustry === ind.industry ? "var(--kaypal-v3-amber)" : "rgba(215,230,248,.7)",
                    cursor: "pointer",
                  }}
                >
                  {ind.industry}
                </button>
              ))}
            </div>

            {/* 类型切换 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {Object.entries(typeLabel).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void fetchTemplates(activeIndustry, key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 8,
                    fontSize: 11,
                    border: "1px solid rgba(142,165,190,.25)",
                    background: "rgba(255,255,255,.05)",
                    color: "rgba(215,230,248,.75)",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 模板列表 */}
            {templatesLoading ? (
              <div style={{ fontSize: 12, color: "rgba(148,163,184,.7)", padding: "16px 0", textAlign: "center" }}>
                加载中…
              </div>
            ) : templates.length === 0 ? (
              <div style={{ fontSize: 12, color: "rgba(148,163,184,.6)", padding: "16px 0", textAlign: "center" }}>
                该行业暂无模板
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,.04)",
                      border: "1px solid rgba(142,165,190,.18)",
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      color: "var(--kaypal-v3-soft-ink)",
                    }}
                  >
                    {t.title || t.content}
                    {t.hook ? (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 8px",
                          borderRadius: 999,
                          fontSize: 10,
                          background: "rgba(246,196,120,.12)",
                          color: "var(--kaypal-v3-amber)",
                        }}
                      >
                        {t.hook}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
