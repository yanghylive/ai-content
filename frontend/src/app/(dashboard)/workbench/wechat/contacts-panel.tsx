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
  onSync,
  onDelete,
  onCancel,
}: {
  contacts?: Contact[];
  syncing?: boolean;
  onSync?: () => void;
  onDelete?: (id: string) => void;
  onCancel?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

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
            disabled={syncing}
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
