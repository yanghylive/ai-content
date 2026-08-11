"use client";

import { useCallback, useState } from "react";
import {
  BarChart3,
  Lightbulb,
  Loader2,
  MessageCircle,
  Play,
  Sparkles,
} from "lucide-react";
import {
  commentInsightsApi,
  type CommentAnalyzeResult,
} from "@/lib/api/reply";
import { toPublicError } from "@/lib/public-error";

const PLATFORM_OPTIONS = [
  { value: "all", label: "全部平台" },
  { value: "douyin", label: "抖音" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "wechat_channel", label: "视频号" },
  { value: "bilibili", label: "哔哩哔哩" },
];

const SOURCE_OPTIONS = [
  { value: "manual_comments", label: "手动粘贴评论" },
  { value: "hot_video", label: "爆款视频评论" },
  { value: "keyword", label: "关键词评论" },
];

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(142,165,190,.18)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--mx-ink, #e8eef7)",
          marginBottom: 10,
        }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function InsightItems({
  items,
  emptyText,
}: {
  items?: Array<{ point?: string; count?: number; examples?: string[] }>;
  emptyText: string;
}) {
  if (!items || items.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--mx-muted, #9fb2c8)" }}>{emptyText}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
          <span style={{ color: "var(--mx-ink, #e8eef7)" }}>{item.point}</span>
          <span style={{ color: "var(--mx-accent, #e39a3e)", marginLeft: 6, fontSize: 12 }}>
            ×{item.count ?? 1}
          </span>
          {item.examples && item.examples.length > 0 ? (
            <div style={{ color: "var(--mx-muted, #9fb2c8)", fontSize: 12, marginTop: 2 }}>
              {item.examples.slice(0, 3).map((ex, j) => (
                <div key={j}>「{ex}」</div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const INTENT_LABEL: Record<string, string> = {
  purchase: "购买意向",
  consult: "咨询意向",
  browse: "浏览意向",
  unknown: "未知",
};

export function CommentInsightsContent() {
  const [commentsText, setCommentsText] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sourceType, setSourceType] = useState("manual_comments");
  const [sourceUrl, setSourceUrl] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [productName, setProductName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CommentAnalyzeResult | null>(null);

  const runAnalyze = useCallback(async () => {
    const comments = commentsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (comments.length === 0) {
      setError("请先粘贴至少一条评论（一行一条）");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await commentInsightsApi.analyze({
        platform: platform === "all" ? undefined : platform,
        sourceType,
        sourceUrl: sourceUrl || undefined,
        workTitle: workTitle || undefined,
        productName: productName || undefined,
        keyword: keyword || undefined,
        comments,
      });
      setResult(data);
    } catch (err) {
      setError(toPublicError(err, "分析失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, [commentsText, platform, sourceType, sourceUrl, workTitle, productName, keyword]);

  // 示例：方便快速体验
  const loadSample = useCallback(() => {
    setCommentsText(
      [
        "这个多少钱啊？想买",
        "用了两周感觉还行，就是包装有点简陋",
        "有优惠券吗？最近想入手",
        "客服态度不错，就是发货太慢了",
        "跟 XX 比哪个好？纠结",
        "质量怎么样，有人买过吗",
      ].join("\n"),
    );
    setProductName("AI 内容助手");
    setWorkTitle("AI 内容创作工具测评");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 16,
          fontWeight: 700,
          color: "var(--mx-ink, #e8eef7)",
        }}
      >
        <MessageCircle size={18} style={{ color: "var(--mx-accent, #e39a3e)" }} />
        评论洞察工作台
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--mx-muted, #9fb2c8)" }}>
          把评论转成痛点、需求、异议、意向词和回复建议
        </span>
      </div>

      {/* 输入区 */}
      <SectionCard title="输入评论" icon={<BarChart3 size={14} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={commentsText}
            onChange={(e) => setCommentsText(e.target.value)}
            placeholder={"粘贴评论内容，一行一条…\n例如：\n这个多少钱啊？想买\n质量怎么样，有人买过吗"}
            rows={6}
            style={{
              width: "100%",
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(142,165,190,.25)",
              borderRadius: 10,
              color: "var(--mx-ink, #e8eef7)",
              padding: "10px 12px",
              fontSize: 13,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              style={selectStyle}
            >
              {PLATFORM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              style={selectStyle}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="作品链接（可选）"
              style={inputStyle}
            />
            <input
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              placeholder="作品标题（可选）"
              style={inputStyle}
            />
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="产品/服务名称（用于回复建议）"
              style={{ ...inputStyle, flex: 2, minWidth: 200 }}
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="分析关键词（可选）"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => void runAnalyze()}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#e39a3e,#f6c478)",
                color: "#173052",
                fontWeight: 700,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? "分析中…" : "开始分析"}
            </button>
            <button
              type="button"
              onClick={loadSample}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(142,165,190,.3)",
                background: "transparent",
                color: "var(--mx-ink, #e8eef7)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <Sparkles size={14} />
              填入示例
            </button>
          </div>
          {error ? (
            <div style={{ fontSize: 13, color: "#ff8a8a" }}>{error}</div>
          ) : null}
        </div>
      </SectionCard>

      {/* 结果区 */}
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--mx-muted, #9fb2c8)",
            }}
          >
            <span>
              分析 {result.analyzedCount} 条评论 · 洞察编号 {result.insightId}
            </span>
            <span style={{ color: "var(--mx-accent, #e39a3e)" }}>平台：{result.platform || "全部"}</span>
          </div>
          {result.summary ? (
            <SectionCard title="总体摘要" icon={<Lightbulb size={14} />}>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--mx-ink, #e8eef7)" }}>
                {result.summary}
              </div>
            </SectionCard>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            <SectionCard title="痛点" icon={<BarChart3 size={14} />}>
              <InsightItems items={result.painPoints} emptyText="未识别到明显痛点" />
            </SectionCard>
            <SectionCard title="需求" icon={<BarChart3 size={14} />}>
              <InsightItems items={result.demands} emptyText="未识别到明显需求" />
            </SectionCard>
            <SectionCard title="异议" icon={<BarChart3 size={14} />}>
              <InsightItems items={result.objections} emptyText="未识别到明显异议" />
            </SectionCard>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            <SectionCard title="意向关键词" icon={<BarChart3 size={14} />}>
              {result.intentKeywords?.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.intentKeywords.map((k, i) => (
                    <span
                      key={i}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        background:
                          k.intentLevel === "purchase"
                            ? "rgba(227,154,62,.18)"
                            : "rgba(142,165,190,.14)",
                        color: k.intentLevel === "purchase" ? "#f6c478" : "var(--mx-ink, #e8eef7)",
                      }}
                    >
                      {k.keyword} · {INTENT_LABEL[k.intentLevel] ?? k.intentLevel} ×{k.count}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--mx-muted, #9fb2c8)" }}>无</div>
              )}
            </SectionCard>
            <SectionCard title="高频问题" icon={<BarChart3 size={14} />}>
              {result.topQuestions?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {result.topQuestions.map((q, i) => (
                    <div key={i} style={{ fontSize: 13 }}>
                      <span style={{ color: "var(--mx-ink, #e8eef7)" }}>{q.question}</span>
                      <span style={{ color: "var(--mx-accent, #e39a3e)", marginLeft: 6, fontSize: 12 }}>
                        ×{q.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--mx-muted, #9fb2c8)" }}>无</div>
              )}
            </SectionCard>
            <SectionCard title="回复建议" icon={<Sparkles size={14} />}>
              {result.replySuggestions?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.replySuggestions.map((s, i) => (
                    <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <div style={{ color: "var(--mx-accent, #e39a3e)", fontSize: 12 }}>{s.scenario}</div>
                      <div style={{ color: "var(--mx-ink, #e8eef7)" }}>{s.reply}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--mx-muted, #9fb2c8)" }}>无</div>
              )}
            </SectionCard>
          </div>
          {result.suggestedReplyRules?.length ? (
            <SectionCard title="建议沉淀的回复规则" icon={<Lightbulb size={14} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {result.suggestedReplyRules.map((r, i) => (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{ color: "var(--mx-muted, #9fb2c8)" }}>当{ r.when }：</span>
                    <span style={{ color: "var(--mx-ink, #e8eef7)" }}>{r.reply}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(142,165,190,.25)",
  borderRadius: 8,
  color: "var(--mx-ink, #e8eef7)",
  padding: "6px 10px",
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(142,165,190,.25)",
  borderRadius: 8,
  color: "var(--mx-ink, #e8eef7)",
  padding: "6px 10px",
  fontSize: 13,
  flex: 1,
  minWidth: 140,
};
