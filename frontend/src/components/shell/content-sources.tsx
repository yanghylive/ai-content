"use client";

/**
 * 内容来源（2026-09-01 从 /settings/integrations 迁移到内容运营页）
 *
 * 素材采集的数据源管理：一键推荐源 / 添加 / 编辑 / 删除 / 启停。
 * 原属「AI 服务与存储」页，按产品整理迁至内容运营（素材采集上下文）。
 */
import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  Loader2,
  PenLine,
  Plus,
  Save,
  Trash2,
} from "@/components/iconpark";
import {
  V2Field,
  V2Input,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { sourcesApi, type Source } from "@/lib/api/settings";
import { materialsApi } from "@/lib/api/materials";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

const SOURCE_TYPES = [
  { value: "rss", label: "RSS 订阅" },
  { value: "api", label: "自定义数据源" },
  { value: "crawler", label: "网页采集" },
];

export function ContentSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "rss", url: "" });
  const [savingNew, setSavingNew] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<{
    id: string;
    name: string;
    type: string;
    url: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const flash = (text: string) => {
    setMsg(text);
    setError("");
    window.setTimeout(() => setMsg(""), 3000);
  };
  const showError = (text: string) => {
    setError(text);
    setMsg("");
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await sourcesApi.list();
      setSources(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      showError(toPublicError(err, "加载内容来源失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (source: Source) => {
    try {
      await sourcesApi.toggle(source.id);
      await load();
    } catch (err: unknown) {
      showError(toPublicError(err, "切换失败"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await sourcesApi.remove(id);
      setDeleteId(null);
      await load();
      flash("已删除");
    } catch (err: unknown) {
      showError(toPublicError(err, "删除失败"));
    }
  };

  const handleAdd = async () => {
    if (!newSource.name.trim() || !newSource.url.trim()) {
      showError("名称和地址都要填");
      return;
    }
    setSavingNew(true);
    try {
      await sourcesApi.create({
        name: newSource.name.trim(),
        type: newSource.type,
        url: newSource.url.trim(),
        enabled: true,
      });
      setNewSource({ name: "", type: "rss", url: "" });
      setAdding(false);
      await load();
      flash("来源已添加，采集任务会从这里抓内容");
    } catch (err: unknown) {
      showError(toPublicError(err, "添加失败"));
    } finally {
      setSavingNew(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingSource) return;
    setSavingEdit(true);
    try {
      await sourcesApi.update(editingSource.id, {
        name: editingSource.name.trim(),
        type: editingSource.type,
        url: editingSource.url.trim(),
      });
      setEditingSource(null);
      await load();
      flash("来源已更新");
    } catch (err: unknown) {
      showError(toPublicError(err, "保存失败"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await sourcesApi.seed();
      // 采集改为后台异步触发：后端逐源抓取要 30 秒以上，
      // 同步等它会让按钮一直转圈；发出去就立即反馈，进度到素材库看
      materialsApi.collect().catch(() => {
        // 采集触发失败不影响来源添加，用户可到素材库手动启动
      });
      const collectNote = "，采集已在后台开始（到素材库看进度）";
      if (result.created === 0) {
        flash(`推荐源之前已加过了（共 ${result.skipped} 个在列表里）${collectNote}`);
      } else {
        flash(`已添加 ${result.created} 个推荐来源${collectNote}`);
      }
      await load();
    } catch (err: unknown) {
      showError(toPublicError(err, "添加推荐源失败"));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="grid gap-4">
      {msg && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-3">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{msg}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--kaypal-v3-muted)]">
          素材库的「开始采集」就是从这里抓内容
        </p>
        <div className="flex gap-2">
          <V2GhostButton icon={seeding ? Loader2 : Plus} loading={seeding} onClick={handleSeed}>
            一键推荐源
          </V2GhostButton>
          <V2PrimaryButton icon={Plus} onClick={() => setAdding((v) => !v)}>
            添加来源
          </V2PrimaryButton>
        </div>
      </div>

      {adding && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <V2Field label="名称" required>
              <V2Input
                placeholder="例如：36氪"
                value={newSource.name}
                onChange={(e) => setNewSource((p) => ({ ...p, name: e.target.value }))}
              />
            </V2Field>
            <V2Field label="类型">
              <V2Select
                value={newSource.type}
                onChange={(e) => setNewSource((p) => ({ ...p, type: e.target.value }))}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </V2Select>
            </V2Field>
            <V2Field label="地址" required>
              <V2Input
                placeholder="https://..."
                value={newSource.url}
                onChange={(e) => setNewSource((p) => ({ ...p, url: e.target.value }))}
              />
            </V2Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <V2GhostButton onClick={() => setAdding(false)}>取消</V2GhostButton>
            <V2PrimaryButton icon={Save} loading={savingNew} onClick={handleAdd}>
              保存
            </V2PrimaryButton>
          </div>
        </div>
      )}

      {editingSource && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-4">
          <p className="mb-3 text-sm font-medium text-[var(--kaypal-v3-ink)]">编辑来源</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <V2Field label="名称" required>
              <V2Input
                value={editingSource.name}
                onChange={(e) => setEditingSource((p) => p ? { ...p, name: e.target.value } : p)}
              />
            </V2Field>
            <V2Field label="类型">
              <V2Select
                value={editingSource.type}
                onChange={(e) => setEditingSource((p) => p ? { ...p, type: e.target.value } : p)}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </V2Select>
            </V2Field>
            <V2Field label="地址" required>
              <V2Input
                value={editingSource.url}
                onChange={(e) => setEditingSource((p) => p ? { ...p, url: e.target.value } : p)}
              />
            </V2Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <V2GhostButton onClick={() => setEditingSource(null)}>取消</V2GhostButton>
            <V2PrimaryButton icon={Save} loading={savingEdit} onClick={handleSaveEdit}>
              {savingEdit ? "正在保存..." : "保存"}
            </V2PrimaryButton>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : sources.length === 0 ? (
        <V2EmptyState
          icon={FolderOpen}
          title="还没有内容来源"
          description="点「一键推荐源」快速添加常用的，或手动添加"
        />
      ) : (
        <div className="divide-y divide-[var(--kaypal-v3-border)] rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)]">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={source.enabled}
                  className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                    source.enabled
                      ? "justify-end bg-[var(--kaypal-v3-accent)]"
                      : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={() => void handleToggle(source)}
                >
                  <span className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
                </button>
                <div>
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">{source.name}</p>
                  <p className="text-xs text-[var(--kaypal-v3-muted)]">
                    {SOURCE_TYPES.find((t) => t.value === source.type)?.label || source.type}
                    {" · "}
                    {source.enabled ? "已启用" : "已停用"}
                  </p>
                </div>
              </div>
              {deleteId === source.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--kaypal-v3-danger)]">确认删除？</span>
                  <V2PrimaryButton onClick={() => void handleDelete(source.id)}>确认</V2PrimaryButton>
                  <V2GhostButton onClick={() => setDeleteId(null)}>取消</V2GhostButton>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="编辑数据源"
                    title="编辑数据源"
                    className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                    onClick={() =>
                      setEditingSource({
                        id: source.id,
                        name: source.name,
                        type: source.type,
                        url: source.url,
                      })
                    }
                  >
                    <PenLine className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="删除数据源"
                    title="删除数据源"
                    className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                    onClick={() => setDeleteId(source.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
