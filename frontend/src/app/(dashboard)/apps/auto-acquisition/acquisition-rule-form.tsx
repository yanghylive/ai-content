"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  MessageCircle,
  Music2,
  Play,
  PlayCircle,
  Plus,
  Save,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2Select,
  V2Disclosure,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthAccountHealth, type GrowthAcquisitionPreflight, type GrowthPlatform } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const PLATFORM_OPTIONS = [
  { value: "douyin", label: "抖音", desc: "评论区找客户", icon: Music2 },
  { value: "xiaohongshu", label: "小红书", desc: "笔记和评论", icon: BookOpen },
  { value: "kuaishou", label: "快手", desc: "评论区找客户", icon: Play },
  { value: "wechat", label: "微信", desc: "微信群和朋友圈", icon: MessageCircle },
] as const;

// §8.2-B 第 1 步：场景和客户类型预设（选中后预填平台/关键词/话术）
const SCENARIO_OPTIONS = [
  {
    value: "home-renovation",
    label: "家装/装修",
    desc: "本地装修咨询客户",
    preset: {
      platform: "douyin" as const,
      keywords: "装修,旧房翻新,全屋定制",
      commentTemplate: "你好，看到你也在关注装修，我们做本地装修服务，方便聊聊吗？",
      privateTemplate: "你好，我是{品牌}，做本地装修的，看你对装修感兴趣，方便加微信详细聊聊吗？",
    },
  },
  {
    value: "beauty-makeup",
    label: "美业/护肤",
    desc: "美甲护肤客户",
    preset: {
      platform: "xiaohongshu" as const,
      keywords: "美甲,护肤,医美",
      commentTemplate: "姐妹，看到你关注这个，我们这有性价比方案，想了解下吗？",
      privateTemplate: "你好，我是{品牌}，专业美业服务，看你感兴趣，方便聊聊吗？",
    },
  },
  {
    value: "edu-training",
    label: "教育培训",
    desc: "课程咨询客户",
    preset: {
      platform: "douyin" as const,
      keywords: "课程,培训,报名",
      commentTemplate: "你好，看到你问这个课程，我们有试听课，需要了解吗？",
      privateTemplate: "你好，我是{品牌}的课程顾问，看你关注这个领域，方便加微信了解下吗？",
    },
  },
  {
    value: "local-life",
    label: "本地生活",
    desc: "同城到店客户",
    preset: {
      platform: "douyin" as const,
      keywords: "同城,探店,到店",
      commentTemplate: "你好，我们在本地，看到你关注这个，欢迎来体验～",
      privateTemplate: "你好，我是{品牌}，本地实体店，看你感兴趣，方便加微信预约吗？",
    },
  },
  {
    value: "ecommerce",
    label: "电商带货",
    desc: "购物种草客户",
    preset: {
      platform: "xiaohongshu" as const,
      keywords: "好物,测评,种草",
      commentTemplate: "你好，看到你也在种草这个，我们有同款好物，想了解下吗？",
      privateTemplate: "你好，我是{品牌}，专注好物推荐，看你感兴趣，方便聊聊吗？",
    },
  },
  {
    value: "catering",
    label: "餐饮",
    desc: "本地到店/团购客户",
    preset: {
      platform: "douyin" as const,
      keywords: "探店,美食,团购,聚餐",
      commentTemplate: "老板，看到你也在找好吃的，我们有本地团购套餐，需要了解下吗？",
      privateTemplate: "你好，我是{品牌}，本地餐饮店，看你关注美食，方便加微信发你套餐详情吗？",
    },
  },
  {
    value: "wechat-business",
    label: "微商/私域",
    desc: "微信私域与朋友圈客户",
    preset: {
      platform: "wechat" as const,
      keywords: "副业,货源,朋友圈,私域",
      commentTemplate: "看你也做私域这块，我们有供应链货源资源，交流下？",
      privateTemplate: "你好，我是{品牌}，专注私域好货供应链，看你也做这块，方便交流下吗？",
    },
  },
  {
    value: "direct-sales",
    label: "直销/轻创业",
    desc: "副业与轻创业人群",
    preset: {
      platform: "wechat" as const,
      keywords: "副业,轻创业,项目,兼职",
      commentTemplate: "想了解轻创业项目的话可以聊聊，模式透明不画饼",
      privateTemplate: "你好，我是{品牌}团队，正在招募轻创业伙伴，想了解可以聊，模式与投入全程透明",
    },
  },
  {
    value: "fitness",
    label: "健身",
    desc: "减脂健身与私教客户",
    preset: {
      platform: "douyin" as const,
      keywords: "健身,减脂,私教,增肌",
      commentTemplate: "看到你在练这个，我们有体验课，需要了解下吗？",
      privateTemplate: "你好，我是{品牌}健身教练，看你关注健身，方便加微信约节体验课吗？",
    },
  },
  {
    value: "maternal-baby",
    label: "母婴/产后",
    desc: "产后恢复与母婴服务客户",
    preset: {
      platform: "xiaohongshu" as const,
      keywords: "产后恢复,育儿,母婴",
      commentTemplate: "宝妈你好，看到你也在关注这个，我们做产后恢复，想了解下吗？",
      privateTemplate: "你好，我是{品牌}，专注产后恢复服务，看你在了解，方便聊聊吗？",
    },
  },
  {
    value: "healthcare",
    label: "医疗健康",
    desc: "体检与健康管理客户",
    preset: {
      platform: "douyin" as const,
      keywords: "体检,健康管理,养生",
      commentTemplate: "健康问题建议咨询专业人士，我们有体检服务，需要了解可以聊聊",
      privateTemplate: "您好，我是{品牌}健康顾问，如有体检或健康管理需求，方便沟通下吗？",
    },
  },
  {
    value: "auto-aftermarket",
    label: "汽车后市场",
    desc: "本地养车保养车主",
    preset: {
      platform: "douyin" as const,
      keywords: "养车,洗车,保养,汽修",
      commentTemplate: "老铁，看到你也在聊养车，我们店保养透明不宰客，需要了解吗？",
      privateTemplate: "你好，我是{品牌}汽服店，本地养车保养，看你在关注，方便加微信咨询吗？",
    },
  },
  {
    value: "real-estate",
    label: "房产中介",
    desc: "买房/租房客源",
    preset: {
      platform: "douyin" as const,
      keywords: "买房,看房,二手房,租房",
      commentTemplate: "看到你在看房，我们这有真实房源，需要推荐吗？",
      privateTemplate: "您好，我是{品牌}房产顾问，本地真实房源，看你有购房需求，方便加微信发你几套房源吗？",
    },
  },
  {
    value: "wedding-photo",
    label: "婚庆摄影",
    desc: "婚纱照与婚庆客户",
    preset: {
      platform: "xiaohongshu" as const,
      keywords: "婚纱照,婚礼,婚庆,跟拍",
      commentTemplate: "看到你在看婚纱照，我们有真实客片，想看看吗？",
      privateTemplate: "你好，我是{品牌}摄影工作室，看你在了解婚纱照，方便发你真实客片参考吗？",
    },
  },
  {
    value: "b2b-leads",
    label: "B2B 线索",
    desc: "企业采购决策人",
    preset: {
      platform: "kuaishou" as const,
      keywords: "供应链,采购,合作",
      commentTemplate: "您好，看到您关注供应链话题，我们有合作方案，方便聊聊吗？",
      privateTemplate: "您好，我是{品牌}商务，看您对供应链感兴趣，方便加微信对接吗？",
    },
  },
] as const;

// 自定义行业（用户新增）：结构与系统预置完全一致，本地持久化
const CUSTOM_SCENARIOS_KEY = "kaypal.v3.customScenarios.v1";

type CustomScenarioPreset = {
  platform: GrowthPlatform;
  keywords: string;
  commentTemplate: string;
  privateTemplate: string;
};

type CustomScenario = {
  value: string;
  label: string;
  desc: string;
  preset: CustomScenarioPreset;
};

const DEFAULT_CUSTOM_DRAFT = {
  label: "",
  desc: "",
  platform: "douyin" as GrowthPlatform,
  keywords: "",
  commentTemplate: "你好，看到你关注这个话题，我们正好在做这个，可以聊聊～",
  privateTemplate: "你好，我是{品牌}，看到你对我们这个领域感兴趣，方便加个微信详聊吗？",
};

function loadCustomScenarios(): CustomScenario[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SCENARIOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomScenario[]) : [];
  } catch {
    return [];
  }
}

function saveCustomScenarios(items: CustomScenario[]) {
  try {
    localStorage.setItem(CUSTOM_SCENARIOS_KEY, JSON.stringify(items));
  } catch {
    // 存储不可用静默忽略，不影响本次会话
  }
}

// 平台与执行账号联动：只展示与所选平台匹配的账号。
// 微信任务的执行账号来自视频号（账号体系同源），故 wechat 兼容 wechat-channel。
function accountMatchesPlatform(
  accountPlatform: string,
  taskPlatform: string,
): boolean {
  if (taskPlatform === "wechat") {
    return accountPlatform === "wechat" || accountPlatform === "wechat-channel";
  }
  return accountPlatform === taskPlatform;
}

export function AcquisitionRuleForm() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 执行账号：自动拉取账号健康列表，按所选平台联动过滤，默认选中该平台
  // online+normal 的真实账号。选择用后端复合 key（platform:accountId）定位，
  // 避免历史数据 accountId 重复时多个账号同时显示选中、无法单选。
  const [accounts, setAccounts] = useState<GrowthAccountHealth[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    growthApi
      .listAccountHealth()
      .then((list) => {
        if (cancelled) return;
        setAccounts(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  // 智能默认值
  const [form, setForm] = useState({
    taskName: "",
    scene: "",
    platform: "douyin" as GrowthPlatform,
    keywords: "",
    dailyLimit: 20,
    commentTemplate: "你好，看到你关注这个话题，我们正好在做这个，可以聊聊～",
    privateTemplate: "你好，我是{品牌}，看到你对我们这个领域感兴趣，方便加个微信详聊吗？",
    riskMode: "confirm-first" as "auto" | "confirm-first" | "draft-only",
    excludeKeywords: "",
    blacklistNicknames: "",
    perTargetLimit: 3,
    scheduleEnabled: false,
    beginTime: "09:00",
  });

  // 自定义行业：本地持久化，选中后与系统预置走同一套预填逻辑
  const [customScenarios, setCustomScenarios] = useState<CustomScenario[]>(
    loadCustomScenarios,
  );
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [scenarioDraft, setScenarioDraft] = useState(DEFAULT_CUSTOM_DRAFT);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const allScenarios = useMemo<CustomScenario[]>(
    () => [...SCENARIO_OPTIONS, ...customScenarios],
    [customScenarios],
  );

  const resetScenarioDraft = () => {
    setScenarioDraft(DEFAULT_CUSTOM_DRAFT);
    setScenarioError(null);
  };

  const addCustomScenario = () => {
    const label = scenarioDraft.label.trim();
    const keywords = scenarioDraft.keywords.trim();
    if (!label) {
      setScenarioError("请填写行业名称");
      return;
    }
    if (!keywords) {
      setScenarioError("请填写获客关键词（逗号分隔）");
      return;
    }
    if (allScenarios.some((s) => s.label === label)) {
      setScenarioError(`「${label}」已存在，请换一个名称`);
      return;
    }
    const preset: CustomScenarioPreset = {
      platform: scenarioDraft.platform,
      keywords,
      commentTemplate:
        scenarioDraft.commentTemplate.trim() || DEFAULT_CUSTOM_DRAFT.commentTemplate,
      privateTemplate:
        scenarioDraft.privateTemplate.trim() || DEFAULT_CUSTOM_DRAFT.privateTemplate,
    };
    const item: CustomScenario = {
      value: `custom-${Date.now().toString(36)}`,
      label,
      desc: scenarioDraft.desc.trim(),
      preset,
    };
    const next = [...customScenarios, item];
    setCustomScenarios(next);
    saveCustomScenarios(next);
    // 新增即选中并预填（与系统预置行为一致）
    setForm((p) => ({
      ...p,
      scene: item.value,
      platform: preset.platform,
      keywords: preset.keywords,
      commentTemplate: preset.commentTemplate,
      privateTemplate: preset.privateTemplate,
    }));
    setShowCustomForm(false);
    resetScenarioDraft();
  };

  const removeCustomScenario = (value: string) => {
    const item = customScenarios.find((s) => s.value === value);
    if (!item) return;
    if (!window.confirm(`删除自定义行业「${item.label}」？删除后可随时重新添加。`)) {
      return;
    }
    const next = customScenarios.filter((s) => s.value !== value);
    setCustomScenarios(next);
    saveCustomScenarios(next);
    if (form.scene === value) {
      setForm((p) => ({ ...p, scene: "" }));
    }
  };

  // T3-4：AI 记得你上次——加载 kaypal 长期记忆，预填行业/关键词/话术
  const [memoryHint, setMemoryHint] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loadMemory = async () => {
      try {
        const res = await fetch("/api/memory/kaypal?query=获客&tier=long&limit=3", {
          credentials: "include",
        });
        const body = (await res.json()) as {
          data?: { items?: Array<{ content?: string; summary?: string }> };
        };
        const items = body?.data?.items || [];
        if (cancelled || !items.length) return;
        const content = items[0]?.content || "";
        const kwMatch = content.match(/关键词=([^，,]+(?:、[^，,]+)*)/);
        const tmplMatch = content.match(/话术风格=([^\n。]{2,80})/);
        if (cancelled) return;
        if (kwMatch?.[1]) {
          setForm((p) => (p.keywords ? p : { ...p, keywords: kwMatch[1] }));
        }
        if (tmplMatch?.[1]) {
          setForm((p) =>
            p.commentTemplate && p.commentTemplate.includes("可以聊聊")
              ? { ...p, commentTemplate: tmplMatch[1] }
              : p,
          );
        }
        setMemoryHint(
          items[0]?.summary || `AI 记得你上次：${content.slice(0, 60)}…`,
        );
      } catch {
        // 记忆不可用静默忽略，不影响创建流程
      } finally {
        if (!cancelled) setMemoryLoaded(true);
      }
    };
    void loadMemory();
    return () => {
      cancelled = true;
    };
  }, []);

  // 平台与账号联动：只展示当前所选平台的账号（微信任务兼容视频号账号）
  const visibleAccounts = useMemo(
    () =>
      accounts.filter((a) => accountMatchesPlatform(a.platform, form.platform)),
    [accounts, form.platform],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedKey) ?? null,
    [accounts, selectedKey],
  );

  // 平台切换 / 列表加载后，若选中账号不在当前平台，自动改选该平台第一个可用账号
  useEffect(() => {
    if (accountsLoading) return;
    const stillVisible =
      selectedAccount !== null &&
      accountMatchesPlatform(selectedAccount.platform, form.platform);
    if (stillVisible) return;
    const usable = visibleAccounts.find(
      (a) => a.loginStatus === "online" && a.riskStatus === "normal",
    );
    const chosen = usable ?? visibleAccounts[0] ?? null;
    setSelectedKey(chosen ? chosen.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.platform, accountsLoading, accounts]);

  // 任务名自动生成
  const keywords = form.keywords
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const autoTaskName =
    form.taskName ||
    (keywords.length > 0
      ? `${PLATFORM_OPTIONS.find((p) => p.value === form.platform)?.label}获客：${keywords[0]}`
      : "");

  const canSubmit = keywords.length > 0 && form.dailyLimit > 0;

  /** T06：创建后持有的 configId（用于预检/执行） */
  const [createdConfigId, setCreatedConfigId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<GrowthAcquisitionPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  /** T06：预检（Q9：先保存草稿拿 configId → 再 preflight） */
  const runPreflight = useCallback(async (configId: string) => {
    setPreflightLoading(true);
    setPreflight(null);
    try {
      const result = await growthApi.preflightConfig(configId);
      setPreflight(result);
      return result;
    } catch (err: unknown) {
      setError(toPublicError(err, "预检失败，请稍后重试"));
      return null;
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!selectedAccount) {
      setError("请先选择执行账号（账号健康列表为空或未加载到可用账号）");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const config = await growthApi.createConfig({
        taskName: autoTaskName,
        platform: form.platform,
        accountId: selectedAccount.accountId,
        accountName: selectedAccount.accountName,
        sourceInputs: keywords,
        includeKeywords: keywords,
        excludeKeywords: form.excludeKeywords
          .split(/[,，\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        commentTemplates: [form.commentTemplate],
        privateMessageTemplates: [form.privateTemplate],
        dailyLimit: form.dailyLimit,
        perTargetLimit: form.perTargetLimit,
        deduplicate: true,
        blacklistNicknames: form.blacklistNicknames
          .split(/[,，\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        scheduleEnabled: form.scheduleEnabled,
        beginTime: form.scheduleEnabled ? form.beginTime : "",
        riskMode: form.riskMode,
        status: "disabled",
      });
      if (config?.id) {
        setCreatedConfigId(config.id);
        await runPreflight(config.id);
      } else {
        router.push("/growth/acquisition");
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "创建获客任务失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  /** T06：强制执行（仅预检通过后可用） */
  const handleExecute = async () => {
    if (!createdConfigId || !preflight?.allowed) return;
    setExecuting(true);
    setError(null);
    try {
      await growthApi.executeConfig(createdConfigId);
      router.push("/growth/acquisition");
    } catch (err: unknown) {
      setError(toPublicError(err, "任务执行失败，请稍后重试"));
    } finally {
      setExecuting(false);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——auto-acquisition-v2/create */
  if (isMobile) {
    const fieldStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(142,165,190,.3)",
      background: "rgba(255,255,255,.06)",
      color: "var(--kaypal-v3-ink)",
      fontSize: 13,
    };
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/growth/acquisition")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回获客任务
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 16 }}>新建获客任务</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>告诉系统你的客户在哪，它自动帮你去找</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 13, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {memoryHint && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(246,196,120,.5)", background: "rgba(246,196,120,.08)" }}>
              <p style={{ fontSize: 13, color: "var(--kaypal-v3-amber)" }}>{memoryHint}</p>
            </div>
          )}

          {/* 第 1 步：平台 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>第 1 步：客户在哪个平台？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PLATFORM_OPTIONS.map(({ value, label, desc, icon: PlatformIcon }) => {
              const selected = form.platform === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, platform: value }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>
                    <PlatformIcon width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 1 }}>{desc}</span>
                  </span>
                  {selected && <span style={{ color: "var(--kaypal-v3-amber)", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 执行账号（移动端） */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>执行账号</div>
          {accountsLoading ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)" }}>正在加载账号…</p>
          ) : visibleAccounts.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)" }}>
              当前平台暂无可用执行账号：请先到
              <a
                href="/distribution/accounts"
                onClick={(e) => {
                  e.preventDefault();
                  router.push("/distribution/accounts");
                }}
                style={{
                  margin: "0 3px",
                  fontWeight: 700,
                  color: "var(--kaypal-v3-accent-ink)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                平台账号 ↗
              </a>
              页完成账号授权登录，或切换平台
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleAccounts.map((account) => {
                const selected = account.id === selectedKey;
                const usable =
                  account.loginStatus === "online" &&
                  account.riskStatus === "normal";
                return (
                  <button
                    key={account.id}
                    type="button"
                    disabled={!usable}
                    onClick={() => setSelectedKey(account.id)}
                    className="mx-card"
                    style={{
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      textAlign: "left",
                      borderColor: selected ? "rgba(222,150,57,.6)" : undefined,
                      background: selected ? "rgba(246,196,120,.1)" : undefined,
                      opacity: usable ? 1 : 0.5,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        background: usable ? "#22c55e" : "#e05c5c",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>
                        {account.accountName || `${account.platform} ${account.accountId}`}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 1 }}>
                        {account.platform} · 登录 {account.loginStatus} · 风险 {account.riskStatus}
                        {!usable ? "（不可用，请先处理账号状态）" : ""}
                      </span>
                    </span>
                    {selected && <span style={{ color: "var(--kaypal-v3-amber)", fontSize: 14, flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* 第 2 步：关键词 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 2 步：他们会搜/聊什么词？</div>
          <textarea
            placeholder="例如：空气净化器, 除甲醛, 新房装修"
            value={form.keywords}
            onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.6 }}
          />
          <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>你的客户会关注的话题词，逗号分隔</p>
          {keywords.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-success)", marginTop: 4 }}>✓ 将监控 {keywords.length} 个关键词：{keywords.join("、")}</p>
          )}

          {/* 第 3 步：话术 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>第 3 步：找到后说什么？</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>评论话术</span>
              <textarea
                value={form.commentTemplate}
                onChange={(e) => setForm((p) => ({ ...p, commentTemplate: e.target.value }))}
                rows={2}
                style={{ ...fieldStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
              />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>私信话术</span>
              <textarea
                value={form.privateTemplate}
                onChange={(e) => setForm((p) => ({ ...p, privateTemplate: e.target.value }))}
                rows={2}
                style={{ ...fieldStyle, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
              />
            </label>
          </div>

          {/* 高级设置 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>高级设置</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>每天最多触达</span>
              <input type="number" min={1} max={100} value={form.dailyLimit} onChange={(e) => setForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))} style={{ ...fieldStyle, marginTop: 6 }} />
              <span style={{ fontSize: 10, color: "var(--kaypal-v3-muted)" }}>建议 10-30，太多容易被平台限制</span>
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>排除关键词</span>
              <input placeholder="例如：同行, 广告" value={form.excludeKeywords} onChange={(e) => setForm((p) => ({ ...p, excludeKeywords: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>昵称黑名单</span>
              <input placeholder="例如：某某官方旗舰店" value={form.blacklistNicknames} onChange={(e) => setForm((p) => ({ ...p, blacklistNicknames: e.target.value }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>同一个人最多触达几次</span>
              <input type="number" min={1} max={10} value={form.perTargetLimit} onChange={(e) => setForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))} style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            {/* 定时启动 */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>定时启动</span>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
                <input type="checkbox" checked={form.scheduleEnabled} onChange={(e) => setForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 12, color: "var(--kaypal-v3-ink)" }}>每天</span>
                <input type="time" value={form.beginTime} disabled={!form.scheduleEnabled} onChange={(e) => setForm((p) => ({ ...p, beginTime: e.target.value }))} style={{ ...fieldStyle, flex: 1, padding: "7px 10px", opacity: form.scheduleEnabled ? 1 : 0.5 }} />
              </div>
            </div>
            {/* 发送方式 */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>发送方式</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 7 }}>
                {[
                  { value: "confirm-first" as const, label: "每条都先给我确认（推荐）" },
                  { value: "draft-only" as const, label: "只存草稿，我自己发" },
                  { value: "auto" as const, label: "自动发送（高风险）" },
                ].map((opt) => (
                  <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="radio" name="riskMode" checked={form.riskMode === opt.value} onChange={() => setForm((p) => ({ ...p, riskMode: opt.value }))} style={{ width: 15, height: 15 }} />
                    <span style={{ fontSize: 13, color: "var(--kaypal-v3-ink)" }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/growth/acquisition")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 13, fontWeight: 600 }}>
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
              {saving ? "正在创建…" : "创建获客任务"}
            </button>
          </div>

          {/* T06：移动端预检结果（创建成功后） */}
          {createdConfigId && (
            <div className="mx-card" style={{ marginTop: 12, padding: 12 }}>
              {preflightLoading ? (
                <p style={{ fontSize: 13, color: "var(--kaypal-v3-muted)" }}>正在预检任务…</p>
              ) : preflight ? (
                <>
                  <p style={{ fontSize: 13, fontWeight: 700, color: preflight.allowed ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-danger)" }}>
                    {preflight.allowed ? "✓ 预检通过" : "✗ 预检未通过"}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--kaypal-v3-ink)", marginTop: 4, lineHeight: 1.6 }}>{preflight.summary}</p>
                  {preflight.blockers.length > 0 && (
                    <ul style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                      {preflight.blockers.map((b) => (
                        <li key={b} style={{ fontSize: 12, color: "var(--kaypal-v3-danger)" }}>· {b}</li>
                      ))}
                    </ul>
                  )}
                  {preflight.allowed && (
                    <button
                      type="button"
                      className="mx-btn-gold"
                      style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                      disabled={executing}
                      onClick={() => void handleExecute()}
                    >
                      <PlayCircle width={15} height={15} />
                      {executing ? "正在执行…" : "预检通过，立即执行"}
                    </button>
                  )}
                </>
              ) : null}
            </div>
          )}
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
            onClick={() => router.push("/growth/acquisition")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              新建获客任务
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              告诉系统你的客户在哪，它自动帮你去找
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {memoryHint && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-warning)] bg-[var(--kaypal-v3-warning-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-warning)]">
            {memoryHint}
          </p>
        </div>
      )}

      {/* 5 步向导指示器（§8.2-B） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid var(--kaypal-v3-border)",
          background: "var(--kaypal-v3-paper)",
          flexWrap: "wrap",
        }}
      >
        {[
          ["1", "场景和客户类型"],
          ["2", "平台/账号/关键词"],
          ["3", "策略和话术"],
          ["4", "账号/额度/风控预检"],
          ["5", "草稿确认执行"],
        ].map(([num, label], i, arr) => (
          <div key={num} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: i === 0 ? "#fff" : "var(--kaypal-v3-muted)",
                  background:
                    i === 0
                      ? "var(--kaypal-v3-accent)"
                      : "var(--kaypal-v3-paper-soft)",
                }}
              >
                {num}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: i === 0 ? "var(--kaypal-v3-ink)" : "var(--kaypal-v3-muted)",
                  fontWeight: i === 0 ? 700 : 400,
                }}
              >
                {label}
              </span>
            </div>
            {i < arr.length - 1 && (
              <span style={{ color: "var(--kaypal-v3-border)", fontSize: 12 }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* 第 1 步：场景和客户类型（§8.2-B，选中预填平台/关键词/话术） */}
      <V2Section
        title="第 1 步：场景和客户类型"
        description="选择一个常见场景，自动帮你预填平台、关键词和话术；也可新增自己的行业"
        action={
          <V2GhostButton icon={Plus} onClick={() => setShowCustomForm((v) => !v)}>
            {showCustomForm ? "收起新增" : "新增自定义行业"}
          </V2GhostButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {allScenarios.map(({ value, label, desc, preset }) => {
            const isCustom = value.startsWith("custom-");
            return (
              <V2OptionCard
                key={value}
                icon={Target}
                title={label}
                description={desc}
                selected={form.scene === value}
                badge={isCustom ? "自定义" : undefined}
                onDelete={isCustom ? () => removeCustomScenario(value) : undefined}
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    scene: value,
                    platform: preset.platform,
                    keywords: preset.keywords,
                    commentTemplate: preset.commentTemplate,
                    privateTemplate: preset.privateTemplate,
                  }))
                }
              />
            );
          })}
        </div>

        {showCustomForm && (
          <div className="mt-4 rounded-[var(--kaypal-v3-radius)] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <V2Field label="行业名称" required hint="例如：宠物店、口腔诊所">
                <V2Input
                  value={scenarioDraft.label}
                  placeholder="填写你的行业名称"
                  onChange={(e) =>
                    setScenarioDraft((d) => ({ ...d, label: e.target.value }))
                  }
                />
              </V2Field>
              <V2Field label="客户描述" hint="一句话描述你的目标客户（可选）">
                <V2Input
                  value={scenarioDraft.desc}
                  placeholder="例如：本地养宠家庭"
                  onChange={(e) =>
                    setScenarioDraft((d) => ({ ...d, desc: e.target.value }))
                  }
                />
              </V2Field>
              <V2Field label="主平台" required>
                <V2Select
                  value={scenarioDraft.platform}
                  onChange={(e) =>
                    setScenarioDraft((d) => ({
                      ...d,
                      platform: e.target.value as GrowthPlatform,
                    }))
                  }
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </V2Select>
              </V2Field>
              <V2Field label="获客关键词" required hint="逗号分隔，例如：宠物,美容,洗澡">
                <V2Input
                  value={scenarioDraft.keywords}
                  placeholder="例如：宠物,美容,洗澡"
                  onChange={(e) =>
                    setScenarioDraft((d) => ({ ...d, keywords: e.target.value }))
                  }
                />
              </V2Field>
              <V2Field label="评论话术" hint="主动评论目标客户时使用，可用 {品牌} 占位">
                <V2Textarea
                  value={scenarioDraft.commentTemplate}
                  rows={3}
                  onChange={(e) =>
                    setScenarioDraft((d) => ({
                      ...d,
                      commentTemplate: e.target.value,
                    }))
                  }
                />
              </V2Field>
              <V2Field label="私信话术" hint="私信触达时使用，可用 {品牌} 占位">
                <V2Textarea
                  value={scenarioDraft.privateTemplate}
                  rows={3}
                  onChange={(e) =>
                    setScenarioDraft((d) => ({
                      ...d,
                      privateTemplate: e.target.value,
                    }))
                  }
                />
              </V2Field>
            </div>
            {scenarioError && (
              <p className="mt-3 text-sm text-[var(--kaypal-v3-danger)]">
                {scenarioError}
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <V2PrimaryButton icon={Plus} onClick={addCustomScenario}>
                保存并使用该行业
              </V2PrimaryButton>
              <V2GhostButton
                onClick={() => {
                  setShowCustomForm(false);
                  resetScenarioDraft();
                }}
              >
                取消
              </V2GhostButton>
            </div>
          </div>
        )}

        {form.scene && (
          <p
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "var(--kaypal-v3-success)",
            }}
          >
            ✓ 已选择「
            {allScenarios.find((s) => s.value === form.scene)?.label}
            」，平台/关键词/话术已预填，可继续微调
          </p>
        )}
      </V2Section>

      {/* 第 2 步：平台 */}
      <V2Section title="第 2 步：你的客户在哪个平台？">
        <div className="grid gap-3 sm:grid-cols-3">
          {PLATFORM_OPTIONS.map(({ value, label, desc, icon }) => (
            <V2OptionCard
              key={value}
              icon={icon}
              title={label}
              description={desc}
              selected={form.platform === value}
              onClick={() => setForm((p) => ({ ...p, platform: value }))}
            />
          ))}
        </div>
      </V2Section>

      {/* 执行账号 */}
      <V2Section title="执行账号">
        <p className="mb-2 text-sm text-[var(--kaypal-v3-muted)]">
          任务将使用下面这个已登录的平台账号实际执行（发评论/私信）
        </p>
        {accountsLoading ? (
          <p className="text-sm text-[var(--kaypal-v3-muted)]">正在加载账号…</p>
        ) : visibleAccounts.length === 0 ? (
          <p className="text-sm text-[var(--kaypal-v3-danger)]">
            当前平台暂无可用执行账号：请先到
            <a
              href="/distribution/accounts"
              onClick={(e) => {
                e.preventDefault();
                router.push("/distribution/accounts");
              }}
              className="mx-1 inline-flex items-center font-bold text-[var(--kaypal-v3-accent-ink)] underline underline-offset-2 transition-colors hover:text-[var(--kaypal-v3-accent)]"
            >
              平台账号 ↗
            </a>
            页完成平台账号授权登录，或切换平台
          </p>
        ) : (
          <div className="grid gap-2">
            {visibleAccounts.map((account) => {
              const selected = account.id === selectedKey;
              const usable =
                account.loginStatus === "online" &&
                account.riskStatus === "normal";
              return (
                <button
                  key={account.id}
                  type="button"
                  disabled={!usable}
                  onClick={() => setSelectedKey(account.id)}
                  className="flex items-center gap-3 rounded-[var(--kaypal-v3-radius-sm)] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: selected
                      ? "var(--kaypal-v3-primary)"
                      : "var(--kaypal-v3-border)",
                    background: selected
                      ? "var(--kaypal-v3-primary-soft)"
                      : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: usable
                        ? "var(--kaypal-v3-success)"
                        : "var(--kaypal-v3-danger)",
                      flexShrink: 0,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {account.accountName || `${account.platform} ${account.accountId}`}
                    </span>
                    <span className="block text-xs text-[var(--kaypal-v3-muted)]">
                      {account.platform} · 登录 {account.loginStatus} · 风险{" "}
                      {account.riskStatus}
                      {!usable ? "（不可用，请先处理账号状态）" : ""}
                    </span>
                  </span>
                  {selected && (
                    <span style={{ color: "var(--kaypal-v3-primary)" }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </V2Section>

      {/* 第 2 步：关键词 */}
      <V2Section title="第 3 步：他们会搜/聊什么词？">
        <V2Field
          label="关键词"
          required
          hint="你的客户会关注的话题词，逗号分隔。系统会去找聊这些词的人"
        >
          <V2Textarea
            placeholder="例如：空气净化器, 除甲醛, 新房装修"
            value={form.keywords}
            onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
          />
        </V2Field>
        {keywords.length > 0 && (
          <p className="mt-2 text-sm text-[var(--kaypal-v3-success)]">
            ✓ 将监控 {keywords.length} 个关键词：{keywords.join("、")}
          </p>
        )}
      </V2Section>

      {/* 第 3 步：说什么 */}
      <V2Section title="第 4 步：找到后说什么？（策略和话术）" description="已帮你写好一版，改成你的风格">
        <div className="grid gap-5">
          <V2Field label="评论话术" hint="在对方内容下的第一条评论">
            <V2Textarea
              value={form.commentTemplate}
              onChange={(e) =>
                setForm((p) => ({ ...p, commentTemplate: e.target.value }))
              }
            />
          </V2Field>
          <V2Field label="私信话术" hint="对方回复后的私信">
            <V2Textarea
              value={form.privateTemplate}
              onChange={(e) =>
                setForm((p) => ({ ...p, privateTemplate: e.target.value }))
              }
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 高级设置 */}
      <V2Section>
        <V2Disclosure>
          <div className="grid gap-5">
            <V2Field label="每天最多触达" hint="建议 10-30，太多容易被平台限制">
              <V2Input
                type="number"
                min={1}
                max={100}
                value={form.dailyLimit}
                onChange={(e) =>
                  setForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))
                }
              />
            </V2Field>
            <V2Field label="排除关键词" hint="含这些词的人不触达，逗号分隔">
              <V2Input
                placeholder="例如：同行, 广告"
                value={form.excludeKeywords}
                onChange={(e) =>
                  setForm((p) => ({ ...p, excludeKeywords: e.target.value }))
                }
              />
            </V2Field>
            <V2Field label="昵称黑名单" hint="命中这些昵称的人跳过不碰，逗号分隔">
              <V2Input
                placeholder="例如：某某官方旗舰店"
                value={form.blacklistNicknames}
                onChange={(e) =>
                  setForm((p) => ({ ...p, blacklistNicknames: e.target.value }))
                }
              />
            </V2Field>
            <V2Field label="同一个人最多触达几次" hint="防骚扰，建议 1-3 次">
              <V2Input
                type="number"
                min={1}
                max={10}
                value={form.perTargetLimit}
                onChange={(e) =>
                  setForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))
                }
              />
            </V2Field>
            <V2Field label="定时启动" hint="开启后每天在固定时间自动跑一轮">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                  checked={form.scheduleEnabled}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))
                  }
                />
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">每天</span>
                <V2Input
                  type="time"
                  value={form.beginTime}
                  disabled={!form.scheduleEnabled}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, beginTime: e.target.value }))
                  }
                />
                <span className="text-sm text-[var(--kaypal-v3-muted)]">自动执行</span>
              </div>
            </V2Field>
            <V2Field label="发送方式">
              <div className="grid gap-2">
                {[
                  { value: "confirm-first" as const, label: "每条都先给我确认（推荐）" },
                  { value: "draft-only" as const, label: "只存草稿，我自己发" },
                  { value: "auto" as const, label: "自动发送（高风险）" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="riskMode"
                      className="h-4 w-4"
                      checked={form.riskMode === opt.value}
                      onChange={() => setForm((p) => ({ ...p, riskMode: opt.value }))}
                    />
                    <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </V2Field>
          </div>
        </V2Disclosure>
      </V2Section>

      {/* T4-2 AI 执行计划预览：开工前亮出 AI 将做的 5 件事 */}
      <section className="kaypal-v3-panel p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            AI 执行计划（创建后将自动按此运行）
          </h3>
        </div>
        <ol className="mt-3 space-y-2">
          {[
            {
              n: "扫描",
              desc: `在「${
                PLATFORM_OPTIONS.find((p) => p.value === form.platform)?.label ||
                form.platform
              }」上按关键词「${
                keywords.length ? keywords.join("、") : "待填写"
              }」扫描最近 7 天的公开内容`,
            },
            {
              n: "筛选",
              desc: "用 AI 逐条识别真正有需求意向的内容，排除广告、无关与重复，避免浪费触达额度",
            },
            {
              n: "评分",
              desc: "按意向度打分排序（参考你历史标记的线索校准），选出每天最多 " +
                form.dailyLimit +
                " 条",
            },
            {
              n: "触达",
              desc:
                form.riskMode === "auto"
                  ? "按你的话术自动发送评论/私信（高风险：不经确认直接发）"
                  : form.riskMode === "draft-only"
                    ? "只把话术存成草稿，由你手动发送"
                    : "每条先给你确认，你点头后 AI 才发送（推荐）",
            },
            {
              n: "沉淀",
              desc: "把有回复的线索沉淀进线索池与 CRM，并在增长复盘中标记归因，让你看到哪条打法有效",
            },
          ].map((step, i) => (
            <li key={step.n} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)] text-11 font-bold text-[var(--kaypal-v3-accent-ink)]"
              >
                {i + 1}
              </span>
              <div className="text-sm">
                <span className="font-semibold text-[var(--kaypal-v3-ink)]">
                  {step.n}
                </span>
                <span className="ml-2 text-[var(--kaypal-v3-soft-ink)]">
                  {step.desc}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* T06：预检结果 / 执行（创建成功后显示；allowed=false 禁用执行） */}
      {createdConfigId && (
        <section className="kaypal-v3-panel p-6">
          <div className="flex items-center gap-2">
            {preflight?.allowed ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
            ) : (
              <XCircle className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
            )}
            <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
              任务预检
            </h3>
            {preflightLoading && (
              <span className="text-xs text-[var(--kaypal-v3-muted)]">检查中…</span>
            )}
          </div>

          {preflight && (
            <>
              <p className="mt-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
                {preflight.summary}
              </p>

              {preflight.checks.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {preflight.checks.map((check) => (
                    <li key={check} className="flex items-start gap-2 text-sm text-[var(--kaypal-v3-ink)]">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]" />
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              )}

              {preflight.warnings.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {preflight.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2 text-sm text-[var(--kaypal-v3-warning-ink)]">
                      <span className="mt-0.5 text-[var(--kaypal-v3-warning)]">⚠</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              )}

              {preflight.blockers.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {preflight.blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-2 text-sm text-[var(--kaypal-v3-danger)]">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{blocker}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!preflight.allowed && (
                <p className="mt-3 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
                  任务已保存为草稿，但预检未通过，暂不能自动执行。请先处理上方列出的问题项，或稍后在「获客任务」页手动执行。
                </p>
              )}
            </>
          )}

          <div className="mt-4 flex items-center gap-3">
            {preflight?.allowed && (
              <V2PrimaryButton
                icon={PlayCircle}
                loading={executing}
                onClick={() => void handleExecute()}
              >
                {executing ? "正在执行…" : "预检通过，立即执行"}
              </V2PrimaryButton>
            )}
            <V2GhostButton icon={Save} onClick={() => router.push("/growth/acquisition")}>
              保存草稿并返回
            </V2GhostButton>
          </div>
        </section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/growth/acquisition")}>
          返回
        </V2GhostButton>
        {!createdConfigId && (
          <V2PrimaryButton
            icon={Save}
            loading={saving}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {saving ? "正在创建..." : "创建获客任务"}
          </V2PrimaryButton>
        )}
      </section>
    </div>
  );
}
