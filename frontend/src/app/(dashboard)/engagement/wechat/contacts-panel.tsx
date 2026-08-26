"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  RefreshCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type Contact = {
  id: string;
  nickname: string;
  wxid: string;
  remark?: string;
  tags?: string[];
};

export function ContactsPanel({
  contacts = [],
  syncing = false,
  syncDisabled = false,
  onSync,
  onDelete,
  onCancel,
}: {
  contacts?: Contact[];
  syncing?: boolean;
  syncDisabled?: boolean;
  onSync?: () => void;
  onDelete?: (id: string) => void;
  onCancel?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isMobile = useIsMobile();

  // 智能默认值：搜索实时过滤
  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.nickname, c.wxid, c.remark || "", ...(c.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [contacts, searchQuery]);

  /* 移动端原生视图（mx-* 明德 VP 风格） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          {/* 头部 + 同步 */}
          <div className="mx-card" style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>联系人</h2>
              <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>已同步 {contacts.length.toLocaleString()} 个</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px" }}
              disabled={syncing || syncDisabled}
              onClick={onSync}
            >
              <RefreshCcw width={15} height={15} className={syncing ? "animate-spin" : ""} />
              {syncing ? "同步中…" : "同步"}
            </button>
          </div>

          {/* 搜索 */}
          <div style={{ position: "relative", marginTop: 10 }}>
            <Search width={15} height={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--kaypal-v3-muted)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索昵称、备注或微信号"
              style={{ width: "100%", padding: "10px 11px 10px 34px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }}
            />
          </div>

          {/* 列表 */}
          {contacts.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 28, textAlign: "center" }}>
              <Users width={28} height={28} style={{ color: "var(--kaypal-v3-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", marginTop: 10 }}>还没有联系人</p>
              <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4 }}>点击上方"同步"从微信导入</p>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 24, textAlign: "center" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-muted)" }}>没有找到匹配 "{searchQuery}" 的联系人</p>
            </div>
          ) : (
            <div className="mx-card" style={{ marginTop: 12, padding: "4px 13px" }}>
              {filteredContacts.slice(0, 50).map((contact, i) => (
                <div key={contact.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: i > 0 ? "1px solid rgba(142,165,190,.15)" : "none" }}>
                  <span style={{ width: 34, height: 34, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>
                    <Users width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {contact.remark || contact.nickname}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {contact.wxid}{contact.tags && contact.tags.length > 0 ? ` · ${contact.tags.join(" / ")}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onDelete?.(contact.id)}
                    style={{ flexShrink: 0, padding: 6, color: "var(--kaypal-v3-muted)", background: "none", border: "none" }}
                  >
                    <Trash2 width={15} height={15} />
                  </button>
                </div>
              ))}
              {filteredContacts.length > 50 && (
                <p style={{ padding: "9px 0 6px", fontSize: 11, color: "var(--kaypal-v3-muted)", textAlign: "center" }}>
                  显示前 50 条，共 {filteredContacts.length} 条
                </p>
              )}
            </div>
          )}

          {/* 高级操作 */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 14, fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-muted)", background: "none", border: "none" }}
          >
            高级操作
            <ChevronDown width={14} height={14} style={{ transform: showAdvanced ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {showAdvanced && (
            <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
              <button type="button" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Download width={14} height={14} /> 导出联系人
              </button>
              <button type="button" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(220,80,80,.08)", color: "var(--kaypal-v3-danger)", border: "1px solid rgba(220,80,80,.35)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Trash2 width={14} height={14} /> 清空联系人
              </button>
            </div>
          )}

          {/* 返回 */}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{ marginTop: 16, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <ArrowLeft width={14} height={14} /> 返回任务中心
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 区块 1: 同步操作 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              联系人
            </h2>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              已同步 {contacts.length.toLocaleString()} 个联系人
            </p>
          </div>
          {/* 单一主行动 */}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
            disabled={syncing || syncDisabled}
            onClick={onSync}
          >
            <RefreshCcw
              className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "正在同步..." : "同步联系人"}
          </button>
        </div>
      </section>

      {/* 区块 2: 搜索 + 列表 */}
      <section className="kaypal-v3-panel p-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
          <input
            className="h-12 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-11 pr-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
            placeholder="搜索昵称、备注或微信号"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {contacts.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-paper-muted)]">
              <Users className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-[var(--kaypal-v3-ink)]">
              还没有联系人
            </h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              点击右上角"同步联系人"从微信导入
            </p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[var(--kaypal-v3-muted)]">
              没有找到匹配 "{searchQuery}" 的联系人
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-[var(--kaypal-v3-border)] rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)]">
            {filteredContacts.slice(0, 50).map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-4 p-4 transition hover:bg-[var(--kaypal-v3-paper-soft)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                  <Users className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                    {contact.remark || contact.nickname}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
                    {contact.wxid}
                    {contact.tags && contact.tags.length > 0 && (
                      <span className="ml-2">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="mr-1 rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-danger)]"
                  onClick={() => onDelete?.(contact.id)}
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {filteredContacts.length > 50 && (
              <div className="p-4 text-center text-sm text-[var(--kaypal-v3-muted)]">
                显示前 50 条，共 {filteredContacts.length} 条。用搜索缩小范围。
              </div>
            )}
          </div>
        )}
      </section>

      {/* 区块 3: 高级（默认折叠） */}
      <section>
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>高级操作</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              showAdvanced ? "rotate-180" : ""
            }`}
          />
        </button>

        {showAdvanced && (
          <div className="kaypal-v3-surface mt-3 flex flex-wrap gap-3 p-4">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            >
              <Download className="h-4 w-4" />
              导出联系人
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-danger)] transition hover:bg-[var(--kaypal-v3-danger-soft)]"
            >
              <Trash2 className="h-4 w-4" />
              清空联系人
            </button>
          </div>
        )}
      </section>

      {/* 返回 */}
      {onCancel && (
        <section>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            onClick={onCancel}
          >
            <ArrowLeft className="h-4 w-4" />
            返回任务中心
          </button>
        </section>
      )}
    </div>
  );
}
