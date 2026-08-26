"use client";

import toastLib from "@/lib/toast";
import {} from "@/components/brand-logo";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  knowledgeApi,
  type BrandKnowledgeItem,
} from "@/lib/api/knowledge";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { useConfirm } from "@/hooks/use-confirm";
import { toActionableError } from "@/lib/public-error";

const TYPE_LABEL: Record<string, string> = {
  brand: "品牌",
  product: "产品",
  copy: "话术",
  manual: "手册",
};

const TYPE_COLOR: Record<string, string> = {
  brand: "var(--kaypal-v3-amber)",
  product: "var(--kaypal-v3-purple)",
  copy: "var(--kaypal-v3-success)",
  manual: "var(--kaypal-v3-muted)",
};

const PLACEHOLDER =
  "例如：品牌介绍、产品卖点、门店信息、常用话术……AI 创作时会自动引用这些真实资料，不再凭空编造。";

const FIELD_INPUT: React.CSSProperties = {
  width: "100%",
  background: "var(--kaypal-v3-field-bg)",
  border: "1px solid var(--kaypal-v3-field-border)",
  borderRadius: 10,
  color: "var(--kaypal-v3-ink)",
  padding: "10px 12px",
  fontSize: 13,
  boxSizing: "border-box",
};

function KnowledgeList() {
  const { confirm, modal } = useConfirm();
  const [items, setItems] = useState<BrandKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<"brand" | "product" | "copy" | "manual">("brand");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await knowledgeApi.list();
      setItems(Array.isArray(result) ? result : []);
      setError("");
    } catch (e) {
      setError(toActionableError(e, "知识库加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      typeFilter === "all"
        ? items
        : items.filter((item) => item.type === typeFilter),
    [items, typeFilter],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const submit = useCallback(async () => {
    if (!title.trim()) {
      toastLib.error("请填写知识条目标题");
      return;
    }
    if (!content.trim()) {
      toastLib.error("请填写知识内容");
      return;
    }
    setSaving(true);
    try {
      const tags = tagsText
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
      await knowledgeApi.upload({ title, content, type, tags });
      setTitle("");
      setContent("");
      setTagsText("");
      setShowForm(false);
      await load();
      showToast("已保存到品牌知识库");
    } catch (e) {
      toastLib.error(toActionableError(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  }, [title, content, type, tagsText, load, showToast]);

  const doRemove = useCallback(
    async (id: string) => {
      const ok = await confirm({
        kind: "danger",
        title: "删除这条知识",
        description: "删除后 AI 创作时将不再引用它，此操作不可恢复。",
        confirmText: "删除",
      });
      if (!ok) {
        return;
      }
      setRemovingId(id);
      try {
        await knowledgeApi.remove(id);
        await load();
        showToast("已删除");
      } catch (e) {
        toastLib.error(toActionableError(e, "删除失败"));
      } finally {
        setRemovingId(null);
      }
    },
    [load, showToast, confirm],
  );

  return (
    <div>
      <V2BackButton />
      {/* 页面头：kx-greet 亮色规格 */}
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="kx-greet">品牌知识库</h1>
          <p className="kx-greet-sub">上传产品/品牌资料 · AI 创作时自动引用</p>
        </div>
        <button
          type="button"
          className="kx-btn-primary shrink-0"
          style={{ fontSize: 13, padding: "8px 16px", border: "none", cursor: "pointer" }}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "收起" : "＋ 添加知识"}
        </button>
      </header>

      {/* toast */}
      {toast ? (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "var(--kaypal-v3-success)", color: "#fff", padding: "9px 18px", borderRadius: "var(--kaypal-v3-radius-sm)", fontSize: 13, boxShadow: "var(--kaypal-v3-card-shadow)" }}>
          {toast}
        </div>
      ) : null}

      {/* 添加表单 */}
      {showForm ? (
        <section style={{ marginTop: 14 }}>
          <div className="kaypal-v3-panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--kaypal-v3-ink)", marginBottom: 12 }}>添加知识条目</div>
            <input
              type="text"
              placeholder="标题，例如：品牌介绍 / 主推产品卖点"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={FIELD_INPUT}
            />
            <textarea
              placeholder={PLACEHOLDER}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              style={{ ...FIELD_INPUT, marginTop: 10, resize: "vertical", lineHeight: 1.6 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {(["brand", "product", "copy", "manual"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  style={{
                    fontSize: 12, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                    background: type === key ? "var(--kaypal-v3-accent-soft)" : "transparent",
                    border: type === key ? "1px solid var(--kaypal-v3-accent-border)" : "1px solid var(--kaypal-v3-border-strong)",
                    color: type === key ? "var(--kaypal-v3-accent-ink)" : "var(--kaypal-v3-muted)",
                  }}
                >
                  {TYPE_LABEL[key]}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="标签（逗号分隔），如：餐饮,火锅,新品"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              style={{ ...FIELD_INPUT, marginTop: 10 }}
            />
            <button
              type="button"
              className="kx-btn-primary"
              style={{ marginTop: 14, width: "100%", border: "none", cursor: "pointer" }}
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "保存中…" : "保存到知识库"}
            </button>
          </div>
        </section>
      ) : null}

      {/* 类型筛选 */}
      <section style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["all", "brand", "product", "copy", "manual"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              style={{
                fontSize: 12, padding: "6px 13px", borderRadius: 999, cursor: "pointer",
                background: typeFilter === key ? "var(--kaypal-v3-accent-soft)" : "var(--kaypal-v3-paper)",
                border: typeFilter === key ? "1px solid var(--kaypal-v3-accent-border)" : "1px solid var(--kaypal-v3-border)",
                color: typeFilter === key ? "var(--kaypal-v3-accent-ink)" : "var(--kaypal-v3-soft-ink)",
              }}
            >
              {key === "all" ? "全部" : TYPE_LABEL[key]}
            </button>
          ))}
        </div>
      </section>

      {/* 加载失败提示 */}
      {error ? (
        <section style={{ marginTop: 14 }}>
          <div className="kaypal-v3-panel" style={{ padding: 14, borderColor: "var(--kaypal-v3-danger)" }}>
            <div style={{ fontSize: 13, color: "var(--kaypal-v3-danger)" }}>{error}</div>
            <button
              type="button"
              className="kx-btn-primary"
              style={{ marginTop: 10, fontSize: 12, padding: "7px 14px", border: "none", cursor: "pointer" }}
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        </section>
      ) : null}

      {/* 列表 */}
      <section style={{ paddingBottom: 28, marginTop: 14 }}>
        <div className="kaypal-v3-panel" style={{ padding: "4px 14px" }}>
          {loading ? (
            <div>
              {[60, 75].map((w) => (
                <div key={w} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 4px", borderBottom: "1px solid var(--kaypal-v3-border)" }}>
                  <span style={{ width: 40, height: 40, borderRadius: 13, background: "var(--kaypal-v3-paper-soft)" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, width: `${w}%`, borderRadius: 6, background: "var(--kaypal-v3-paper-soft)" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <p style={{ fontSize: 13, color: "var(--kaypal-v3-muted)" }}>{items.length === 0 ? "还没有知识条目，点右上角添加" : "该类型暂无条目"}</p>
              {items.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginTop: 6 }}>
                  告诉 AI 你的产品是什么，创作才会写对
                </p>
              ) : null}
            </div>
          ) : (
            filtered.map((item) => {
              const color = TYPE_COLOR[item.type] ?? "var(--kaypal-v3-muted)";
              const tags = Array.isArray(item.tags) ? item.tags : [];
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 4px", borderBottom: "1px solid var(--kaypal-v3-border)" }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 13, flexShrink: 0, background: `${color}1a`, color }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--kaypal-v3-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2, fontSize: 11, color: "var(--kaypal-v3-muted)" }}>
                      <span style={{ background: color, width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                      <span>{TYPE_LABEL[item.type] ?? item.type}</span>
                      {tags.length > 0 ? (
                        <span>{tags.slice(0, 3).join(" · ")}</span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      style={{ fontSize: 11, padding: "4px 9px", background: "var(--kaypal-v3-danger-soft)", border: "1px solid var(--kaypal-v3-danger)", borderRadius: 7, color: "var(--kaypal-v3-danger)", cursor: "pointer" }}
                      disabled={removingId === item.id}
                      onClick={() => void doRemove(item.id)}
                    >
                      {removingId === item.id ? "…" : "删除"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 底部说明 */}
      <section style={{ paddingBottom: 28 }}>
        <div className="kaypal-v3-panel" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--kaypal-v3-muted)" }}>
            💡 知识库用于 AI 创作。写内容时对 AI 说「写一条我们品牌的文案」，AI 会自动检索知识库并引用真实信息；没有知识库时，AI 只能凭常识写。
          </div>
        </div>
      </section>
      {modal}
    </div>
  );
}

export default function KnowledgeV2Page() {
  return <KnowledgeList />;
}
