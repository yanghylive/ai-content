"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import {
  contentStrategiesApi,
  type ContentStrategyPayload,
} from "@/lib/api/content-strategies";
import { toPublicError } from "@/lib/public-error";

const INDUSTRIES = ["通用", "电商", "教育", "餐饮", "美业", "房产", "金融", "科技"];

/**
 * 行业智能预填模板：用户选行业即得 80 分草稿，只改不填。
 * 这是"零学习成本"的核心——不让用户面对空白字段猜该写什么。
 */
const INDUSTRY_PRESETS: Record<
  string,
  Pick<
    ContentStrategyPayload,
    "targetAudience" | "commercialGoal" | "corePainPoints" | "writingAngles"
  >
> = {
  通用: {
    targetAudience: "25-40 岁，对你所在领域有需求的潜在客户",
    commercialGoal: "让用户看完愿意咨询或留下联系方式",
    corePainPoints: "不知道选哪家、怕被坑、怕花了钱没效果",
    writingAngles: "真实体验分享、避坑指南、对比测评",
  },
  电商: {
    targetAudience: "18-35 岁爱网购、注重性价比的消费者",
    commercialGoal: "引导进店下单，提升转化率",
    corePainPoints: "怕买贵、怕质量不好、怕售后麻烦",
    writingAngles: "好物种草、真实开箱、价格对比、使用场景展示",
  },
  教育: {
    targetAudience: "想提升自己或给孩子报课的家长/职场人",
    commercialGoal: "引导领取试听或咨询课程",
    corePainPoints: "不知道适不适合自己、怕没效果、怕坚持不下来",
    writingAngles: "学习前后对比、学员真实案例、干货知识分享",
  },
  餐饮: {
    targetAudience: "周边 3-5 公里的上班族和居民",
    commercialGoal: "引导到店消费或线上下单",
    corePainPoints: "不知道吃什么、怕踩雷、怕不卫生",
    writingAngles: "探店实拍、招牌菜展示、顾客评价、制作过程",
  },
  美业: {
    targetAudience: "20-45 岁注重形象管理的女性",
    commercialGoal: "引导到店体验或预约咨询",
    corePainPoints: "怕效果不好、怕推销、怕价格不透明",
    writingAngles: "前后对比、过程记录、客户证言、价格透明公示",
  },
  房产: {
    targetAudience: "有购房/租房需求的本地客户",
    commercialGoal: "引导预约看房或留下联系方式",
    corePainPoints: "怕被忽悠、不懂行情、怕买错地段",
    writingAngles: "实地看房记录、行情解读、避坑指南、区域分析",
  },
  金融: {
    targetAudience: "有理财/贷款需求的中小企业主和个人",
    commercialGoal: "引导咨询方案或预约顾问",
    corePainPoints: "怕风险、看不懂条款、怕踩坑",
    writingAngles: "知识科普、案例拆解、风险提醒、政策解读",
  },
  科技: {
    targetAudience: "关注效率和新技术的企业决策者/职场人",
    commercialGoal: "引导试用产品或预约演示",
    corePainPoints: "不知道哪个工具适合自己、怕学习成本高、怕不值",
    writingAngles: "效率对比、场景演示、干货教程、客户案例",
  },
};

export function StrategyForm({
  strategyId,
  initialValues,
}: {
  strategyId?: string;
  initialValues?: Partial<ContentStrategyPayload>;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(strategyId));

  // 智能默认值
  const [form, setForm] = useState<ContentStrategyPayload>({
    name: initialValues?.name || "",
    description: initialValues?.description || "",
    industry: initialValues?.industry || "通用",
    targetAudience: initialValues?.targetAudience || "",
    commercialGoal: initialValues?.commercialGoal || "",
    corePainPoints: initialValues?.corePainPoints || "",
    writingAngles: initialValues?.writingAngles || "",
    toneAndStyle: initialValues?.toneAndStyle || "",
    isDefault: initialValues?.isDefault ?? false,
    enabled: initialValues?.enabled ?? true,
  });

  // 编辑模式：加载现有数据
  const loadStrategy = useCallback(async () => {
    if (!strategyId) return;
    try {
      setLoading(true);
      const list = await contentStrategiesApi.list();
      const found = list.find((s) => s.id === strategyId);
      if (found) {
        setForm({
          name: found.name,
          description: found.description || "",
          industry: found.industry || "通用",
          targetAudience: found.targetAudience,
          commercialGoal: found.commercialGoal,
          corePainPoints: found.corePainPoints,
          writingAngles: found.writingAngles,
          toneAndStyle: found.toneAndStyle || "",
          isDefault: found.isDefault,
          enabled: found.enabled,
        });
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "加载策略失败"));
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => {
    void loadStrategy();
  }, [loadStrategy]);

  const canSubmit =
    form.name.trim() &&
    form.targetAudience.trim() &&
    form.commercialGoal.trim() &&
    form.corePainPoints.trim() &&
    form.writingAngles.trim();

  // 选中行业 → 预填空白字段（不覆盖用户已输入的内容）
  const [prefilled, setPrefilled] = useState(false);
  const applyIndustryPreset = (industry: string) => {
    const preset = INDUSTRY_PRESETS[industry];
    setForm((prev) => ({
      ...prev,
      industry,
      targetAudience: prev.targetAudience || preset.targetAudience,
      commercialGoal: prev.commercialGoal || preset.commercialGoal,
      corePainPoints: prev.corePainPoints || preset.corePainPoints,
      writingAngles: prev.writingAngles || preset.writingAngles,
    }));
    setPrefilled(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (strategyId) {
        await contentStrategiesApi.update(strategyId, form);
      } else {
        await contentStrategiesApi.create(form);
      }
      router.push("/strategies");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
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
            onClick={() => router.push("/strategies")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              {strategyId ? "编辑策略" : "新建策略"}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              带 * 的是必填项，其他可以之后再补
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：选行业 → 自动预填（零学习成本核心） */}
      {!strategyId && (
        <V2Section
          title="你的行业"
          description="选一个行业，系统自动帮你填好下面 80% 的内容，你只需改改"
        >
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {INDUSTRIES.map((ind) => (
              <button
                key={ind}
                type="button"
                className={`rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2.5 text-sm font-medium transition ${
                  form.industry === ind
                    ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                    : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                }`}
                onClick={() => applyIndustryPreset(ind)}
              >
                {ind}
              </button>
            ))}
          </div>
          {prefilled && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--kaypal-v3-success)]">
              ✓ 已按「{form.industry}」预填下面的内容，直接改成你的就行
            </p>
          )}
        </V2Section>
      )}

      {/* 第 2 步：基础信息（已预填，只需修改） */}
      <V2Section title="基础信息" description="AI 按这些信息生成内容">
        <div className="grid gap-5">
          <V2Field label="策略名称" required hint="给自己看的名字，例如：夏季促销主推">
            <V2Input
              placeholder="例如：夏季促销主推"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </V2Field>

          <V2Field label="目标受众" required hint="你的内容是写给谁看的">
            <V2Input
              placeholder="例如：25-35 岁一二线城市女性"
              value={form.targetAudience}
              onChange={(e) =>
                setForm((p) => ({ ...p, targetAudience: e.target.value }))
              }
            />
          </V2Field>

          <V2Field label="商业目标" required hint="你希望内容帮你达成什么">
            <V2Input
              placeholder="例如：引导用户到店咨询 / 加微信"
              value={form.commercialGoal}
              onChange={(e) =>
                setForm((p) => ({ ...p, commercialGoal: e.target.value }))
              }
            />
          </V2Field>

          <V2Field label="核心痛点" required hint="你的受众最关心、最头疼的问题">
            <V2Textarea
              placeholder="例如：不知道怎么选产品、怕买贵、怕没效果"
              value={form.corePainPoints}
              onChange={(e) =>
                setForm((p) => ({ ...p, corePainPoints: e.target.value }))
              }
            />
          </V2Field>

          <V2Field label="写作角度" required hint="从哪些角度切入写内容">
            <V2Textarea
              placeholder="例如：真实使用体验、对比测评、避坑指南"
              value={form.writingAngles}
              onChange={(e) =>
                setForm((p) => ({ ...p, writingAngles: e.target.value }))
              }
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 高级设置（可选，渐进式披露） */}
      <V2Section>
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="所属行业">
              <V2Select
                value={form.industry}
                onChange={(e) =>
                  setForm((p) => ({ ...p, industry: e.target.value }))
                }
              >
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </V2Select>
            </V2Field>

            <V2Field label="语气风格" hint="例如：亲切口语化 / 专业严谨">
              <V2Input
                placeholder="例如：亲切口语化"
                value={form.toneAndStyle}
                onChange={(e) =>
                  setForm((p) => ({ ...p, toneAndStyle: e.target.value }))
                }
              />
            </V2Field>

            <V2Field label="策略描述">
              <V2Textarea
                placeholder="补充说明这个策略的用途"
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </V2Field>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--kaypal-v3-border)]"
                checked={form.isDefault}
                onChange={(e) =>
                  setForm((p) => ({ ...p, isDefault: e.target.checked }))
                }
              />
              <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                设为默认策略（生成内容时优先使用）
              </span>
            </label>
          </div>
        </V2Disclosure>
      </V2Section>

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/strategies")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton
          icon={Save}
          loading={saving}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "正在保存..." : strategyId ? "保存修改" : "创建策略"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
