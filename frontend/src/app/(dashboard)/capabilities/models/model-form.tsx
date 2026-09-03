"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, PlugZap, Save } from "@/components/iconpark";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
} from "@/components/v2/ui-kit";
import { settingsApi, type AIPlatform } from "@/lib/api/settings";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

const POPULAR_MODELS = [
  { id: "kimi-k2", label: "Kimi K2", desc: "综合能力强，推荐" },
  { id: "kimi-k1.5", label: "Kimi K1.5", desc: "速度快" },
  { id: "deepseek-v3", label: "DeepSeek V3", desc: "性价比高" },
  { id: "gpt-4o", label: "GPT-4o", desc: "OpenAI 旗舰" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", desc: "长文写作强" },
  { id: "qwen-max", label: "通义千问 Max", desc: "中文优化" },
] as const;

export function ModelForm({ modelId }: { modelId?: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [platforms, setPlatforms] = useState<AIPlatform[]>([]);

  const [form, setForm] = useState({
    name: "",
    modelId: "kimi-k2",
    platformId: "",
    customModelId: "",
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const platformList = await settingsApi.listPlatforms();
      const enabled = platformList.filter((p) => p.enabled);
      setPlatforms(enabled);
      if (enabled.length > 0) {
        setForm((prev) => ({ ...prev, platformId: enabled[0].id }));
      }

      if (modelId) {
        const models = await settingsApi.listModels();
        const found = models.find((m) => m.id === modelId);
        if (found) {
          setForm((prev) => ({
            ...prev,
            name: found.name,
            modelId: found.modelId,
            platformId: found.platformId,
          }));
        }
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const effectiveModelId =
    form.modelId === "__custom" ? form.customModelId.trim() : form.modelId;
  const canSubmit = form.platformId && effectiveModelId;

  const handleTest = async () => {
    if (!form.platformId || !effectiveModelId) {
      setTestResult("请先选择平台和模型");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await settingsApi.testModel({
        platformId: form.platformId,
        modelId: effectiveModelId,
      });
      setTestResult(
        result.success
          ? result.reply || "AI 服务连接正常"
          : result.message || "AI 服务检查失败",
      );
    } catch (err: unknown) {
      setTestResult(toPublicError(err, "AI 服务检查未完成，请稍后重试"));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const name =
        form.name.trim() ||
        POPULAR_MODELS.find((m) => m.id === form.modelId)?.label ||
        effectiveModelId;
      if (modelId) {
        await settingsApi.updateModel(modelId, {
          name,
          modelId: effectiveModelId,
          platformId: form.platformId,
        });
      } else {
        await settingsApi.createModel({
          name,
          modelId: effectiveModelId,
          platformId: form.platformId,
        });
      }
      router.push("/capabilities/models");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <SkeletonList rows={5} />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
    );
  }

  /* 移动端原生视图（mx-* 明德 VP 风格）——转 2 页（models/new + models/edit） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/capabilities/models")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回模型列表
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>{modelId ? "编辑模型" : "添加模型"}</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>选一个常用模型点一下就行，不用手填</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 选模型 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>选模型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {POPULAR_MODELS.map((model) => {
              const selected = form.modelId === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, modelId: model.id }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ textAlign: "left", minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>{model.label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>{model.desc}</span>
                  </span>
                  {selected && <span style={{ color: "var(--kaypal-v3-amber)", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 自定义模型 */}
          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 11, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.modelId === "__custom"}
              onChange={(e) => setForm((p) => ({ ...p, modelId: e.target.checked ? "__custom" : "kimi-k2" }))}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 12.5, color: "var(--kaypal-v3-ink)" }}>用其他模型 ID（手动输入）</span>
          </label>
          {form.modelId === "__custom" && (
            <input
              placeholder="输入模型 ID，例如：moonshot-v1-128k"
              value={form.customModelId}
              onChange={(e) => setForm((p) => ({ ...p, customModelId: e.target.value }))}
              style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
            />
          )}

          {/* 接入平台 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>接入平台</div>
          {platforms.length === 0 ? (
            <div className="mx-card" style={{ padding: 13 }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-muted)" }}>还没有可用的平台，先去「设置 → 平台」添加一个</p>
            </div>
          ) : (
            <select
              value={form.platformId}
              onChange={(e) => setForm((p) => ({ ...p, platformId: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }}
            >
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>{platform.name}</option>
              ))}
            </select>
          )}

          {/* 显示名 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>显示名称（可选）</div>
          <input
            placeholder={POPULAR_MODELS.find((m) => m.id === form.modelId)?.label || "留空则自动用模型名"}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 13 }}
          />

          {/* 测试连接（继承 legacy 的 testModel 功能） */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>测试连接</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing}
              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}
            >
              <PlugZap width={14} height={14} />
              {testing ? "测试中…" : "测试连接"}
            </button>
            {testResult && (
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", lineHeight: 1.5 }}>{testResult}</span>
            )}
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/capabilities/models")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!canSubmit || saving}
              onClick={() => void handleSubmit()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : modelId ? "保存修改" : "添加模型"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/capabilities/models")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {modelId ? "编辑模型" : "添加模型"}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              选一个常用模型点一下就行，不用手填
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 常用模型直选 */}
      <V2Section title="选模型" description="常用模型都列好了，点一个即可">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POPULAR_MODELS.map((model) => (
            <V2OptionCard
              key={model.id}
              icon={Save}
              title={model.label}
              description={model.desc}
              selected={form.modelId === model.id}
              onClick={() => setForm((p) => ({ ...p, modelId: model.id }))}
            />
          ))}
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
              checked={form.modelId === "__custom"}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  modelId: e.target.checked ? "__custom" : "kimi-k2",
                }))
              }
            />
            <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
              用其他模型 ID（手动输入）
            </span>
          </label>
          {form.modelId === "__custom" && (
            <div className="mt-3">
              <V2Input
                placeholder="输入模型 ID，例如：moonshot-v1-128k"
                value={form.customModelId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, customModelId: e.target.value }))
                }
              />
            </div>
          )}
        </div>
      </V2Section>

      {/* 平台选择 */}
      <V2Section title="接入平台" description="这个模型从哪个平台调用">
        {platforms.length === 0 ? (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            还没有可用的平台，先去「设置 → 平台」添加一个
          </p>
        ) : (
          <V2Field label="平台" required>
            <V2Select
              value={form.platformId}
              onChange={(e) =>
                setForm((p) => ({ ...p, platformId: e.target.value }))
              }
            >
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </V2Select>
          </V2Field>
        )}
      </V2Section>

      {/* 显示名（可选，自动） */}
      <V2Section>
        <V2Field label="显示名称" hint="留空则自动用模型名">
          <V2Input
            placeholder={
              POPULAR_MODELS.find((m) => m.id === form.modelId)?.label ||
              "自动"
            }
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
        </V2Field>
      </V2Section>

      {/* 测试连接（继承 legacy 的 testModel 功能） */}
      <V2Section title="测试连接" description="验证这个模型在当前平台能否正常调用">
        <div className="flex items-center gap-3">
          <V2GhostButton
            icon={PlugZap}
            loading={testing}
            onClick={handleTest}
          >
            {testing ? "测试中..." : "测试连接"}
          </V2GhostButton>
          {testResult && (
            <span className="text-sm text-[var(--kaypal-v3-muted)]">
              {testResult}
            </span>
          )}
        </div>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton
          icon={ArrowLeft}
          onClick={() => router.push("/capabilities/models")}
        >
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : modelId ? "保存修改" : "添加模型"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
