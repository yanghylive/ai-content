"use client";

import { SkeletonList, SkeletonRow } from "@/components/skeleton";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";

import { BrandLogo } from "@/components/brand-logo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  XCircle,
} from "@/components/iconpark";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2DangerButton,
  V2EmptyState,
  V2Input,
  V2Select,
} from "@/components/v2/ui-kit";
import {
  buildMaterialRiskConfirmation,
  materialsApi,
  type Material,
  type MaterialCollectStatus,
} from "@/lib/api/materials";
import { redfoxApi } from "@/lib/api/redfox";
import { generateImage as dashGenerateImage, generateVideo as dashGenerateVideo, generateSpeech as dashGenerateSpeech, quoteImageCost, quoteVideoCost } from "@/lib/api/dashscope";
import { videoWorkshopApi } from "@/lib/api/video-workshop";
import { savingsApi } from "@/lib/api/savings";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useBodyLock } from "@/lib/hooks/use-body-lock";
import { toActionableError } from "@/lib/public-error";

const STATUS_LABELS: Record<Material["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  unmined: { label: "待挖掘", tone: "warning" },
  mined: { label: "已挖掘", tone: "success" },
  failed: { label: "采集失败", tone: "danger" },
};

/** 从用户粘贴的整段分享文案里提取第一个 http(s) 链接（抖音/小红书分享常带文字+链接） */
function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>，。！？【】（）()]+/i);
  return match ? match[0].replace(/[，。！？【】（）()]+$/, "") : "";
}

const PLATFORM_NAMES: Record<string, string> = {
  "36Kr": "36氪",
  Juejin: "掘金",
  Zhihu: "知乎",
  WeChat: "公众号",
  Tophub: "今日热榜",
  redfox: "外部数据",
  RedFox: "外部数据",
};

export function MaterialsCenter() {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(1);
  const MATERIALS_PAGE_SIZE = 100;
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 筛选
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  // 采集
  const [collectStatus, setCollectStatus] = useState<MaterialCollectStatus | null>(null);
  const [collecting, setCollecting] = useState(false);
  const collectJobIdsRef = useRef<string[]>([]);

  // 删除
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 无采集来源引导
  const [noSources, setNoSources] = useState(false);
  // 多选（批量删除用）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 详情弹窗
  const [viewing, setViewing] = useState<Material | null>(null);
  // RedFox 采集/生图（A4/A5）
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkPlatform, setLinkPlatform] = useState("auto");
  // downloadPlatforms：采集平台列表（列表渲染仍用；加载入口已移除）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [downloadPlatforms, setDownloadPlatforms] = useState<
    { key: string; label: string }[]
  >([]);
  const [genSheetOpen, setGenSheetOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [genSize, setGenSize] = useState("1024*1024");
  const [genPayByRebate, setGenPayByRebate] = useState(false);
  const [genPayInfo, setGenPayInfo] = useState<{ price: number; rebateBalance: number; canCover: boolean } | null>(null);
  const [videoSheetOpen, setVideoSheetOpen] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoStatus, setVideoStatus] = useState("");
  const [videoPayByRebate, setVideoPayByRebate] = useState(false);
  const [videoPayInfo, setVideoPayInfo] = useState<{ price: number; rebateBalance: number; canCover: boolean } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  // AI 配音（P4）
  const [ttsSheetOpen, setTtsSheetOpen] = useState(false);
  const [ttsText, setTtsText] = useState("");
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsResult, setTtsResult] = useState<{ audioUrl: string; filename: string } | null>(null);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);

  // 本地上传（上传素材口）：从本地选择文件上传到发布素材库
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await videoWorkshopApi.uploadMaterialFile(formData);
      flash(`✅ 已上传：${file.name}，已存入发布素材库`);
      await fetchMaterials(1);
    } catch (err: unknown) {
      setError(toPublicError(err, "上传失败"));
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const fetchMaterials = useCallback(async (nextPage = 1) => {
    try {
      const data = await materialsApi.list({
        page: nextPage,
        limit: MATERIALS_PAGE_SIZE,
        sortBy: "collectDate",
        sortOrder: "desc",
      });
      const payload = data as unknown as { items?: Material[]; total?: number };
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(data)
          ? data
          : [];
      setMaterialsTotal(payload?.total ?? items.length);
      setMaterialsPage(nextPage);
      setMaterials((prev) => (nextPage === 1 ? items : [...prev, ...items]));
      clearLoadError();
    } catch (err: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(err, "加载素材失败"));
      reportLoadError(err, "素材列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  const loadMoreMaterials = () => {
    void fetchMaterials(materialsPage + 1);
  };

  const fetchCollectStatus = useCallback(async (silent = false) => {
    try {
      const status = await materialsApi.collectStatus(collectJobIdsRef.current);
      setCollectStatus(status);
      return status;
    } catch (err: unknown) {
      // 2026-09-01 审计修复：非 silent 场景不再只 console，状态读取失败上屏
      if (!silent) {
        console.error(toPublicError(err, "采集状态读取失败"));
        reportLoadError(err, "采集任务状态暂时无法读取，进度可能不准确");
      }
      return null;
    }
  }, [reportLoadError]);

  useEffect(() => {
    void fetchMaterials();
    void fetchCollectStatus(true);
  }, [fetchMaterials, fetchCollectStatus]);

  /* 弹层直达：/materials?open=gen|video 自动弹对应弹层；
     ?open=download 已拆分为独立页 /video-download（2026-08-20 起），命中后跳转
     （同时清参，避免刷新反复跳转）。注意：打开弹层时只 setState 不改 URL——
     同步清参会触发 Next 路由系统重评估 searchParams，导致刚 set 的弹层状态
     被丢弃（真机验证发现弹层从未渲染）。参数在弹层关闭时清理（见 clearOpenParam），
     避免刷新重复弹。 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    if (open === "download") {
      // 视频去水印已独立成 /video-download：直接跳转并清参
      params.delete("open");
      const next = params.toString();
      router.replace(
        "/video-download" + (next ? `?${next}` : ""),
      );
    } else if (open === "gen") setGenSheetOpen(true);
    else if (open === "video") setVideoSheetOpen(true);
  }, [router]);

  /* 清理 ?open= 参数（弹层关闭时调用，刷新不重复弹） */
  const clearOpenParam = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("open")) {
      params.delete("open");
      const next = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (next ? `?${next}` : ""),
      );
    }
  };

  /* 关闭去水印层：关层 + 清理 ?open=download */
  const closeLinkSheet = () => {
    setLinkSheetOpen(false);
    clearOpenParam();
  };

  /* 采集活跃时 3 秒轮询（与旧版一致） */
  useEffect(() => {
    if (!collectStatus?.active) return;
    const timer = setInterval(async () => {
      const status = await fetchCollectStatus(true);
      if (status && !status.active) {
        void fetchMaterials();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [collectStatus?.active, fetchCollectStatus, fetchMaterials]);

  const refreshMaterials = async () => {
    await fetchMaterials(1);
  };

  /** A4：从分享链接去水印采集（RedFox → 发布素材库，支持多平台） */
  const handleLinkCollect = async () => {
    if (!linkInput.trim() || linkBusy) return;
    const url = extractFirstUrl(linkInput);
    if (!url) {
      setCollectMsg("❌ 未识别到作品链接，请粘贴包含 http(s) 链接的分享内容");
      return;
    }
    setLinkBusy(true);
    setCollectMsg(null);
    try {
      if (linkPlatform === "auto") {
        // 自动：走通用 parse 解析（抖音/小红书等主平台）
        const result = await redfoxApi.collectFromLink({ url });
        setCollectMsg(`✅ 已采集：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB）· 已存入发布素材库，可去「发布」选用`);
      } else {
        // 指定平台：走专用去水印端点（快手/X/Instagram/YouTube 等）
        const result = await redfoxApi.platformDownload({
          platform: linkPlatform,
          url,
        });
        const data = result.data as Record<string, unknown>;
        const filename =
          (data?.filename as string) ||
          (data?.fileName as string) ||
          (data?.title as string) ||
          "素材";
        const size = Number(data?.size ?? data?.sizeBytes ?? 0);
        setCollectMsg(
          `✅ ${result.platformLabel}已解析：${filename}${size ? `（${(size / 1048576).toFixed(1)}MB）` : "，详情见返回"}· 已存入发布素材库`,
        );
      }
      setLinkInput("");
      await refreshMaterials();
    } catch (e) {
      console.error(toActionableError(e, "采集失败"));
      setCollectMsg("采集失败，请稍后重试");
    } finally {
      setLinkBusy(false);
    }
  };

  /** A5：AI 生图（RedFox image2-GPT → 素材库；可选返利直付 1:1 抵扣） */
  const handleGenImage = async () => {
    if (!genPrompt.trim() || genBusy) return;
    setGenBusy(true);
    setCollectMsg(null);
    let paidMsg = "";
    let costMsg = "";
    try {
      // 成本预估（报告 16.3 第 11 项）：生成前展示积分 + 人民币，预估失败静默
      const quote = await quoteImageCost({ count: 1 });
      if (quote && quote.amount > 0) {
        costMsg = `（预估 ${quote.amount} 积分${quote.estimatedCostCny > 0 ? ` ≈ ¥${quote.estimatedCostCny.toFixed(2)}` : ""}）`;
      }
      if (genPayByRebate) {
        // 返利直付：扣返利拿凭证（幂等）→ 再生成
        const info = await savingsApi.payCheck("image_generation");
        setGenPayInfo(info);
        if (!info.canCover) {
          setCollectMsg(`❌ 返利余额不足（¥${info.rebateBalance.toFixed(2)}，生图需 ¥${info.price}）——先去「省钱返利」赚返利`);
          return;
        }
        const bizNo = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await savingsApi.payRebate({
          amount: info.price,
          bizNo,
          feature: "image_generation",
          idempotencyKey: bizNo,
        });
        paidMsg = `（已用返利 ¥${info.price} 抵扣）`;
      }
      const result = await dashGenerateImage({ prompt: genPrompt.trim(), size: genSize });
      setCollectMsg(`✅ 已生成：${result.filename}${costMsg}${paidMsg}`);
      setGenPrompt("");
      await refreshMaterials();
    } catch (e) {
      console.error(toActionableError(e, "生图失败"));
      setCollectMsg("生图失败，请稍后重试");
    } finally {
      setGenBusy(false);
    }
  };

  /** Seedance 生视频（可选返利直付 ¥5/次，异步轮询） */
  const handleGenVideo = async () => {
    if (!videoPrompt.trim() || videoBusy) return;
    setVideoBusy(true);
    setVideoStatus("准备中…");
    setCollectMsg(null);
    let costMsg = "";
    try {
      // 成本预估（报告 16.3 第 11 项）：生成前展示积分 + 人民币，预估失败静默
      const quote = await quoteVideoCost({ durationSeconds: videoDuration });
      if (quote && quote.amount > 0) {
        costMsg = `（预估 ${quote.amount} 积分${quote.estimatedCostCny > 0 ? ` ≈ ¥${quote.estimatedCostCny.toFixed(2)}` : ""}）`;
      }
      if (videoPayByRebate) {
        const info = await savingsApi.payCheck("video_generation");
        setVideoPayInfo(info);
        if (!info.canCover) {
          setVideoStatus("");
          setCollectMsg(`❌ 返利余额不足（¥${info.rebateBalance.toFixed(2)}，生视频需 ¥${info.price}）——先去「省钱返利」赚返利`);
          return;
        }
        const bizNo = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await savingsApi.payRebate({
          amount: info.price,
          bizNo,
          feature: "video_generation",
          idempotencyKey: bizNo,
        });
        setCollectMsg(`已用返利 ¥${info.price} 抵扣，提交中…`);
      }
      // 百炼直连文生视频（同步等待，约 1-5 分钟）
      setVideoStatus("生成中（约 1-5 分钟，请稍候）…");
      const result = await dashGenerateVideo({ prompt: videoPrompt.trim(), duration: videoDuration });
      setVideoStatus(`✅ 已生成：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB），已存入素材库${costMsg}`);
      setVideoPrompt("");
      setVideoSheetOpen(false);
      clearOpenParam();
      await refreshMaterials();
    } catch (e) {
      setVideoStatus("");
      console.error(toActionableError(e, "生视频失败"));
      setCollectMsg("生视频失败，请稍后重试");
    } finally {
      setVideoBusy(false);
    }
  };

  const handleCollect = async () => {
    setCollecting(true);
    setError(null);
    setNoSources(false);
    try {
      const result = await materialsApi.collect();
      collectJobIdsRef.current = result.jobIds || [];
      // 0 个来源：系统没配置内容来源，采集没东西可抓
      if (!result.jobCount) {
        setNoSources(true);
        return;
      }
      flash(`采集任务已创建（${result.jobCount} 个来源），正在自动采集`);
      await fetchCollectStatus();
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setError(
        rawMessage
          ? `启动采集失败：${rawMessage}`
          : toPublicError(err, "启动采集失败，请稍后重试"),
      );
    } finally {
      setCollecting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await materialsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      await fetchMaterials();
      flash("已删除");
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((m) => m.id)));
    }
  };

  /** 选中素材 → 去写文章：把选中素材标题拼成目标，带进创作工作台（闭环） */
  const handleCreateFromSelected = () => {
    const titles = materials
      .filter((m) => selectedIds.has(m.id))
      .map((m) => m.title)
      .filter(Boolean)
      .slice(0, 3);
    const goal = titles.length
      ? `参考素材撰写内容：${titles.join("、")}`
      : "基于素材库撰写内容";
    router.push(`/content/workspace?intent=create&goal=${encodeURIComponent(goal)}`);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    setError(null);
    try {
      await materialsApi.batchRemove(
        Array.from(selectedIds),
        buildMaterialRiskConfirmation("material-batch-delete", "high"),
      );
      setSelectedIds(new Set());
      await fetchMaterials();
      flash(`已删除 ${selectedIds.size} 条素材`);
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setError(rawMessage || toPublicError(err, "批量删除失败"));
    } finally {
      setBatchDeleting(false);
    }
  };

  const platforms = useMemo(() => {
    const set = new Set(materials.map((m) => m.platform).filter(Boolean));
    return Array.from(set);
  }, [materials]);

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (platformFilter !== "all" && m.platform !== platformFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const haystack = `${m.title} ${m.author} ${m.summary || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [materials, statusFilter, platformFilter, query]);

  const collecting_ = collectStatus?.active;

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  const setBodyLock = useBodyLock();
  // 移动端弹层打开时锁 body 滚动（防穿透，批次 C #16）
  const anySheetOpen = linkSheetOpen || genSheetOpen || videoSheetOpen || ttsSheetOpen;
  useEffect(() => {
    if (isMobile) setBodyLock(anySheetOpen);
  }, [anySheetOpen, isMobile, setBodyLock]);
  /* 去水印弹层（A4）——移动端/桌面端共用（桌面端曾有入口无弹层的 bug，2026-08-11 修复） */
  const linkSheetOverlay = (
    <>
      {/* 本地上传隐藏文件选择（桌面端/移动端共用入口） */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*"
        multiple={false}
        style={{ display: "none" }}
        onChange={handleUploadFile}
      />
      {/* 去水印采集弹层（A4 去水印） */}
      {linkSheetOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(6,16,32,.55)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={closeLinkSheet}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#0d1b2f",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ color: "var(--kaypal-v3-accent)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              🔗 粘贴链接去水印
            </div>
            <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 12, marginBottom: 12 }}>
              粘贴作品分享链接，自动去水印保存到素材库（支持抖音/快手/小红书/视频号/B站/TikTok/YouTube/X/Instagram）
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setLinkPlatform("auto")}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  border: linkPlatform === "auto" ? "1px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                  background: linkPlatform === "auto" ? "var(--kaypal-v3-accent-soft)" : "transparent",
                  color: linkPlatform === "auto" ? "var(--kaypal-v3-accent)" : "var(--kaypal-v3-soft-ink)",
                  cursor: "pointer",
                }}
              >
                自动识别
              </button>
              {downloadPlatforms.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setLinkPlatform(p.key)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    border: linkPlatform === p.key ? "1px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                    background: linkPlatform === p.key ? "var(--kaypal-v3-accent-soft)" : "transparent",
                    color: linkPlatform === p.key ? "var(--kaypal-v3-accent)" : "var(--kaypal-v3-soft-ink)",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="粘贴作品分享链接…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid var(--kaypal-v3-border)",
                background: "var(--kaypal-v3-field-bg)",
                color: "var(--kaypal-v3-paper)",
                fontSize: 14,
                outline: "none",
                marginBottom: 12,
              }}
            />
            <button
              type="button"
              disabled={!linkInput.trim() || linkBusy}
              onClick={handleLinkCollect}
              className="mx-btn-gold"
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                opacity: !linkInput.trim() || linkBusy ? 0.6 : 1,
                border: "none",
                cursor: "pointer",
              }}
            >
              {linkBusy ? "采集中…" : "开始采集"}
            </button>
          </div>
        </div>
      )}
    </>
  );
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <BrandLogo />
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">素材库</h1>
              <p className="mx-page-sub">自动采集的内容素材，可直接用于创作</p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              style={{ fontSize: 12, padding: "8px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-accent)", border: "1px solid var(--kaypal-v3-accent)", cursor: uploading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              上传
            </button>
            <Link
              href="/video-download"
              style={{ fontSize: 12, padding: "8px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-accent-soft)", border: "1px solid var(--kaypal-v3-border)", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}
            >
              去水印
            </Link>
            <button
              type="button"
              onClick={() => setGenSheetOpen(true)}
              style={{ fontSize: 12, padding: "8px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-accent)", border: "1px solid var(--kaypal-v3-accent)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              AI 生图
            </button>
            <button
              type="button"
              onClick={() => setVideoSheetOpen(true)}
              style={{ fontSize: 12, padding: "8px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-accent)", border: "1px solid var(--kaypal-v3-accent)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              AI 生视频
            </button>
            <button
              type="button"
              onClick={() => setTtsSheetOpen(true)}
              style={{ fontSize: 12, padding: "8px 12px", borderRadius: "var(--kaypal-v3-radius-sm)", background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-accent)", border: "1px solid var(--kaypal-v3-accent)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              AI 配音
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px", opacity: collecting_ ? 0.6 : 1 }}
              disabled={collecting_}
              onClick={handleCollect}
            >
              {collecting_ ? "采集中…" : "开始采集"}
            </button>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14 }}>
          {notice && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(16,185,129,.1)", fontSize: 12, color: "var(--kaypal-v3-success)" }}>{notice}</div>
          )}
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</div>
          )}

          {/* 素材统计 hero */}
          <div className="mx-hero" style={{ borderRadius: 22, padding: 16, marginBottom: 14 }}>
            <div className="mx-hero-ring" style={{ width: 110, height: 110, top: -30, right: -22 }} />
            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--kaypal-v3-soft-ink)" }}>云端素材</div>
                <div className="mx-gold-text" style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{materials.length}</div>
                <div style={{ fontSize: 10, color: "var(--kaypal-v3-soft-ink)" }}>条已入库</div>
              </div>
              <span className="mx-badge mx-badge-white">
                <ImageIcon width={12} height={12} aria-hidden="true" />
                采集素材
              </span>
            </div>
          </div>

          {/* 搜索 */}
          <div className="mx-control" style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 14, padding: "0 14px", height: 44 }}>
            <Search width={16} height={16} style={{ color: "#b87325" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、作者、摘要"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--kaypal-v3-ink)" }}
            />
          </div>
        </section>

        {/* 素材列表 */}
        <section className="mx-px" style={{ marginTop: 16, paddingBottom: 28 }}>
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <SkeletonRow width="70%" />
                <SkeletonRow width="58%" />
                <SkeletonRow width="76%" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="mx-empty">
                <p>{materials.length === 0 ? "还没有素材，点右上角开始采集" : "没有匹配的素材"}</p>
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                  onClick={() => setViewing(m)}
                >
                  <span className="mx-row-ic" style={{ background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-cobalt)" }}>
                    <ImageIcon width={18} height={18} aria-hidden="true" />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{m.title}</div>
                    <div className="mx-row-desc">
                      {m.platform}
                      {m.author ? ` · ${m.author}` : ""}
                      {m.publishDate ? ` · ${m.publishDate.slice(0, 10)}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    {m.status === "unmined" ? <span className="mx-badge mx-badge-gold">新</span> : null}
                    <ChevronRight width={15} height={15} style={{ color: "var(--kaypal-v3-muted)" }} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* 详情弹窗：复用桌面 fixed inset-0 弹窗（天然全屏） */}
        {viewing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-sm">
              <div className="flex items-start justify-between border-b border-[var(--kaypal-v3-border)] p-5">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">{viewing.title}</h3>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {viewing.platform} · {viewing.publishDate?.slice(0, 10) ?? "未知日期"}
                  </p>
                </div>
                <button type="button" aria-label="关闭" className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]" onClick={() => setViewing(null)}>
                  <XCircle size={20} />
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {viewing.summary ? <p className="text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">{viewing.summary}</p> : null}
                {viewing.keywords?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {viewing.keywords.map((tag) => <span key={tag} className="mx-badge mx-badge-gold">{tag}</span>)}
                  </div>
                ) : null}
                {viewing.sourceUrl ? (
                  <a href={viewing.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline">查看原文 →</a>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-[var(--kaypal-v3-border)] p-4">
                <button type="button" className="btn btn-sm" style={{ border: "1px solid var(--kaypal-v3-danger)", color: "var(--kaypal-v3-danger)", borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 600 }} onClick={() => { setDeleteTarget(viewing); setViewing(null); }}>
                  删除
                </button>
              </div>
            </div>
          </div>
        )}

      {/* 去水印采集弹层（A4 去水印） */}
      {linkSheetOverlay}

      {/* AI 生视频弹层（Seedance，可选返利直付 ¥5/次） */}
      {videoSheetOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(6,16,32,.55)", display: "flex", alignItems: "flex-end" }}
          onClick={() => { setVideoSheetOpen(false); clearOpenParam(); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", background: "#0d1b2f", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "18px 18px calc(20px + env(safe-area-inset-bottom))" }}
          >
            <div style={{ color: "var(--kaypal-v3-accent)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>🎬 AI 生视频</div>
            <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 12, marginBottom: 12 }}>
              描述画面生成短视频（happyhorse-1.1），生成后自动存入素材库
            </div>
            <input
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              placeholder="描述你要的视频画面，如：产品特写，暖光，缓慢推镜头…"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--kaypal-v3-border)", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-paper)", fontSize: 14, outline: "none", marginBottom: 12 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", lineHeight: "28px" }}>时长</span>
              {[3, 5, 10, 15].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setVideoDuration(d)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    border: videoDuration === d ? "1px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                    background: videoDuration === d ? "var(--kaypal-v3-accent-soft)" : "transparent",
                    color: videoDuration === d ? "var(--kaypal-v3-accent)" : "var(--kaypal-v3-soft-ink)",
                    cursor: "pointer",
                  }}
                >
                  {d}s
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setVideoPayByRebate((v) => {
                  const next = !v;
                  if (next) {
                    void savingsApi
                      .payCheck("video_generation")
                      .then((info) => setVideoPayInfo(info))
                      .catch(() => setVideoPayInfo(null));
                  } else {
                    setVideoPayInfo(null);
                  }
                  return next;
                });
              }}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", marginBottom: 10, borderRadius: 10, border: videoPayByRebate ? "1px solid var(--kaypal-v3-success)" : "1px solid var(--kaypal-v3-border)", background: videoPayByRebate ? "rgba(126,226,168,.12)" : "var(--kaypal-v3-field-bg)", cursor: "pointer" }}
            >
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-paper)", fontWeight: 600 }}>
                {videoPayByRebate ? "✅ 用返利支付 ¥5/次" : "💰 用返利支付（返利抵现金）"}
              </span>
              <span style={{ fontSize: 11, color: videoPayInfo?.canCover ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-muted)" }}>
                {videoPayInfo ? `返利余额 ¥${videoPayInfo.rebateBalance.toFixed(2)}` : "点击查看余额"}
              </span>
            </button>
            <button
              type="button"
              disabled={!videoPrompt.trim() || videoBusy}
              onClick={() => void handleGenVideo()}
              className="mx-btn-gold"
              style={{ width: "100%", padding: "12px 0", borderRadius: 12, fontSize: 14, fontWeight: 700, opacity: !videoPrompt.trim() || videoBusy ? 0.6 : 1, border: "none", cursor: "pointer" }}
            >
              {videoBusy ? "提交中…" : videoPayByRebate ? "用返利 ¥5 生成" : "开始生成"}
            </button>
            {videoStatus && (
              <div style={{ color: "var(--kaypal-v3-soft-ink)", fontSize: 12, marginTop: 10, textAlign: "center" }}>{videoStatus}</div>
            )}
          </div>
        </div>
      )}

      {/* AI 生图弹层（A5 image2-GPT） */}
      {genSheetOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(6,16,32,.55)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => { setGenSheetOpen(false); clearOpenParam(); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#0d1b2f",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ color: "var(--kaypal-v3-accent)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              ✨ AI 生图
            </div>
            <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 12, marginBottom: 12 }}>
              一句话生成配图（qwen-image-3.0-pro），生成后自动存入素材库
            </div>
            <input
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="描述你要的图，如：美食测评封面，暖色调…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid var(--kaypal-v3-border)",
                background: "var(--kaypal-v3-field-bg)",
                color: "var(--kaypal-v3-paper)",
                fontSize: 14,
                outline: "none",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", lineHeight: "28px" }}>尺寸</span>
              {[
                { v: "1024*1024", label: "方图 1:1" },
                { v: "768*1024", label: "竖图 3:4" },
                { v: "1024*768", label: "横图 4:3" },
              ].map((s) => (
                <button
                  key={s.v}
                  type="button"
                  onClick={() => setGenSize(s.v)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    border: genSize === s.v ? "1px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                    background: genSize === s.v ? "var(--kaypal-v3-accent-soft)" : "transparent",
                    color: genSize === s.v ? "var(--kaypal-v3-accent)" : "var(--kaypal-v3-soft-ink)",
                    cursor: "pointer",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setGenPayByRebate((v) => {
                  const next = !v;
                  if (next) {
                    void savingsApi
                      .payCheck("image_generation")
                      .then((info) => setGenPayInfo(info))
                      .catch(() => setGenPayInfo(null));
                  } else {
                    setGenPayInfo(null);
                  }
                  return next;
                });
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                marginBottom: 10,
                borderRadius: 10,
                border: genPayByRebate ? "1px solid var(--kaypal-v3-success)" : "1px solid var(--kaypal-v3-border)",
                background: genPayByRebate ? "rgba(126,226,168,.12)" : "var(--kaypal-v3-field-bg)",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-paper)", fontWeight: 600 }}>
                {genPayByRebate ? "✅ 用返利支付 ¥1/次" : "💰 用返利支付（返利抵现金）"}
              </span>
              <span style={{ fontSize: 11, color: genPayInfo?.canCover ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-muted)" }}>
                {genPayInfo ? `返利余额 ¥${genPayInfo.rebateBalance.toFixed(2)}` : "点击查看余额"}
              </span>
            </button>
            <button
              type="button"
              disabled={!genPrompt.trim() || genBusy}
              onClick={handleGenImage}
              className="mx-btn-gold"
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                opacity: !genPrompt.trim() || genBusy ? 0.6 : 1,
                border: "none",
                cursor: "pointer",
              }}
            >
              {genBusy ? "生成中（约 30 秒）…" : genPayByRebate ? "用返利 ¥1 生成" : "开始生成"}
            </button>
          </div>
        </div>
      )}

      {/* AI 配音弹层（P4 qwen3-tts） */}
      {ttsSheetOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(6,16,32,.55)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setTtsSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#0d1b2f",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ color: "var(--kaypal-v3-accent)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              🎙 AI 配音
            </div>
            <div style={{ color: "var(--kaypal-v3-muted)", fontSize: 12, marginBottom: 12 }}>
              文案一键转语音（qwen3-tts，最多 600 字），生成后复制音频链接用于视频合成
            </div>
            <textarea
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              placeholder="输入要配音的文案，如：大家好，今天给大家分享一道三分钟快手菜…"
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--kaypal-v3-border)",
                background: "var(--kaypal-v3-field-bg)",
                color: "var(--kaypal-v3-soft-ink)",
                fontSize: 14,
                resize: "none",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => {
                const text = ttsText.trim();
                if (!text || ttsBusy) return;
                setTtsBusy(true);
                setTtsResult(null);
                dashGenerateSpeech({ text })
                  .then((r) => setTtsResult({ audioUrl: r.audioUrl, filename: r.filename }))
                  .catch((e) => {
                    console.error(toActionableError(e, "配音失败"));
                    setCollectMsg("配音失败，请稍后重试");
                  })
                  .finally(() => setTtsBusy(false));
              }}
              disabled={!ttsText.trim() || ttsBusy}
              style={{
                width: "100%",
                marginTop: 12,
                padding: "12px",
                borderRadius: 12,
                border: "none",
                background: !ttsText.trim() || ttsBusy ? "var(--kaypal-v3-cobalt)" : "var(--kaypal-v3-cobalt)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: !ttsText.trim() || ttsBusy ? "not-allowed" : "pointer",
              }}
            >
              {ttsBusy ? "生成中…" : "生成配音"}
            </button>
            {ttsResult && (
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--kaypal-v3-accent-soft)", border: "1px solid var(--kaypal-v3-cobalt)" }}>
                <div style={{ color: "var(--kaypal-v3-cobalt)", fontSize: 12, marginBottom: 6 }}>
                  ✅ 配音完成：{ttsResult.filename}
                </div>
                <audio controls src={ttsResult.audioUrl} style={{ width: "100%", height: 36 }} />
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--kaypal-v3-muted)" }}>
                  音频链接（约 7 天有效）：<span style={{ wordBreak: "break-all" }}>{ttsResult.audioUrl}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 采集结果消息 */}
      {collectMsg && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 100,
            zIndex: 90,
            padding: "12px 16px",
            borderRadius: 12,
            background: collectMsg.startsWith("✅") ? "rgba(16,185,129,.92)" : "rgba(239,68,68,.92)",
            color: "#fff",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {collectMsg}
        </div>
      )}
    </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchMaterials()} />
      ) : null}
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">素材库</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统自动采集的内容素材，可直接用于创作
            </p>
          </div>
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
            style={{ fontSize: 12, padding: "8px 12px", borderRadius: 10, background: "var(--kaypal-v3-accent-soft)", color: "var(--kaypal-v3-cobalt)", border: "1px solid var(--kaypal-v3-cobalt)", cursor: uploading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {uploading ? "上传中…" : "📤 本地上传"}
          </button>
          <Link
            href="/video-download"
            style={{ fontSize: 12, padding: "8px 12px", borderRadius: 10, background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-accent-soft)", border: "1px solid var(--kaypal-v3-border)", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}
          >
            🔗 去水印
          </Link>
          <V2PrimaryButton
            icon={collecting ? Loader2 : Play}
            loading={collecting}
            disabled={collecting_}
            onClick={handleCollect}
          >
            {collecting ? "正在启动..." : collecting_ ? "采集中..." : "开始采集"}
          </V2PrimaryButton>
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {noSources && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-5">
          <div className="flex items-start gap-3">
            <FolderOpen className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
            <div className="flex-1">
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                还没有配置采集来源
              </p>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                采集是从「内容来源」里抓内容的。先去设置里添加来源（比如 36氪、知乎热榜），回来再点采集。
              </p>
              <div className="mt-3">
                <V2PrimaryButton onClick={() => router.push("/settings")}>
                  去添加内容来源
                </V2PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 采集进度面板 */}
      {collectStatus && (collecting_ || collectStatus.counts.completed > 0 || collectStatus.counts.failed > 0) && (
        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {collecting_ ? (
                <Loader2 className="h-5 w-5 animate-spin text-[var(--kaypal-v3-accent)]" />
              ) : collectStatus.counts.failed > 0 ? (
                <XCircle className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
              )}
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                {collecting_
                  ? `正在采集... 队列 ${collectStatus.pendingCount} 个`
                  : "最近一轮采集"}
              </p>
            </div>
            <V2GhostButton icon={RefreshCcw} onClick={() => void fetchCollectStatus()}>
              刷新
            </V2GhostButton>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {collectStatus.counts.active + collectStatus.counts.waiting}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">进行中</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-success)]">
                {collectStatus.counts.completed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">完成</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-danger)]">
                {collectStatus.counts.failed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">失败</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {collectStatus.counts.delayed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">等待重试</p>
            </div>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
          <V2Input
            placeholder="搜标题、作者..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-36">
          <V2Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="unmined">待挖掘</option>
            <option value="mined">已挖掘</option>
            <option value="failed">采集失败</option>
          </V2Select>
        </div>
        <div className="w-36">
          <V2Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="all">全部来源</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_NAMES[p] || p}
              </option>
            ))}
          </V2Select>
        </div>
      </div>

      {/* 素材列表 */}
      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={FolderOpen}
            title={materials.length === 0 ? "还没有素材" : "筛选条件下没有素材"}
            description={materials.length === 0 ? "点右上角「开始采集」，系统自动帮你找素材" : "换个筛选条件试试"}
            action={
              materials.length === 0 ? (
                <V2PrimaryButton icon={Play} onClick={handleCollect}>
                  开始采集
                </V2PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((material) => {
              const status = STATUS_LABELS[material.status];
              return (
                <div key={material.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3 flex-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--kaypal-v3-accent)]"
                      checked={selectedIds.has(material.id)}
                      onChange={() => toggleSelect(material.id)}
                    />
                    <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-medium text-[var(--kaypal-v3-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)] hover:underline"
                        onClick={() => setViewing(material)}
                      >
                        {material.title || "未命名"}
                      </button>
                      <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {PLATFORM_NAMES[material.platform] || material.platform}
                      {material.author ? ` · ${material.author}` : ""}
                      {material.publishDate
                        ? ` · ${new Date(material.publishDate).toLocaleDateString("zh-CN")}`
                        : ""}
                      {material.summary ? ` · ${material.summary}` : ""}
                    </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {deleteTarget?.id === material.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--kaypal-v3-danger)]">确认删除？</span>
                        <V2DangerButton loading={deleting} onClick={() => void handleDelete()}>
                          确认
                        </V2DangerButton>
                        <V2GhostButton onClick={() => setDeleteTarget(null)}>取消</V2GhostButton>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label="删除素材"
                        title="删除素材"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                        onClick={() => setDeleteTarget(material)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={toggleSelectAll}
            />
            全选
          </label>
          <span className="text-sm text-[var(--kaypal-v3-muted)]">
            共 {materialsTotal} 条
            {materials.length < materialsTotal ? `，已加载 ${materials.length} 条` : ""}
            {selectedIds.size > 0 ? `，已选 ${selectedIds.size}` : ""}
          </span>
          {materials.length < materialsTotal && (
            <button
              type="button"
              className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] transition hover:underline"
              onClick={loadMoreMaterials}
            >
              加载更多
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <V2PrimaryButton onClick={handleCreateFromSelected}>
                去写文章（{selectedIds.size}）
              </V2PrimaryButton>
              <V2DangerButton loading={batchDeleting} onClick={() => void handleBatchDelete()}>
                {batchDeleting ? "正在删除..." : `删除选中（${selectedIds.size}）`}
              </V2DangerButton>
            </>
          )}
          <V2GhostButton icon={RefreshCcw} onClick={() => void fetchMaterials()}>
            刷新
          </V2GhostButton>
        </div>
      </section>

      {/* 素材详情弹窗 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] p-5">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                  {viewing.title || "未命名"}
                </h3>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {PLATFORM_NAMES[viewing.platform] || viewing.platform}
                  {viewing.author ? ` · ${viewing.author}` : ""}
                  {viewing.publishDate
                    ? ` · ${new Date(viewing.publishDate).toLocaleDateString("zh-CN")}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setViewing(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {viewing.summary && (
                <p className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
                  {viewing.summary}
                </p>
              )}
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                {viewing.content || "（无正文内容）"}
              </div>
            </div>
            {viewing.sourceUrl && (
              <div className="border-t border-[var(--kaypal-v3-border)] p-4">
                <a
                  href={viewing.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
                >
                  查看原文 →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {linkSheetOverlay}
    </div>
  );
}
