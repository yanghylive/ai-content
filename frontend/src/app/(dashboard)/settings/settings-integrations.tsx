"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  FolderOpen,
  Loader2,
  PenLine,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  settingsApi,
  storageApi,
  sourcesApi,
  type StorageConfig,
  type Source,
} from "@/lib/api/settings";
import { materialsApi } from "@/lib/api/materials";
import { toPublicError } from "@/lib/public-error";

/* ============ AI 服务（4 个默认模型槽位） ============ */

const MODEL_SLOTS = [
  { key: "articleModel", label: "文章创作" },
  { key: "topicModel", label: "选题推荐" },
  { key: "imageModel", label: "图片创作" },
  { key: "collectModel", label: "采集分析" },
] as const;

function AiServiceSettings({ onFlash, onError }: { onFlash: (t: string) => void; onError: (t: string) => void }) {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [models, setModels] = useState<{ id: string; name: string; modelId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [defaultsData, modelsData] = await Promise.allSettled([
        settingsApi.getDefaults(),
        settingsApi.listModels(),
      ]);
      if (defaultsData.status === "fulfilled") {
        setDefaults((defaultsData.value as unknown as Record<string, string>) || {});
      }
      if (modelsData.status === "fulfilled") {
        setModels(
          (Array.isArray(modelsData.value) ? modelsData.value : []) as typeof models,
        );
      }
    } catch (err: unknown) {
      onError(toPublicError(err, "加载 AI 服务失败"));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.updateDefaults(defaults as never);
      onFlash("AI 服务配置已保存");
    } catch (err: unknown) {
      onError(toPublicError(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    // 用第一个已设置的默认模型测试连接
    const modelId = Object.values(defaults).find((v) => v);
    if (!modelId) {
      onError("先选一个默认模型再测试");
      return;
    }
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      onError("找不到这个模型，请重新保存");
      return;
    }
    setTesting(true);
    try {
      const result = await settingsApi.testModel({
        platformId: (model as { platformId?: string }).platformId || "",
        modelId: model.modelId || model.id,
      });
      if (result.success) {
        onFlash(`连接正常：${result.reply ? `AI 回复"${String(result.reply).slice(0, 30)}..."` : "模型可用"}`);
      } else {
        onError(result.message || "连接失败，请检查模型配置");
      }
    } catch (err: unknown) {
      onError(toPublicError(err, "测试失败"));
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await settingsApi.syncKaypalModel();
      onFlash((result as { message?: string }).message || "已从账号同步模型");
      await load();
    } catch (err: unknown) {
      onError(toPublicError(err, "同步失败"));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {MODEL_SLOTS.map((slot) => (
          <V2Field key={slot.key} label={slot.label}>
            <V2Select
              value={defaults[slot.key] || ""}
              onChange={(e) => setDefaults((p) => ({ ...p, [slot.key]: e.target.value }))}
            >
              <option value="">未设置</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.modelId}
                </option>
              ))}
            </V2Select>
          </V2Field>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <V2GhostButton icon={syncing ? Loader2 : RefreshCcw} loading={syncing} onClick={handleSync}>
            {syncing ? "正在同步..." : "从账号同步模型"}
          </V2GhostButton>
          <V2GhostButton icon={testing ? Loader2 : CheckCircle2} loading={testing} onClick={handleTest}>
            {testing ? "正在测试..." : "测试连接"}
          </V2GhostButton>
        </div>
        <V2PrimaryButton icon={Save} loading={saving} onClick={handleSave}>
          {saving ? "正在保存..." : "保存"}
        </V2PrimaryButton>
      </div>
    </div>
  );
}

/* ============ 内容来源 ============ */

const SOURCE_TYPES = [
  { value: "rss", label: "RSS 订阅" },
  { value: "api", label: "自定义数据源" },
  { value: "crawler", label: "网页采集" },
];

function SourcesSettings({ onFlash, onError }: { onFlash: (t: string) => void; onError: (t: string) => void }) {
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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await sourcesApi.list();
      setSources(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      onError(toPublicError(err, "加载内容来源失败"));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (source: Source) => {
    try {
      await sourcesApi.toggle(source.id);
      await load();
    } catch (err: unknown) {
      onError(toPublicError(err, "切换失败"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await sourcesApi.remove(id);
      setDeleteId(null);
      await load();
      onFlash("已删除");
    } catch (err: unknown) {
      onError(toPublicError(err, "删除失败"));
    }
  };

  const handleAdd = async () => {
    if (!newSource.name.trim() || !newSource.url.trim()) {
      onError("名称和地址都要填");
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
      onFlash("来源已添加，采集任务会从这里抓内容");
    } catch (err: unknown) {
      onError(toPublicError(err, "添加失败"));
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
      onFlash("来源已更新");
    } catch (err: unknown) {
      onError(toPublicError(err, "保存失败"));
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
        onFlash(`推荐源之前已加过了（共 ${result.skipped} 个在列表里）${collectNote}`);
      } else {
        onFlash(`已添加 ${result.created} 个推荐来源${collectNote}`);
      }
      await load();
    } catch (err: unknown) {
      onError(toPublicError(err, "添加推荐源失败"));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="grid gap-4">
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
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
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
                  <span className="h-5 w-5 rounded-full bg-white shadow" />
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

/* ============ 文件存储 ============ */

const STORAGE_PROVIDERS = [
  { value: "local" as const, label: "本地存储", desc: "存在这台电脑上" },
  { value: "qiniu" as const, label: "七牛云", desc: "对象存储" },
  { value: "aliyun-oss" as const, label: "阿里 OSS", desc: "对象存储" },
];

function StorageSettings({ onFlash, onError }: { onFlash: (t: string) => void; onError: (t: string) => void }) {
  const [config, setConfig] = useState<StorageConfig>({
    provider: "local",
    accessKey: "",
    secretKey: "",
    bucket: "",
    domain: "",
    endpoint: "",
    region: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await storageApi.getConfig();
        if (data) setConfig((prev) => ({ ...prev, ...data }));
      } catch {
        // 用默认值
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await storageApi.updateConfig(config);
      onFlash("存储配置已保存");
    } catch (err: unknown) {
      onError(toPublicError(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await storageApi.testConnection();
      if (result.success) {
        onFlash(result.message || "连接正常");
      } else {
        onError(result.message || "连接失败，请检查配置");
      }
    } catch (err: unknown) {
      onError(toPublicError(err, "测试失败"));
    } finally {
      setTesting(false);
    }
  };

  const isLocal = config.provider === "local";

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-3">
        {STORAGE_PROVIDERS.map((p) => (
          <V2OptionCard
            key={p.value}
            icon={Database}
            title={p.label}
            description={p.desc}
            selected={config.provider === p.value}
            onClick={() => setConfig((prev) => ({ ...prev, provider: p.value }))}
          />
        ))}
      </div>

      {!isLocal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <V2Field label="AccessKey" required>
            <V2Input
              value={config.accessKey}
              onChange={(e) => setConfig((p) => ({ ...p, accessKey: e.target.value }))}
            />
          </V2Field>
          <V2Field label="SecretKey" required>
            <V2Input
              type="password"
              value={config.secretKey}
              onChange={(e) => setConfig((p) => ({ ...p, secretKey: e.target.value }))}
            />
          </V2Field>
          <V2Field label="存储空间（Bucket）" required>
            <V2Input
              value={config.bucket}
              onChange={(e) => setConfig((p) => ({ ...p, bucket: e.target.value }))}
            />
          </V2Field>
          <V2Field label="访问域名" required>
            <V2Input
              placeholder="https://cdn.example.com"
              value={config.domain}
              onChange={(e) => setConfig((p) => ({ ...p, domain: e.target.value }))}
            />
          </V2Field>
          {config.provider === "aliyun-oss" && (
            <>
              <V2Field label="服务节点地址">
                <V2Input
                  placeholder="oss-cn-hangzhou.aliyuncs.com"
                  value={config.endpoint}
                  onChange={(e) => setConfig((p) => ({ ...p, endpoint: e.target.value }))}
                />
              </V2Field>
              <V2Field label="区域代码">
                <V2Input
                  placeholder="cn-hangzhou"
                  value={config.region}
                  onChange={(e) => setConfig((p) => ({ ...p, region: e.target.value }))}
                />
              </V2Field>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {!isLocal ? (
          <V2GhostButton icon={testing ? Loader2 : CheckCircle2} loading={testing} onClick={handleTest}>
            {testing ? "正在测试..." : "测试连接"}
          </V2GhostButton>
        ) : (
          <span />
        )}
        <V2PrimaryButton icon={Save} loading={saving} onClick={handleSave}>
          {saving ? "正在保存..." : "保存"}
        </V2PrimaryButton>
      </div>
    </div>
  );
}

/* ============ 汇总导出 ============ */

export function SettingsIntegrations() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setError(null);
    setTimeout(() => setMessage(null), 3000);
  };
  const showError = (text: string) => {
    setError(text);
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{message}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section
        title="AI 服务"
        description="各功能默认用哪个模型"
      >
        <AiServiceSettings onFlash={flash} onError={showError} />
      </V2Section>

      <V2Section
        title="内容来源"
        description="素材采集从这些地方抓内容"
      >
        <SourcesSettings onFlash={flash} onError={showError} />
      </V2Section>

      <V2Section
        title="文件存储"
        description="生成的图片、视频存在哪里"
      >
        <StorageSettings onFlash={flash} onError={showError} />
      </V2Section>
    </div>
  );
}
