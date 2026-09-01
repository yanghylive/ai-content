"use client";

/**
 * 文件存储（2026-09-01 精简）
 *
 * 原「AI 服务与存储」页：AI 服务（模型选择）系统默认、不再让用户配置；
 * 内容来源已迁移到内容运营页（components/shell/content-sources.tsx）。
 * 本页只保留文件存储。
 */
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Loader2,
  Save,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
} from "@/components/v2/ui-kit";
import { storageApi, type StorageConfig } from "@/lib/api/settings";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

const STORAGE_PROVIDERS = [
  { value: "local" as const, label: "本地存储", desc: "存在这台电脑上" },
  { value: "qiniu" as const, label: "七牛云", desc: "对象存储" },
  { value: "aliyun-oss" as const, label: "阿里 OSS", desc: "对象存储" },
];

export function FileStorageSettings() {
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
      flash("存储配置已保存");
    } catch (err: unknown) {
      showError(toPublicError(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await storageApi.testConnection();
      if (result.success) {
        flash(result.message || "连接正常");
      } else {
        showError(result.message || "连接失败，请检查配置");
      }
    } catch (err: unknown) {
      showError(toPublicError(err, "测试失败"));
    } finally {
      setTesting(false);
    }
  };

  const isLocal = config.provider === "local";

  if (loading) {
    return (
      <div className="py-6 text-center">
        <SkeletonList rows={5} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {msg && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{msg}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section>
        <div className="grid gap-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </V2Section>
    </div>
  );
}
