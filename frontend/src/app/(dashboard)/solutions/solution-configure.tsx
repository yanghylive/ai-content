"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Rocket, Loader2 } from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  getSolutionPackage,
  createSolutionRun,
  type SolutionPackageDefinition,
} from "@/lib/api/solutions";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

export function SolutionConfigure({ packageCode }: { packageCode: string }) {
  const router = useRouter();
  const [pkg, setPkg] = useState<SolutionPackageDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 配置值（智能默认值：用字段的 defaultValue 预填）
  const [values, setValues] = useState<Record<string, string>>({});

  const fetchPackage = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSolutionPackage(packageCode);
      setPkg(data);
      // 智能默认值预填
      const defaults: Record<string, string> = {};
      (data.productization?.configurationFields || []).forEach((field) => {
        if (field.defaultValue !== undefined) {
          defaults[field.key] = Array.isArray(field.defaultValue)
            ? field.defaultValue.join(", ")
            : String(field.defaultValue);
        }
      });
      setValues(defaults);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载方案失败"));
    } finally {
      setLoading(false);
    }
  }, [packageCode]);

  useEffect(() => {
    void fetchPackage();
  }, [fetchPackage]);

  const fields = pkg?.productization?.configurationFields || [];
  const missingRequired = fields.filter(
    (f) => f.required && !values[f.key]?.trim(),
  );
  const canSubmit = missingRequired.length === 0;

  const handleStart = async () => {
    if (!canSubmit) return;
    setStarting(true);
    setError(null);
    try {
      const configuredInput: Record<string, unknown> = {};
      fields.forEach((field) => {
        const v = values[field.key]?.trim();
        if (v) {
          configuredInput[field.key] =
            field.type === "number" ? Number(v) : field.type === "tags"
              ? v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
              : v;
        }
      });
      const run = await createSolutionRun(packageCode, { input: configuredInput });
      router.push(`/solutions/run?id=${run.id}`);
    } catch (err: unknown) {
      setError(toPublicError(err, "启动失败，请稍后重试"));
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!pkg) {
    return (
      <V2Section>
        <V2EmptyState
          icon={Rocket}
          title="没找到这个方案"
          action={
            <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/solutions")}>
              返回解决方案
            </V2GhostButton>
          }
        />
      </V2Section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/solutions")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {pkg.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              大部分已经帮你填好了，确认或改一下就能开始
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 配置项（预填默认值） */}
      <V2Section title="配置" description="带 * 的必须填，其他已按推荐填好">
        {fields.length === 0 ? (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            这个方案不需要配置，直接开始就行
          </p>
        ) : (
          <div className="grid gap-5">
            {fields.map((field) => (
              <V2Field
                key={field.key}
                label={field.label}
                required={field.required}
                hint={field.helper || undefined}
              >
                {field.type === "select" && field.options ? (
                  <V2Select
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">请选择</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </V2Select>
                ) : (
                  <V2Input
                    type={field.type === "number" ? "number" : "text"}
                    placeholder={field.placeholder || undefined}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                )}
              </V2Field>
            ))}
          </div>
        )}
      </V2Section>

      {/* 单一主行动 */}
      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/solutions")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={starting ? Loader2 : Rocket}
          loading={starting}
          disabled={!canSubmit}
          onClick={handleStart}
        >
          {starting ? "正在启动..." : "开始使用这个方案"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
