"use client";

import React from "react";
import { redfoxApi } from "@/lib/api/redfox";
import { toPublicError } from "@/lib/public-error";

type Action = "search" | "detail" | "list";

/** 平台选项：key 用于请求，label 用于前台展示中文名（后端接口也返回 {key,label}，key 保持一致） */
const DEFAULT_PLATFORMS: Array<{ key: string; label: string }> = [
  { key: "douyin", label: "抖音" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "kuaishou", label: "快手" },
  { key: "wechat", label: "视频号" },
];

const ACTION_LABEL: Record<Action, string> = {
  search: "关键词搜作品",
  detail: "作品详情",
  list: "账号作品列表",
};

export default function CollectionCenterPage() {
  const [platforms, setPlatforms] = React.useState<Array<{ key: string; label: string }>>(DEFAULT_PLATFORMS);
  const [platform, setPlatform] = React.useState(DEFAULT_PLATFORMS[0].key);
  const [action, setAction] = React.useState<Action>("search");
  const [keyword, setKeyword] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{
    platformLabel: string;
    action: string;
    data: Record<string, unknown>;
    generatedAt: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void redfoxApi
      .listSearchPlatforms()
      .then((r) => {
        const items = r.items || [];
        if (items.length > 0) {
          setPlatforms(items);
          setPlatform(items[0].key);
        }
      })
      .catch(() => {
        /* 拉取失败用默认平台列表 */
      });
  }, []);

  const handleCollect = async () => {
    const needKeyword = action === "search";
    const needUrl = action === "detail";
    const needAccount = action === "list";
    if (busy) return;
    if ((needKeyword && !keyword.trim()) || (needUrl && !url.trim()) || (needAccount && !accountId.trim())) {
      setError("请填写该查询方式需要的参数");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await redfoxApi.platformCollect({
        platform,
        action,
        keyword: keyword.trim() || undefined,
        url: url.trim() || undefined,
        accountId: accountId.trim() || undefined,
        page,
      });
      setResult({
        platformLabel: res.platformLabel || platform,
        action: res.action,
        data: res.data as Record<string, unknown>,
        generatedAt: res.generatedAt,
      });
    } catch (e) {
      setError(toPublicError(e, "采集失败"));
    } finally {
      setBusy(false);
    }
  };

  const renderData = (data: Record<string, unknown>) => {
    const entries = Object.entries(data);
    if (entries.length === 0) return <div style={{ fontSize: 13, color: "var(--kx-muted)" }}>返回为空</div>;
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--kx-ink-soft)",
          margin: 0,
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid var(--kx-border)",
    background: "var(--kx-card)",
    color: "var(--kx-ink)",
    padding: "10px 13px",
    fontSize: 13.5,
    fontFamily: "inherit",
    outline: "none",
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "8px 0 40px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.3px" }}>全网采集</h1>
      <p style={{ color: "var(--kx-muted)", fontSize: 14, margin: "6px 0 20px" }}>
        关键词搜作品、查作品详情、看账号作品列表
      </p>

      {/* 平台 + 查询方式 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--kx-muted)", marginBottom: 6 }}>平台</div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {platforms.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--kx-muted)", marginBottom: 6 }}>查询方式</div>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 动态参数 */}
      {action === "search" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--kx-muted)", marginBottom: 6 }}>关键词</div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例如：露营装备测评"
            style={inputStyle}
          />
        </div>
      ) : null}
      {action === "detail" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--kx-muted)", marginBottom: 6 }}>作品链接</div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴作品分享链接"
            style={inputStyle}
          />
        </div>
      ) : null}
      {action === "list" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--kx-muted)", marginBottom: 6 }}>账号 ID</div>
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="账号作品列表（填账号 ID）"
            style={inputStyle}
          />
        </div>
      ) : null}

      {/* 操作 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
        <button
          type="button"
          disabled={busy}
          onClick={handleCollect}
          style={{
            padding: "11px 22px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
            fontFamily: "inherit",
            border: "none",
            background: "linear-gradient(135deg, #d98f2b, #efb45b)",
            color: "#173052",
          }}
        >
          {busy ? "采集中…" : "开始采集"}
        </button>
        {action === "search" ? (
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--kx-border)", background: "var(--kx-card)", color: "var(--kx-ink)" }}
          >
            上一页
          </button>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--kx-muted)" }}>页码 {page}</span>
        {action === "search" ? (
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--kx-border)", background: "var(--kx-card)", color: "var(--kx-ink)" }}
          >
            下一页
          </button>
        ) : null}
      </div>

      {/* 结果 */}
      {result ? (
        <div
          style={{
            marginTop: 18,
            borderRadius: 16,
            border: "1px solid var(--kx-border)",
            background: "var(--kx-card)",
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            {result.platformLabel} · {ACTION_LABEL[result.action as Action] ?? result.action}
            <span style={{ color: "var(--kx-muted)", fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              {result.generatedAt}
            </span>
          </div>
          {renderData(result.data)}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            fontSize: 13,
            background: "var(--kx-danger-soft, rgba(220,38,38,.1))",
            color: "var(--kx-danger, #dc2626)",
          }}
        >
          {error}
        </div>
      ) : null}

      <p style={{ marginTop: 18, fontSize: 12, color: "var(--kx-muted)", lineHeight: 1.7 }}>
        提示：结果按平台原始结构返回，可配合「去水印采集」将目标作品存入素材库；如提示未开通数据能力，请联系系统管理员。
      </p>
    </div>
  );
}
