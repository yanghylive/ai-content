"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  History,
  Pause,
  Pencil,
  Play,
  Rocket,
  Save,
  Target,
  Trash2,
  UserRoundPlus,
  XCircle,
} from "@/components/iconpark";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Textarea,
  V2Select,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import { V2BackButton } from "@/components/v2/v2-back-button";
import {
  growthApi,
  type GrowthAcquisitionConfig,
  type GrowthAcquisitionRun,
  type GrowthRiskMode,
  type GrowthRunLiveEvent,
} from "@/lib/api/growth";
import { buildRiskConfirmation } from "@/lib/api/auto-upload";
import { api, ApiError } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import { runFailureLabel } from "@/lib/growth-failure";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信",
  "wechat-channel": "视频号",
  wecom: "企业微信",
  kuaishou: "快手",
  gongzhonghao: "公众号",
};

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" }> = {
  // 语义修正(2026-09-04):enabled=已开启调度(待机),不是引擎正在跑;
  // 真正的「执行中」由下方 liveRunning 分支显示(amber 呼吸灯)。
  enabled: { label: "已启用", tone: "muted" },
  disabled: { label: "已停用", tone: "muted" },
  running: { label: "执行中", tone: "warning" },
};

const RISK_MODE_LABELS: Record<string, string> = {
  "confirm-first": "逐条确认",
  "draft-only": "只存草稿",
  auto: "自动发送",
};

function pad2(n: number) {
  return n < 10 ? "0" + n : String(n);
}

function fmtRunClock(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const delta = Date.now() - d.getTime();
  if (delta >= 0 && delta < 60_000) return "刚刚";
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? "今天 " + hh + ":" + mm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
}

function fmtRunDuration(startIso?: string, endIso?: string): string | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  const rest = sec % 60;
  return m + "分" + (rest > 0 ? rest + "s" : "");
}

const GROWTH_LIVE_CSS = `
@keyframes growthlive-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.growthlive-row { animation: growthlive-in 0.22s ease-out; }
@keyframes growthlive-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.growthlive-live-dot { animation: growthlive-pulse 1.4s ease-in-out infinite; }
@keyframes growthlive-scanmove { from { transform: translateX(-110%); } to { transform: translateX(110%); } }
.growthlive-scanline { background: linear-gradient(90deg, transparent, rgba(240, 180, 41, 0.9), transparent); animation: growthlive-scanmove 2.4s linear infinite; }
@keyframes growthlive-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.growthlive-shimmer-line { height: 12px; border-radius: 4px; background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.05) 75%); background-size: 200% 100%; animation: growthlive-shimmer 1.4s linear infinite; }
/* tooltip: portal 渲染到 body 顶层, fixed 定位, 不被卡片 overflow-hidden 裁剪 */
.growth-tip-wrap { position: relative; display: inline-flex; }
@keyframes growth-tip-in { from { opacity: 0; transform: translateX(-50%) translateY(-4px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
@keyframes growth-tip-in-up { from { opacity: 0; transform: translateX(-50%) translateY(calc(-100% + 4px)); } to { opacity: 1; transform: translateX(-50%) translateY(-100%); } }
.growth-tip-pop { position: fixed; z-index: 9999; transform: translateX(-50%); white-space: nowrap; pointer-events: none; border-radius: 8px; background: color-mix(in srgb, var(--kaypal-v3-ink) 92%, transparent); color: var(--kaypal-v3-paper); padding: 5px 9px; font-size: 12px; font-weight: 500; letter-spacing: .01em; box-shadow: 0 6px 18px rgba(10,15,25,.28); border: 1px solid rgba(255,255,255,.08); animation: growth-tip-in .16s ease-out; }
.growth-tip-pop::before { content: ""; position: absolute; left: 50%; top: -4px; transform: translateX(-50%) rotate(45deg); width: 7px; height: 7px; background: inherit; border-left: 1px solid rgba(255,255,255,.08); border-top: 1px solid rgba(255,255,255,.08); }
.growth-tip-pop.is-up { animation-name: growth-tip-in-up; transform: translateX(-50%) translateY(-100%); }
.growth-tip-pop.is-up::before { top: auto; bottom: -4px; border-left: 0; border-top: 0; border-right: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); }
.growth-tip-sub { display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-weight: 400; opacity: .72; }
`;

const RISK_OPTIONS = [
  { value: "confirm-first", label: "每条先给我确认（推荐）" },
  { value: "draft-only", label: "只存草稿，我自己发" },
  { value: "auto", label: "自动发送（高风险）" },
] as const;

// tooltip 弹层: portal 到 body 顶层渲染, 贴近视口边缘时自动往回收
function GrowthTipBubble({
  place,
  children,
}: {
  place: { top: number; left: number; up: boolean };
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [nudge, setNudge] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (r.right > window.innerWidth - margin) shift = window.innerWidth - margin - r.right;
    if (r.left + shift < margin) shift = margin - r.left;
    setNudge((prev) => (Math.abs(prev - shift) > 0.5 ? shift : prev));
  }, [place]);

  return createPortal(
    <span
      ref={ref}
      role="tooltip"
      className={"growth-tip-pop" + (place.up ? " is-up" : "")}
      style={{ top: place.top, left: place.left + nudge }}
    >
      {children}
    </span>,
    document.body,
  );
}

// 图标按钮 tooltip: 包裹层监听 hover/focus; 禁用按钮配合 pointer-events-none 也能触发。
// 原 title 属性保留作无障碍兜底。
function GrowthTip({
  label,
  sub,
  wrapClassName,
  children,
}: {
  label: string;
  sub?: string;
  wrapClassName?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null);

  const show = useCallback(() => {
    const el = wrapRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    // 下方空间不足且上方放得下时, 翻转到按钮上方
    const up = r.bottom + 72 > window.innerHeight && r.top > 72;
    setPlace({ top: up ? r.top - 9 : r.bottom + 9, left: r.left + r.width / 2, up });
  }, []);
  const hide = useCallback(() => setPlace(null), []);

  // 滚动 / 窗口尺寸变化时收起, 避免浮层停在过期位置
  useEffect(() => {
    if (!place) return;
    const hideNow = () => setPlace(null);
    window.addEventListener("scroll", hideNow, true);
    window.addEventListener("resize", hideNow);
    return () => {
      window.removeEventListener("scroll", hideNow, true);
      window.removeEventListener("resize", hideNow);
    };
  }, [place]);

  return (
    <span
      ref={wrapRef}
      className={"growth-tip-wrap" + (wrapClassName ? " " + wrapClassName : "")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {place ? (
        <GrowthTipBubble place={place}>
          {label}
          {sub ? <span className="growth-tip-sub">{sub}</span> : null}
        </GrowthTipBubble>
      ) : null}
    </span>
  );
}

export function GrowthAcquisitionTasks() {
  const router = useRouter();
  const [configs, setConfigs] = useState<GrowthAcquisitionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [editForm, setEditForm] = useState({
    taskName: "",
    sourceInputs: "",
    excludeKeywords: "",
    blacklistNicknames: "",
    commentTemplates: "",
    privateMessageTemplates: "",
    dailyLimit: 20,
    perTargetLimit: 3,
    scheduleEnabled: false,
    beginTime: "09:00",
    deduplicate: true,
    riskMode: "confirm-first" as GrowthRiskMode,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 执行确认
  const [executeTarget, setExecuteTarget] = useState<GrowthAcquisitionConfig | null>(null);
  const [executing, setExecuting] = useState(false);

  // 执行记录展开
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<GrowthAcquisitionRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const fetchConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listConfigs();
      setConfigs(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载获客任务失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  // ===== 2026-09-04 实时遥测:「正在干什么」面板(需在 fetchConfigs 之后定义) =====
  type LivePanel = {
    events: GrowthRunLiveEvent[];
    after: number;
    done: boolean;
    running: boolean;
    startedAt: number;
  };
  const [pinnedLive, setPinnedLive] = useState<string | null>(null);
  const [livePanels, setLivePanels] = useState<Record<string, LivePanel>>({});
  const liveBoxRef = useRef<HTMLDivElement | null>(null);
  // 执行收口后自增,驱动历史执行记录重新拉取
  const [runsEpoch, setRunsEpoch] = useState(0);

  const ensureLivePanel = useCallback((configId: string) => {
    setLivePanels((prev) =>
      prev[configId]
        ? prev
        : {
            ...prev,
            [configId]: {
              events: [],
              after: 0,
              done: false,
              running: true,
              startedAt: Date.now(),
            },
          },
    );
  }, []);

  // 本地补一条事件(同文本去重),保证面板不会长时间空白
  const pushLiveEvent = useCallback(
    (configId: string, level: GrowthRunLiveEvent["level"], text: string) => {
      const cut = text.length > 220 ? text.slice(0, 220) + "…" : text;
      setLivePanels((prev) => {
        const cur: LivePanel =
          prev[configId] ??
          { events: [], after: 0, done: false, running: true, startedAt: Date.now() };
        if (cur.events.some((e) => e.text === cut)) return prev;
        return {
          ...prev,
          [configId]: {
            ...cur,
            events: [...cur.events, { t: new Date().toISOString(), level, text: cut }],
          },
        };
      });
    },
    [],
  );

  // 用 execute 接口返回的 run 兜底:点了执行一定有结果摘要
  const sealLivePanel = useCallback(
    (configId: string, run?: GrowthAcquisitionRun | null) => {
      if (run) {
        const zh: Record<string, string> = {
          success: "完成",
          failed: "失败",
          partial: "部分完成",
          skipped: "已跳过",
        };
        const tail = run.message
          ? run.message
          : "候选 " + (run.candidateCount ?? 0) + " / 触达 " + (run.contactedCount ?? 0);
        pushLiveEvent(
          configId,
          run.status === "failed" ? "err" : run.status === "success" ? "ok" : "warn",
          "本次执行" + (zh[run.status] ?? run.status) + "：" + tail,
        );
      }
      setRunsEpoch((n) => n + 1);
      void fetchConfigs();
    },
    [pushLiveEvent, fetchConfigs],
  );

  // 手动确认执行后立即进入 live 状态(不等 execute 响应)
  const armLiveFor = useCallback(
    (configId: string) => {
      ensureLivePanel(configId);
      setPinnedLive(configId);
      setRunsFor(configId);
    },
    [ensureLivePanel, setPinnedLive, setRunsFor],
  );

  const pollLive = useCallback(
    async (configId: string) => {
      const panel = livePanels[configId];
      if (!panel || panel.done) return;
      try {
        const res = await growthApi.fetchRunLive(configId, panel.after);
        setLivePanels((prev) => {
          const cur = prev[configId];
          if (!cur || cur.done) return prev;
          return {
            ...prev,
            [configId]: {
              ...cur,
              events: [...cur.events, ...res.events],
              after: res.after,
              done: res.done,
              running: res.running,
            },
          };
        });
        if (res.done) {
          // 收口:拉最新 run 列表,展示最终记录
          setRunsEpoch((n) => n + 1);
          void fetchConfigs();
        }
      } catch (err) {
        // 404 = 该任务当前没有执行会话(秒级跳过 / 超出保留窗)
        if (err instanceof ApiError && err.status === 404) {
          setLivePanels((prev) => {
            const cur = prev[configId];
            if (!cur || cur.done) return prev;
            // 宽限期:面板刚建、后端 beginLive 可能还没落,先别收,继续轮询
            // 注意必须返回新对象引用,否则 React 不重渲染 -> 轮询永久停摆
            if (cur.events.length === 0 && Date.now() - cur.startedAt < 12_000) {
              return { ...prev, [configId]: { ...cur } };
            }
            return { ...prev, [configId]: { ...cur, done: true, running: false } };
          });
          setRunsEpoch((n) => n + 1);
          void fetchConfigs();
        }
      }
    },
    [livePanels, fetchConfigs],
  );

  // 轮询调度:对所有 running&&!done 的面板每 1.5s 拉一次增量
  useEffect(() => {
    const ids = Object.entries(livePanels)
      .filter(([, p]) => !p.done && p.running)
      .map(([id]) => id);
    if (ids.length === 0) return;
    const timers = ids.map((id) => setTimeout(() => void pollLive(id), 900));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [livePanels, pollLive]);

  // 新事件自动滚到底部
  useEffect(() => {
    const box = liveBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [livePanels]);

  // 列表带 live(调度/后台执行中)→ 自动展开该卡遥测面板
  useEffect(() => {
    for (const c of configs) {
      if (c.live?.running) {
        ensureLivePanel(c.id);
        if (runsFor !== c.id) setRunsFor(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs]);

  const handleToggle = async (config: GrowthAcquisitionConfig) => {
    setActingId(config.id);
    setError(null);
    try {
      const nextEnabled = config.status !== "enabled";
      await growthApi.setConfigStatus(config.id, nextEnabled);
      await fetchConfigs();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  /* 编辑 */
  const openEdit = (config: GrowthAcquisitionConfig) => {
    setEditTarget(config);
    setEditForm({
      taskName: config.taskName,
      sourceInputs: (config.sourceInputs || []).join("\n"),
      excludeKeywords: (config.excludeKeywords || []).join("\n"),
      blacklistNicknames: (config.blacklistNicknames || []).join("\n"),
      commentTemplates: (config.commentTemplates || []).join("\n"),
      privateMessageTemplates: (config.privateMessageTemplates || []).join("\n"),
      dailyLimit: config.dailyLimit || 20,
      perTargetLimit: config.perTargetLimit || 3,
      scheduleEnabled: Boolean(config.scheduleEnabled),
      beginTime: config.beginTime || "09:00",
      deduplicate: config.deduplicate !== false,
      riskMode: config.riskMode || "confirm-first",
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setError(null);
    try {
      const toList = (text: string) =>
        text
          .split(/\n|,|，/)
          .map((k) => k.trim())
          .filter(Boolean);
      await growthApi.updateConfig(editTarget.id, {
        taskName: editForm.taskName.trim(),
        sourceInputs: toList(editForm.sourceInputs),
        excludeKeywords: toList(editForm.excludeKeywords),
        blacklistNicknames: toList(editForm.blacklistNicknames),
        commentTemplates: toList(editForm.commentTemplates),
        privateMessageTemplates: toList(editForm.privateMessageTemplates),
        dailyLimit: editForm.dailyLimit,
        perTargetLimit: editForm.perTargetLimit,
        scheduleEnabled: editForm.scheduleEnabled,
        beginTime: editForm.scheduleEnabled ? editForm.beginTime : "",
        deduplicate: editForm.deduplicate,
        riskMode: editForm.riskMode,
      });
      setEditTarget(null);
      flash("已保存修改");
      await fetchConfigs();
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setError(rawMessage || toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSavingEdit(false);
    }
  };

  /* 删除 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await growthApi.deleteConfig(deleteTarget.id);
      setDeleteTarget(null);
      flash("已删除");
      await fetchConfigs();
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  /* 立即执行（真实触达，要确认） */
  const handleExecute = async () => {
    if (!executeTarget) return;
    setExecuting(true);
    setError(null);
    try {
      // 先执行前检查（与旧版 preflight 确认链一致）
      const preflight = (await growthApi.preflightConfig(executeTarget.id)) as {
        allowed?: boolean;
        blockers?: Array<{ message?: string } | string>;
      };
      if (preflight.allowed === false) {
        const reasons = (preflight.blockers || [])
          .map((b) => (typeof b === "string" ? b : b.message || String(b)))
          .join("；");
        setError(`执行前检查未通过：${reasons || "请检查任务配置和账号状态"}`);
        setExecuteTarget(null);
        setExecuting(false);
        return;
      }
      // 高风险触达需要后端一次性确认编号：先创建确认单再执行
      const approval = (await api.post<{
        confirmationId: string;
        action?: string;
        riskLevel?: string;
        target?: string;
        expiresAt?: string;
      }>("/risk-policies/approvals", {
        action: "batch-touch",
        riskLevel: "high",
        target: `${executeTarget.taskName} · ${
          executeTarget.accountName || executeTarget.accountId
        } · ${executeTarget.id}`,
        reason: "执行增长获客任务会触发外部平台采集、评论或私信动作，系统将确认真实触达风险。",
      })) as { confirmationId: string };
      if (!approval?.confirmationId) {
        throw new Error("后端未返回确认编号，请稍后重试");
      }
      const execTargetId = executeTarget.id;
      armLiveFor(execTargetId);
      pushLiveEvent(execTargetId, "info", "已提交执行，正在启动引擎…");
      const res = await growthApi.executeConfig(
        execTargetId,
        buildRiskConfirmation("batch-touch", "high", approval.confirmationId),
      );
      setExecuteTarget(null);
      flash("执行已开始，正在滚动实时进度");
      sealLivePanel(execTargetId, res?.run);
    } catch (err: unknown) {
      const asApi = err instanceof ApiError ? err : null;
      if (asApi && (asApi.status >= 500 || asApi.code === "TIMEOUT")) {
        // 网关 5xx / 请求超时:任务其实已在后台跑,不打红条,以遥测面板为准
        setExecuteTarget(null);
        flash("引擎仍在后台执行，进度会继续实时更新");
      } else {
        const rawMessage = toActionableError(err, "");
        setError(rawMessage || toPublicError(err, "执行失败，请稍后重试"));
      }
    } finally {
      setExecuting(false);
    }
  };

  /* 执行记录:展开 / 收起 */
  const toggleRuns = (config: GrowthAcquisitionConfig) => {
    setRunsFor((prev) => (prev === config.id ? null : config.id));
  };

  // 展开、或执行收口(runsEpoch 变化)时统一加载,避免「有面板却显示无记录」
  useEffect(() => {
    if (!runsFor) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    setRunsLoading(true);
    growthApi
      .listRuns(runsFor)
      .then((data) => {
        if (!cancelled) setRuns(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runsFor, runsEpoch]);

  return (
    <div className="flex flex-col gap-6">
      <style>{GROWTH_LIVE_CSS}</style>
      <div className="kx-page-head">
        <div>
          <V2BackButton to="/today" label="返回今日增长" />
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">获客任务</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">自动帮你找客户的任务，随时启停和编辑</p>
        </div>
        <V2PrimaryButton
          icon={Target}
          onClick={() => router.push("/auto-acquisition/create")}
        >
          新建获客任务
        </V2PrimaryButton>
      </div>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : configs.length === 0 ? (
          <V2EmptyState
            icon={UserRoundPlus}
            title="还没有获客任务"
            description="创建一个获客任务，让系统自动帮你找客户"
            action={
              <V2PrimaryButton
                icon={Target}
                onClick={() => router.push("/auto-acquisition/create")}
              >
                新建获客任务
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
                        {configs.map((config) => {
              const status = STATUS_LABELS[config.status] || STATUS_LABELS.disabled;
              const runsOpen = runsFor === config.id;
              const livePanel = livePanels[config.id];
              const liveRunning = Boolean(
                (livePanel && livePanel.running && !livePanel.done) ||
                  config.live?.running ||
                  (pinnedLive === config.id && !livePanel?.done),
              );
              const panelEvents = livePanel?.events ?? [];
              // 实时日志与历史记录共存:结束后面板保留本次事件,下面接最近执行记录
              const showLivePanel =
                Boolean(livePanel) && (liveRunning || panelEvents.length > 0);
              const stageText = panelEvents.length
                ? panelEvents[panelEvents.length - 1].text
                : (config.live?.stage ?? "");
              const platformLabel = PLATFORM_LABELS[config.platform] || config.platform;
              const riskLabel = RISK_MODE_LABELS[config.riskMode] || config.riskMode;
              const keywords = (config.sourceInputs || []).slice(0, 3).join("、");
              const liveTone =
                (lvl: string) =>
                  lvl === "ok" ? "text-emerald-300"
                    : lvl === "warn" ? "text-amber-300"
                      : lvl === "err" ? "text-rose-300"
                        : "text-slate-300";
              const liveMark = (lvl: string) =>
                lvl === "ok" ? "✓" : lvl === "warn" ? "!" : lvl === "err" ? "✕" : "▸";
              const runChip = (st: string) => {
                if (st === "success") return <V2StatusChip tone="success">完成</V2StatusChip>;
                if (st === "failed") return <V2StatusChip tone="danger">失败</V2StatusChip>;
                if (st === "partial") return <V2StatusChip tone="warning">部分完成</V2StatusChip>;
                if (st === "skipped") return <V2StatusChip tone="muted">已跳过</V2StatusChip>;
                return <V2StatusChip tone="accent">{st}</V2StatusChip>;
              };
              const dotColor = (st: string) =>
                st === "success" ? "bg-[var(--kaypal-v3-success)]"
                  : st === "failed" ? "bg-[var(--kaypal-v3-danger)]"
                    : st === "partial" || st === "skipped" ? "bg-[var(--kaypal-v3-amber)]"
                      : "bg-[var(--kaypal-v3-accent)]";
              return (
                <div key={config.id} className="relative overflow-hidden">
                  {liveRunning && (
                    <span
                      aria-hidden="true"
                      className="growthlive-scanline pointer-events-none absolute inset-x-0 top-0 z-10 block h-[2px]"
                    />
                  )}
                  <div className="px-5 pb-3 pt-4 transition-colors hover:bg-[var(--kaypal-v3-paper-soft)]/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <h3 className="max-w-full truncate text-[15px] font-semibold text-[var(--kaypal-v3-ink)]">
                            {config.taskName}
                          </h3>
                          {liveRunning ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--kaypal-v3-amber)]">
                              <span aria-hidden="true" className="growthlive-live-dot h-1.5 w-1.5 rounded-full bg-current" />
                              执行中
                            </span>
                          ) : (
                            <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                          )}
                          <span className="inline-flex items-center rounded-full border border-[var(--kaypal-v3-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--kaypal-v3-muted)]">
                            {platformLabel} · {riskLabel}
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-[13px] text-[var(--kaypal-v3-muted)]">
                          {keywords ? <>关键词 {keywords}</> : null}
                          <span className="mx-1.5 opacity-40">|</span>
                          每日上限 {config.dailyLimit}
                          <span className="mx-1.5 opacity-40">|</span>
                          今日触达 {config.exposureCount ?? 0}
                        </p>
                        {liveRunning && stageText ? (
                          <p className="mt-1.5 flex items-center gap-1.5 overflow-hidden text-[12px] font-medium text-[var(--kaypal-v3-warning-ink)]">
                            <span aria-hidden="true" className="growthlive-live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                            <span className="truncate">{stageText}</span>
                          </p>
                        ) : config.status === "enabled" ? (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--kaypal-v3-muted)]">
                            <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-[var(--kaypal-v3-muted)]" />
                            已开启自动调度，空闲待命中 · 点 ⚡ 立即执行可实时查看采集过程
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        <GrowthTip label="执行记录" sub="查看每次执行的过程与结果">
                          <button
                            type="button"
                            title="查看每次执行的过程与结果"
                            className={"rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-muted)] hover:text-[var(--kaypal-v3-ink)]" + (runsOpen ? " bg-[var(--kaypal-v3-paper-muted)] text-[var(--kaypal-v3-ink)]" : "")}
                            onClick={() => void toggleRuns(config)}
                          >
                            {runsOpen ? <ChevronDown className="h-4 w-4" /> : <History className="h-4 w-4" />}
                          </button>
                        </GrowthTip>
                        <GrowthTip
                          label={liveRunning ? "正在执行中" : "立即执行"}
                          sub={liveRunning ? "引擎正在跑，执行完成后会自动出现在记录里" : "马上启动一次采集，实时看进度"}
                          wrapClassName={liveRunning ? "cursor-not-allowed" : undefined}
                        >
                          <button
                            type="button"
                            title={liveRunning ? "正在执行中" : "立即执行，马上开始找客户"}
                            disabled={liveRunning}
                            className={
                              "rounded-[var(--kaypal-v3-radius-sm)] p-2 transition disabled:cursor-not-allowed " +
                              (liveRunning
                                ? "pointer-events-none text-[var(--kaypal-v3-warning-ink)]"
                                : "text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]")
                            }
                            onClick={() => setExecuteTarget(config)}
                          >
                            <Rocket className={"h-4 w-4" + (liveRunning ? " growthlive-live-dot" : "")} />
                          </button>
                        </GrowthTip>
                        <GrowthTip label="编辑" sub="改关键词、话术与发送方式">
                          <button
                            type="button"
                            title="编辑关键词、话术与风控设置"
                            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-muted)] hover:text-[var(--kaypal-v3-ink)]"
                            onClick={() => openEdit(config)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </GrowthTip>
                        <GrowthTip label="删除" sub="删除后不再自动执行，历史记录保留">
                          <button
                            type="button"
                            title="删除这个任务，执行记录会保留"
                            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                            onClick={() => setDeleteTarget(config)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </GrowthTip>
                        <V2GhostButton
                          size="sm"
                          className="ml-1"
                          icon={config.status === "enabled" ? Pause : Play}
                          loading={actingId === config.id}
                          onClick={() => void handleToggle(config)}
                        >
                          {config.status === "enabled" ? "暂停" : "启用"}
                        </V2GhostButton>
                      </div>
                    </div>
                  </div>

                  {runsOpen && (
                    <div className="border-t border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-5 pb-4 pt-3">
                      {showLivePanel && (
                        <div className="relative mt-1 overflow-hidden rounded-xl border border-[var(--kaypal-v3-border)] bg-[#0c1322] shadow-inner">
                            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
                              <div className="flex items-center gap-2.5">
                                <span className="flex items-center gap-1" aria-hidden="true">
                                  <i className="h-2 w-2 rounded-full bg-rose-400/80" />
                                  <i className="h-2 w-2 rounded-full bg-amber-300/80" />
                                  <i className="h-2 w-2 rounded-full bg-emerald-400/80" />
                                </span>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  实时执行日志
                                </span>
                              </div>
                              <span
                                className={
                                  "flex items-center gap-1.5 text-[11px] font-medium " +
                                  (liveRunning ? "text-emerald-300" : "text-slate-400")
                                }
                              >
                                {liveRunning ? (
                                  <span
                                    aria-hidden="true"
                                    className="growthlive-live-dot h-1.5 w-1.5 rounded-full bg-emerald-400"
                                  />
                                ) : null}
                                {liveRunning ? "LIVE" : "本次执行已结束"}
                              </span>
                            </div>
                            <div ref={liveBoxRef} className="max-h-[300px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-6">
                              {panelEvents.length === 0 && liveRunning && (
                                <div className="space-y-2 py-1">
                                  <div className="growthlive-shimmer-line" />
                                  <div className="growthlive-shimmer-line w-3/5" />
                                </div>
                              )}
                              {panelEvents.map((ev, i) => (
                                <div key={i} className={"growthlive-row flex gap-2 " + liveTone(ev.level)}>
                                  <span className="shrink-0 opacity-70">{liveMark(ev.level)}</span>
                                  <span className="min-w-0 break-words">{ev.text}</span>
                                </div>
                              ))}
                              {liveRunning && panelEvents.length > 0 && (
                                <div className="flex items-center gap-2 pt-2 text-[12px] text-slate-400">
                                  <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
                                  引擎运行中…
                                </div>
                              )}
                            </div>
                          </div>
                      )}

                      <div
                        className={
                          showLivePanel
                            ? "mt-4 border-t border-dashed border-[var(--kaypal-v3-border)] pt-3"
                            : "mt-1"
                        }
                      >
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kaypal-v3-muted)]">
                          最近执行记录
                        </p>
                        {runsLoading ? (
                            <div className="py-2">
                              <SkeletonList rows={3} />
                            </div>
                          ) : runs.length === 0 ? (
                            <p className="py-2 text-sm text-[var(--kaypal-v3-muted)]">
                              还没有执行记录，点「立即执行」启动一次任务。
                            </p>
                          ) : (
                            <div className="mt-1">
                              {runs.slice(0, 10).map((run, idx) => {
                                const dur = fmtRunDuration(run.startedAt, run.endedAt);
                                return (
                                  <div key={run.id} className="relative flex gap-3 pb-4 pl-0.5 last:pb-0">
                                    <div className="relative flex w-3 shrink-0 flex-col items-center" aria-hidden="true">
                                      <span className={"mt-1 h-2 w-2 rounded-full ring-4 ring-[var(--kaypal-v3-paper-muted)] " + dotColor(run.status)} />
                                      {idx < Math.min(runs.length, 10) - 1 && (
                                        <span className="absolute bottom-0 top-4 w-px bg-[var(--kaypal-v3-border)]" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                        <span className="text-[13px] font-medium text-[var(--kaypal-v3-soft-ink)]">
                                          {fmtRunClock(run.startedAt)}
                                          {dur ? (
                                            <span className="ml-2 text-xs font-normal text-[var(--kaypal-v3-muted)]">
                                              用时 {dur}
                                            </span>
                                          ) : null}
                                        </span>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          {runChip(run.status)}
                                          {runFailureLabel(run.failureReason) && run.status !== "success" && (
                                            <span className="inline-flex items-center rounded-full border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-amber)]">
                                              {runFailureLabel(run.failureReason)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="mt-1.5 grid max-w-md grid-cols-3 gap-1.5">
                                        <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] text-[var(--kaypal-v3-muted)]">
                                          候选 <b className="text-[13px] text-[var(--kaypal-v3-ink)]">{run.candidateCount ?? "-"}</b>
                                        </span>
                                        <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] text-[var(--kaypal-v3-muted)]">
                                          触达 <b className="text-[13px] text-[var(--kaypal-v3-ink)]">{run.contactedCount ?? "-"}</b>
                                        </span>
                                        <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] text-[var(--kaypal-v3-muted)]">
                                          进 CRM <b className="text-[13px] text-[var(--kaypal-v3-ink)]">{run.crmCapturedCount ?? "-"}</b>
                                        </span>
                                      </div>
                                      {run.message && (
                                        <p className={
                                          "mt-1.5 text-xs leading-5 " +
                                          (run.status === "failed"
                                            ? "text-[var(--kaypal-v3-danger)]"
                                            : run.status === "partial" || run.status === "skipped"
                                              ? "text-[var(--kaypal-v3-soft-ink)]"
                                              : "text-[var(--kaypal-v3-muted)]")
                                        }>
                                          {run.message}
                                        </p>
                                      )}
                                      {run.fallback?.attempted && run.fallback.source === "legacy-adapter" && (
                                        <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                                          ⚠ RPA 执行失败（{run.fallback.reasonCode ?? "未知原因"}），已回退本地适配器
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      {/* 编辑弹窗 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">编辑获客任务</h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setEditTarget(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <V2Field label="任务名称" required>
                <V2Input
                  value={editForm.taskName}
                  onChange={(e) => setEditForm((p) => ({ ...p, taskName: e.target.value }))}
                />
              </V2Field>
              <V2Field label="关键词/来源" hint="一行一个">
                <V2Textarea
                  rows={3}
                  value={editForm.sourceInputs}
                  onChange={(e) => setEditForm((p) => ({ ...p, sourceInputs: e.target.value }))}
                />
              </V2Field>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="排除关键词" hint="含这些词的不触达">
                  <V2Textarea
                    rows={2}
                    value={editForm.excludeKeywords}
                    onChange={(e) => setEditForm((p) => ({ ...p, excludeKeywords: e.target.value }))}
                  />
                </V2Field>
                <V2Field label="昵称黑名单" hint="这些人跳过不碰">
                  <V2Textarea
                    rows={2}
                    value={editForm.blacklistNicknames}
                    onChange={(e) => setEditForm((p) => ({ ...p, blacklistNicknames: e.target.value }))}
                  />
                </V2Field>
              </div>
              <V2Field label="评论话术" hint="一行一条，随机选用">
                <V2Textarea
                  rows={3}
                  value={editForm.commentTemplates}
                  onChange={(e) => setEditForm((p) => ({ ...p, commentTemplates: e.target.value }))}
                />
              </V2Field>
              <V2Field label="私信话术" hint="一行一条">
                <V2Textarea
                  rows={3}
                  value={editForm.privateMessageTemplates}
                  onChange={(e) => setEditForm((p) => ({ ...p, privateMessageTemplates: e.target.value }))}
                />
              </V2Field>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="每日上限">
                  <V2Input
                    type="number"
                    min={1}
                    value={editForm.dailyLimit}
                    onChange={(e) => setEditForm((p) => ({ ...p, dailyLimit: Number(e.target.value) }))}
                  />
                </V2Field>
                <V2Field label="单人上限" hint="同一个人最多触达几次">
                  <V2Input
                    type="number"
                    min={1}
                    value={editForm.perTargetLimit}
                    onChange={(e) => setEditForm((p) => ({ ...p, perTargetLimit: Number(e.target.value) }))}
                  />
                </V2Field>
                <V2Field label="发送方式">
                  <V2Select
                    value={editForm.riskMode}
                    onChange={(e) => setEditForm((p) => ({ ...p, riskMode: e.target.value as GrowthRiskMode }))}
                  >
                    {RISK_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </V2Select>
                </V2Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <V2Field label="定时启动" hint="每天固定时间自动跑">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                      checked={editForm.scheduleEnabled}
                      onChange={(e) => setEditForm((p) => ({ ...p, scheduleEnabled: e.target.checked }))}
                    />
                    <V2Input
                      type="time"
                      value={editForm.beginTime}
                      disabled={!editForm.scheduleEnabled}
                      onChange={(e) => setEditForm((p) => ({ ...p, beginTime: e.target.value }))}
                    />
                  </div>
                </V2Field>
                <V2Field label="去重" hint="触达过的人不再重复触达">
                  <label className="flex h-9 items-center gap-2 text-sm text-[var(--kaypal-v3-soft-ink)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                      checked={editForm.deduplicate}
                      onChange={(e) => setEditForm((p) => ({ ...p, deduplicate: e.target.checked }))}
                    />
                    不重复触达同一个人
                  </label>
                </V2Field>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setEditTarget(null)}>取消</V2GhostButton>
              <V2PrimaryButton icon={Save} loading={savingEdit} onClick={handleSaveEdit}>
                {savingEdit ? "正在保存..." : "保存修改"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">删除获客任务？</h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              「{deleteTarget.taskName}」将被删除，执行记录保留。这个操作不能撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setDeleteTarget(null)}>取消</V2GhostButton>
              <V2DangerButton loading={deleting} onClick={handleDelete}>
                {deleting ? "正在删除..." : "确认删除"}
              </V2DangerButton>
            </div>
          </div>
        </div>
      )}

      {/* 立即执行确认弹窗 */}
      {executeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">立即执行获客任务？</h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              「{executeTarget.taskName}」会现在开始找客户并触达（每日上限 {executeTarget.dailyLimit} 人）。
              发送方式：{RISK_OPTIONS.find((r) => r.value === executeTarget.riskMode)?.label || executeTarget.riskMode}。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <V2GhostButton onClick={() => setExecuteTarget(null)}>取消</V2GhostButton>
              <V2PrimaryButton icon={Rocket} loading={executing} onClick={handleExecute}>
                {executing ? "正在启动..." : "确认执行"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
