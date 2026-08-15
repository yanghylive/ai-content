"use client";

import { addToast } from "@heroui/react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Spinner } from "@astryxdesign/core/Spinner";
import {
  ClipboardList,
  FilePlus2,
  RefreshCw,
} from "lucide-react";
import { V2PrimaryButton } from "@/components/v2/ui-kit";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useConfirm } from "@/hooks/use-confirm";
import {
  contentWorkspaceApi,
  type ContentWorkspaceDocument,
  type ContentWorkspaceMaterial,
  type ContentWorkspaceQueueItem,
  type ContentWorkspaceVersion,
} from "@/lib/api/content-workspace";
import { toPublicError } from "@/lib/public-error";
import {
  createEmptyWorkspaceBrief,
  createEmptyWorkspaceOutline,
} from "@/lib/content-workspace-types";
import { ContentEditor } from "./content-editor";
import {
  canEnterWorkspaceStep,
  constrainWorkspaceStep,
  contentWorkspaceReducer,
  createInitialWorkspaceState,
  isWorkspaceStep,
  loadRequestedOrFirstDocument,
  resolveWorkspaceStep,
} from "./content-workspace-state";
import { type ContentQueueStatusFilter } from "./content-queue";
import { WorkspaceContext } from "./workspace-context";
import { WorkspaceHeader } from "./workspace-header";
import { shouldClearRulePreviewOnStepChange } from "./workspace-action-state";
import { resolveWorkspaceInitialAction } from "./workspace-initial-action";
import {
  WorkspaceMobileTools,
  type WorkspaceMobilePanel,
} from "./workspace-mobile-tools";
import {
  buildReviewChecks,
  formatWorkspaceTime,
  type EditorValue,
  type RulePreviewCandidate,
  type SaveState,
  type WorkspaceBrandVoice,
  type WorkspaceCandidatePlatform,
  type WorkspaceKnowledgeView,
  type WorkspaceMaterialView,
  type WorkspaceQueueItemView,
  type WorkspaceStepId,
  type WorkspaceVersionView,
} from "./workspace-types";

function contentFingerprint(value: Pick<EditorValue, "title" | "content">) {
  return JSON.stringify([value.title, value.content]);
}

/** 给数据请求加超时保护：接口挂起时不让页面无限停在加载态（移动端表现为白屏）。 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMessage: string,
  ms = 12_000,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), ms),
    ),
  ]);
}

function workspaceFingerprint(value: EditorValue, step: WorkspaceStepId) {
  return JSON.stringify([
    value.title,
    value.brief,
    value.outline,
    value.content,
    step,
  ]);
}

function createEmptyEditorValue(): EditorValue {
  return {
    title: "",
    brief: createEmptyWorkspaceBrief(),
    outline: createEmptyWorkspaceOutline(),
    content: "",
    legacyBodyEditable: false,
  };
}

function queueItemToView(item: ContentWorkspaceQueueItem): WorkspaceQueueItemView {
  const statusLabels: Record<string, string> = {
    draft: "草稿",
    writing: "编辑中",
    review: "待审核",
    ready: "已就绪",
    published: "已发布",
  };
  const platformLabel =
    item.contentType === "xiaohongshu" ? "小红书" : "图文内容";
  return {
    id: item.id,
    title: item.title || "未命名内容",
    excerpt: item.summary,
    status: item.status,
    statusLabel: statusLabels[item.status] || "草稿",
    platformLabel,
    updatedAt: formatWorkspaceTime(item.updatedAt),
  };
}

function documentToQueueView(
  document: ContentWorkspaceDocument,
): WorkspaceQueueItemView {
  return queueItemToView({
    id: document.id,
    source: "article",
    persisted: true,
    title: document.title,
    summary: document.content.replace(/\s+/g, " ").trim().slice(0, 120),
    status: document.status,
    contentType: document.contentType,
    contentFormat: document.contentFormat,
    topic: document.topic
      ? {
          id: document.topicId,
          title: document.topic.title,
          keywords: document.topic.keywords,
        }
      : null,
    coverImage: document.coverImage,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
}

function materialToView(item: ContentWorkspaceMaterial): WorkspaceMaterialView {
  return {
    id: item.id,
    title: item.title,
    summary: item.excerpt || item.summary || item.content || "",
    platformLabel: item.platform || "素材库",
  };
}

function versionToView(item: ContentWorkspaceVersion): WorkspaceVersionView {
  const platformLabels: Record<string, string> = {
    all: "全平台",
    xiaohongshu: "小红书",
    wechat: "公众号",
    douyin: "抖音",
    bilibili: "B站",
    tiktok: "TikTok",
  };
  return {
    id: item.id,
    title: item.title || "未命名版本",
    content: item.content,
    platform: item.platform,
    platformLabel: platformLabels[item.platform] || item.platform,
    versionLabel: `V${item.versionNo}`,
    isOfficial: item.isOfficial,
    updatedAt: formatWorkspaceTime(item.updatedAt),
  };
}

function buildLocalRulePreview(
  value: EditorValue,
  brandVoice: WorkspaceBrandVoice,
  platform: WorkspaceCandidatePlatform,
): RulePreviewCandidate {
  const platformLabels: Record<WorkspaceCandidatePlatform, string> = {
    all: "通用主稿",
    xiaohongshu: "小红书",
    wechat: "公众号",
    douyin: "短视频",
  };
  const normalizedTitle = value.title.trim() || "一份更清晰的内容方案";
  const title =
    platform === "xiaohongshu"
      ? `${normalizedTitle.slice(0, 22)}｜3 个可执行步骤`
      : platform === "douyin"
        ? `别急着开始：${normalizedTitle.slice(0, 18)}`
        : /[：:？?]/.test(normalizedTitle)
          ? normalizedTitle
          : `${normalizedTitle}：从问题到行动的完整方法`;
  const content = value.content.trim();
  const opening =
    brandVoice === "practical"
      ? "先讲一次真实实践：内容真正起效，往往不是写得更多，而是让问题、依据和行动都能被验证。"
      : brandVoice === "concise"
        ? "结论：先讲清问题、依据和下一步行动。"
        : "先说结论：真正有效的内容，需要让读者快速看懂问题、依据和下一步行动。";
  const optimizedContent = content
    ? content.startsWith("先说结论")
      ? content
      : `${opening}\n\n${content}`
    : `${opening}\n\n补充核心依据、真实案例和可执行步骤后，再进入审核准备。`;

  return {
    title,
    content: optimizedContent,
    changes: [
      `按${platformLabels[platform]}调整标题`,
      `采用${brandVoice === "professional" ? "专业可信" : brandVoice === "practical" ? "实战经验" : "克制简洁"}语气`,
      "保留原正文与段落顺序",
    ],
    platform,
    platformLabel: platformLabels[platform],
  };
}

export function ContentWorkspaceClient() {
  const { confirm, modal } = useConfirm();
  const router = useRouter();
  const [queue, setQueue] = useState<WorkspaceQueueItemView[]>([]);
  const [materials, setMaterials] = useState<WorkspaceMaterialView[]>([]);
  const [knowledge, setKnowledge] = useState<WorkspaceKnowledgeView[]>([]);
  const [versions, setVersions] = useState<ContentWorkspaceVersion[]>([]);
  const [document, setDocument] = useState<ContentWorkspaceDocument | null>(null);
  const [intendedDocumentId, setIntendedDocumentId] = useState("");
  const [workspaceState, dispatchWorkspace] = useReducer(
    contentWorkspaceReducer,
    createEmptyEditorValue(),
    createInitialWorkspaceState,
  );
  const { activeStep, value: editorValue } = workspaceState;
  const [candidate, setCandidate] = useState<RulePreviewCandidate | null>(null);
  const [brandVoice, setBrandVoice] = useState<WorkspaceBrandVoice>("professional");
  const [keyword, setKeyword] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] =
    useState<ContentQueueStatusFilter>("all");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [queueLoading, setQueueLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmingOutline, setConfirmingOutline] = useState(false);
  const [officialLoadingVersionId, setOfficialLoadingVersionId] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<WorkspaceMobilePanel>(null);

  const documentRef = useRef<ContentWorkspaceDocument | null>(null);
  const valueRef = useRef(editorValue);
  const activeStepRef = useRef(activeStep);
  const savedFingerprintRef = useRef(
    workspaceFingerprint(editorValue, activeStep),
  );
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const documentLoadRequestRef = useRef(0);
  const intendedDocumentIdRef = useRef("");

  valueRef.current = editorValue;
  activeStepRef.current = activeStep;
  documentRef.current = document;

  const setEditorValue = useCallback(
    (next: EditorValue | ((current: EditorValue) => EditorValue)) => {
      const nextValue =
        typeof next === "function" ? next(valueRef.current) : next;
      valueRef.current = nextValue;
      dispatchWorkspace({ type: "replace_value", value: nextValue });
    },
    [],
  );

  const setActiveStep = useCallback((step: WorkspaceStepId) => {
    const safeStep = isWorkspaceStep(step) ? step : "brief";
    if (!canEnterWorkspaceStep(valueRef.current, safeStep)) {
      addToast({
        title: "请先确认内容大纲",
        description: "确认结构后才能进入正文及后续步骤。",
        color: "warning",
      });
      return;
    }
    if (
      shouldClearRulePreviewOnStepChange(activeStepRef.current, safeStep)
    ) {
      setCandidate(null);
    }
    activeStepRef.current = safeStep;
    dispatchWorkspace({ type: "set_step", step: safeStep });
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("step", safeStep);
    window.history.replaceState(null, "", nextUrl);
  }, []);

  const hasUnsavedChanges = Boolean(
    document &&
      workspaceFingerprint(editorValue, activeStep) !==
        savedFingerprintRef.current,
  );
  useUnsavedChangesWarning(hasUnsavedChanges);

  const refreshQueue = useCallback(async (searchKeyword = "") => {
    setQueueLoading(true);
    try {
      const result = await withTimeout(
        contentWorkspaceApi.listQueue({
          page: 1,
          limit: 60,
          keyword: searchKeyword.trim() || undefined,
        }),
        "内容服务响应超时",
      );
      setQueue(result.items.map(queueItemToView));
      setLoadFailed(false);
      return result.items;
    } catch (error) {
      setLoadFailed(true);
      addToast({
        title: "内容队列加载失败",
        description: toPublicError(error, "请检查内容服务后重试。"),
        color: "danger",
      });
      return [];
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const loadDocument = useCallback(
    async (articleId: string, opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      const requestId = ++documentLoadRequestRef.current;
    intendedDocumentIdRef.current = articleId;
    setIntendedDocumentId(articleId);
    setDocumentLoading(true);
    setCandidate(null);
    try {
      const nextDocument = await withTimeout(
        contentWorkspaceApi.getDocument(articleId),
        "内容加载响应超时",
      );
      if (
        requestId !== documentLoadRequestRef.current ||
        intendedDocumentIdRef.current !== articleId
      ) {
        return false;
      }
      const nextValue = {
        title: nextDocument.title,
        brief: nextDocument.workspaceBrief,
        outline: nextDocument.workspaceOutline,
        content: nextDocument.content,
        legacyBodyEditable: nextDocument.legacyBodyEditable,
      };
      const nextUrl = new URL(window.location.href);
      const urlStep = documentRef.current
        ? null
        : nextUrl.searchParams.get("step");
      const nextStep = constrainWorkspaceStep(
        nextValue,
        resolveWorkspaceStep(urlStep, nextDocument.workspaceStep),
      );
      documentRef.current = nextDocument;
      valueRef.current = nextValue;
      activeStepRef.current = nextStep;
      savedFingerprintRef.current = workspaceFingerprint(nextValue, nextStep);
      setDocument(nextDocument);
      dispatchWorkspace({ type: "hydrate", value: nextValue, step: nextStep });
      setSaveState("saved");
      setLastSavedAt(formatWorkspaceTime(nextDocument.updatedAt));
      nextUrl.searchParams.set("articleId", nextDocument.id);
      nextUrl.searchParams.set("step", nextStep);
      window.history.replaceState(null, "", nextUrl);
      setVersions([]);
      setKnowledge([]);

      void contentWorkspaceApi
        .listVersions({ documentId: nextDocument.id })
        .then((result) => {
          if (
            requestId === documentLoadRequestRef.current &&
            intendedDocumentIdRef.current === nextDocument.id &&
            documentRef.current?.id === nextDocument.id
          ) {
            setVersions(result.items);
          }
        })
        .catch(() => {
          if (
            requestId === documentLoadRequestRef.current &&
            intendedDocumentIdRef.current === nextDocument.id
          ) {
            setVersions([]);
          }
        });

      const knowledgeQuery = (nextDocument.title || nextDocument.content.slice(0, 80)).trim();
      if (knowledgeQuery) {
        void contentWorkspaceApi
          .searchKnowledge({ query: knowledgeQuery, limit: 5 })
          .then((result) => {
            if (
              requestId !== documentLoadRequestRef.current ||
              intendedDocumentIdRef.current !== nextDocument.id ||
              documentRef.current?.id !== nextDocument.id
            ) {
              return;
            }
            setKnowledge(
              result.matches.map((item) => ({
                id: item.assetId,
                title: item.title,
                excerpt: item.snippet,
                sourceLabel: item.sourceType || "知识库",
              })),
            );
          })
          .catch(() => {
            if (
              requestId === documentLoadRequestRef.current &&
              intendedDocumentIdRef.current === nextDocument.id &&
              documentRef.current?.id === nextDocument.id
            ) {
              setKnowledge([]);
            }
          });
      }
      return true;
    } catch (error) {
      if (
        requestId !== documentLoadRequestRef.current ||
        intendedDocumentIdRef.current !== articleId
      ) {
        return false;
      }
      const currentId = documentRef.current?.id || "";
      intendedDocumentIdRef.current = currentId;
      setIntendedDocumentId(currentId);
      if (!silent) {
        addToast({
          title: "内容加载失败",
          description: toPublicError(error, "请稍后重新选择这篇内容。"),
          color: "danger",
        });
      }
      return false;
    } finally {
      if (requestId === documentLoadRequestRef.current) {
        setDocumentLoading(false);
      }
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const saveLoop = async () => {
      while (true) {
        const activeDocument = documentRef.current;
        if (!activeDocument) return false;
        const snapshot = { ...valueRef.current };
        const snapshotStep = activeStepRef.current;
        const snapshotFingerprint = workspaceFingerprint(snapshot, snapshotStep);
        if (snapshotFingerprint === savedFingerprintRef.current) {
          setSaveState("saved");
          return true;
        }

        setSaveState("saving");
        try {
          const persistedSnapshot = {
            ...snapshot,
            title: snapshot.title.trim() || "未命名内容",
          };
          const updated = await contentWorkspaceApi.updateArticle(
            activeDocument.id,
            {
              title: persistedSnapshot.title,
              workspaceBrief: persistedSnapshot.brief,
              workspaceOutline: persistedSnapshot.outline,
              workspaceStep: snapshotStep,
              content: persistedSnapshot.content,
            },
          );
          if (documentRef.current?.id !== activeDocument.id) return true;
          const serverSnapshot: EditorValue = {
            ...persistedSnapshot,
            title: updated.title,
            brief: updated.workspaceBrief,
            outline: updated.workspaceOutline,
            content: updated.content,
            legacyBodyEditable: updated.legacyBodyEditable,
          };
          const serverFingerprint = workspaceFingerprint(
            serverSnapshot,
            snapshotStep,
          );
          const localStillMatchesSnapshot =
            workspaceFingerprint(valueRef.current, activeStepRef.current) ===
            snapshotFingerprint;
          if (localStillMatchesSnapshot) {
            valueRef.current = serverSnapshot;
            setEditorValue(serverSnapshot);
          }
          savedFingerprintRef.current = serverFingerprint;
          setDocument((current) =>
            current?.id === updated.id
              ? {
                  ...current,
                  ...updated,
                  title: valueRef.current.title,
                  workspaceBrief: valueRef.current.brief,
                  workspaceOutline: valueRef.current.outline,
                  workspaceStep: activeStepRef.current,
                  content: valueRef.current.content,
                }
              : current,
          );
          setQueue((items) =>
            items.map((item) =>
              item.id === updated.id
                ? {
                    ...documentToQueueView(updated),
                    title: valueRef.current.title || "未命名内容",
                    excerpt: valueRef.current.content
                      .replace(/\s+/g, " ")
                      .slice(0, 120),
                  }
                : item,
            ),
          );
          setLastSavedAt(
            new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          );
          if (
            workspaceFingerprint(valueRef.current, activeStepRef.current) ===
            serverFingerprint
          ) {
            setSaveState("saved");
            return true;
          }
          setSaveState("pending");
        } catch (error) {
          setSaveState("error");
          addToast({
            title: "自动保存失败",
            description: toPublicError(
              error,
              "修改仍保留在当前页面，可点击重试保存。",
            ),
            color: "danger",
          });
          return false;
        }
      }
    };

    const request = saveLoop();
    saveInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (saveInFlightRef.current === request) saveInFlightRef.current = null;
    }
  }, [setEditorValue]);

  const confirmOutline = useCallback(async () => {
    const activeDocument = documentRef.current;
    if (!activeDocument || confirmingOutline) return;
    const itemsFingerprint = JSON.stringify(valueRef.current.outline.items);
    setConfirmingOutline(true);
    try {
      if (!(await saveNow())) return;
      if (
        documentRef.current?.id !== activeDocument.id ||
        JSON.stringify(valueRef.current.outline.items) !== itemsFingerprint
      ) {
        addToast({
          title: "大纲尚未确认",
          description: "保存期间大纲发生了变化，请检查后重新确认。",
          color: "warning",
        });
        return;
      }

      const updated = await contentWorkspaceApi.updateArticle(activeDocument.id, {
        confirmWorkspaceOutline: true,
        workspaceStep: "outline",
      });
      if (
        documentRef.current?.id !== activeDocument.id ||
        JSON.stringify(valueRef.current.outline.items) !== itemsFingerprint
      ) {
        return;
      }
      const confirmedValue: EditorValue = {
        ...valueRef.current,
        outline: updated.workspaceOutline,
        legacyBodyEditable: false,
      };
      valueRef.current = confirmedValue;
      setEditorValue(confirmedValue);
      savedFingerprintRef.current = workspaceFingerprint(confirmedValue, "outline");
      setDocument((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      setSaveState("saved");
      setLastSavedAt(formatWorkspaceTime(updated.updatedAt));
      addToast({
        title: "大纲已确认",
        description: "确认已绑定当前结构；再次修改会自动失效。",
        color: "success",
      });
    } catch (error) {
      setSaveState("error");
      addToast({
        title: "大纲确认失败",
        description: toPublicError(error, "当前结构仍未确认，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setConfirmingOutline(false);
    }
  }, [confirmingOutline, saveNow, setEditorValue]);

  useEffect(() => {
    contentWorkspaceApi.getCapabilities();

    let active = true;
    void contentWorkspaceApi
      .listMaterials({ page: 1, limit: 10, status: "mined" })
      .then((materialResult) => {
        if (!active) return;
        setMaterials(materialResult.items.map(materialToView));
      })
      .catch((error) => {
        if (!active) return;
        addToast({
          title: "创作上下文加载失败",
          description: toPublicError(error, "内容队列仍可继续使用。"),
          color: "warning",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!document) return;
    const fingerprint = workspaceFingerprint(editorValue, activeStep);
    if (fingerprint === savedFingerprintRef.current) return;
    setSaveState("pending");
    const timer = window.setTimeout(() => {
      void saveNow();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeStep, document, editorValue, saveNow]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshQueue(keyword).then((items) => {
        if (!documentRef.current) {
          const initial = resolveWorkspaceInitialAction(
            window.location.search,
          );
          // action=new：新建草稿，不 fallback 到队列第一篇。
          // 幂等靠两点：createDraft 内部 creating 防重 + 这里立即清除 action 参数。
          if (initial.type === "create-new") {
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete("action");
            window.history.replaceState(null, "", nextUrl);
            void createDraft();
            return;
          }
          void loadRequestedOrFirstDocument(
            initial.articleId,
            items,
            loadDocument,
          );
        }
      });
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createDraft 有 creating 幂等保护，且 action 参数立即清除，不加入依赖避免每次渲染重触发
  }, [keyword, loadDocument, refreshQueue]);

  const selectQueueItem = async (item: WorkspaceQueueItemView) => {
    if (item.id === intendedDocumentIdRef.current) return;
    intendedDocumentIdRef.current = item.id;
    setIntendedDocumentId(item.id);
    if (item.id === documentRef.current?.id) {
      documentLoadRequestRef.current += 1;
      setDocumentLoading(false);
      return;
    }
    if (
      workspaceFingerprint(valueRef.current, activeStepRef.current) !==
      savedFingerprintRef.current
    ) {
      const saved = await saveNow();
      if (intendedDocumentIdRef.current !== item.id) return;
      if (!saved) {
        const ok = await confirm({
          kind: "warning",
          title: "修改保存失败",
          description: "仍要切换内容吗？未保存的修改将丢失。",
          confirmText: "仍要切换",
          cancelText: "留在当前",
        });
        if (!ok) {
          const currentId = documentRef.current?.id || "";
          intendedDocumentIdRef.current = currentId;
          setIntendedDocumentId(currentId);
          return;
        }
      }
    }
    if (intendedDocumentIdRef.current !== item.id) return;
    await loadDocument(item.id);
  };

  const createDraft = async () => {
    if (creating) return;
    if (hasUnsavedChanges && !(await saveNow())) return;
    const createRequestId = ++documentLoadRequestRef.current;
    const createIntentId = `creating:${createRequestId}`;
    intendedDocumentIdRef.current = createIntentId;
    setIntendedDocumentId("");
    setDocumentLoading(false);
    setCreating(true);
    try {
      const result = await contentWorkspaceApi.createDraft({
        title: "未命名内容",
        content: "",
        contentType: "article",
      });
      if (!result.ok) {
        if (documentLoadRequestRef.current === createRequestId) {
          const currentId = documentRef.current?.id || "";
          intendedDocumentIdRef.current = currentId;
          setIntendedDocumentId(currentId);
        }
        addToast({
          title: "草稿未创建",
          description:
            result.failure.code === "endpoint_unavailable"
              ? "当前服务尚未开放草稿保存能力，请稍后再试或联系支持。"
              : "服务未确认草稿已保存，请稍后重试。",
          color: "danger",
        });
        return;
      }
      const item = documentToQueueView(result.document);
      setQueue((items) => [item, ...items.filter((entry) => entry.id !== item.id)]);
      if (
        documentLoadRequestRef.current !== createRequestId ||
        intendedDocumentIdRef.current !== createIntentId
      ) {
        addToast({
          title: "草稿已创建并保存",
          description: "你已选择其他内容，新草稿保留在内容队列中。",
          color: "success",
        });
        return;
      }
      intendedDocumentIdRef.current = result.document.id;
      setIntendedDocumentId(result.document.id);
      setDocumentLoading(false);
      documentRef.current = result.document;
      const nextValue = {
        title: result.document.title,
        brief: result.document.workspaceBrief,
        outline: result.document.workspaceOutline,
        content: result.document.content,
        legacyBodyEditable: result.document.legacyBodyEditable,
      };
      const nextStep = resolveWorkspaceStep(
        null,
        result.document.workspaceStep,
      );
      valueRef.current = nextValue;
      activeStepRef.current = nextStep;
      savedFingerprintRef.current = workspaceFingerprint(nextValue, nextStep);
      setDocument(result.document);
      dispatchWorkspace({ type: "hydrate", value: nextValue, step: nextStep });
      setVersions([]);
      setKnowledge([]);
      setCandidate(null);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("articleId", result.document.id);
      nextUrl.searchParams.set("step", nextStep);
      window.history.replaceState(null, "", nextUrl);
      setSaveState("saved");
      setLastSavedAt(formatWorkspaceTime(result.document.updatedAt));
      addToast({ title: "草稿已创建并保存", color: "success" });
    } catch (error) {
      if (documentLoadRequestRef.current === createRequestId) {
        const currentId = documentRef.current?.id || "";
        intendedDocumentIdRef.current = currentId;
        setIntendedDocumentId(currentId);
      }
      addToast({
        title: "草稿创建失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    } finally {
      setCreating(false);
    }
  };

  const previewLocalRules = (platform: WorkspaceCandidatePlatform = "all") => {
    if (!document) return;
    setCandidate(buildLocalRulePreview(editorValue, brandVoice, platform));
    addToast({
      title: "本地规则建议已准备",
      description: "这是固定文本规则预览，不调用模型，也不会创建正式版本。",
      color: "primary",
    });
  };

  const applyRulePreview = () => {
    if (!candidate || !document) return;
    const preview = candidate;
    const accepted = {
      ...editorValue,
      title: preview.title,
      content: preview.content,
    };
    setEditorValue(accepted);
    valueRef.current = accepted;
    setCandidate(null);
    setSaveState("pending");
    addToast({
      title: "规则建议已应用",
      description: "正文将自动保存；本次操作不会创建或冒充正式版本。",
      color: "success",
    });
  };

  const insertMaterial = (material: WorkspaceMaterialView) => {
    if (!document) return;
    const addition = `\n\n素材参考：${material.title}\n${material.summary}`.trimEnd();
    setEditorValue((current) => ({
      ...current,
      content: `${current.content.trimEnd()}${addition.startsWith("\n") ? "" : "\n\n"}${addition}`.trim(),
    }));
    setActiveStep("draft");
    setCandidate(null);
    addToast({ title: "素材已追加到正文", color: "success" });
  };

  const setOfficialVersion = async (versionId: string) => {
    if (officialLoadingVersionId) return;
    const activeDocument = documentRef.current;
    const targetVersion = versions.find((item) => item.id === versionId);
    if (!activeDocument || !targetVersion) return;

    const versionValue = {
      ...valueRef.current,
      title: targetVersion.title,
      content: targetVersion.content,
    };
    const versionFingerprint = contentFingerprint(versionValue);
    const matchesCurrent =
      contentFingerprint(valueRef.current) === versionFingerprint;

    if (
      !matchesCurrent &&
      !(await confirm({
        kind: "danger",
        title: `采用「${targetVersion.title || "未命名版本"}」`,
        description: "该版本与当前正文不同，采用会覆盖当前编辑内容并保存，是否继续？",
        confirmText: "覆盖并保存",
      }))
    ) {
      return;
    }

    setOfficialLoadingVersionId(versionId);
    try {
      if (!matchesCurrent) {
        valueRef.current = versionValue;
        setEditorValue(versionValue);
        setCandidate(null);
        setSaveState("pending");
      }

      if (
        workspaceFingerprint(valueRef.current, activeStepRef.current) !==
        savedFingerprintRef.current
      ) {
        const saved = await saveNow();
        if (!saved) return;
      }
      if (
        documentRef.current?.id !== activeDocument.id ||
        contentFingerprint(valueRef.current) !== versionFingerprint ||
        workspaceFingerprint(valueRef.current, activeStepRef.current) !==
          savedFingerprintRef.current
      ) {
        addToast({
          title: "正式版本尚未确认",
          description: "正文在确认过程中发生了新修改，请保存后重新操作。",
          color: "warning",
        });
        return;
      }

      await contentWorkspaceApi.setOfficialVersion(versionId);
      const result = await contentWorkspaceApi.listVersions({
        documentId: activeDocument.id,
      });
      if (documentRef.current?.id === activeDocument.id) {
        setVersions(result.items);
      }
      addToast({
        title: "正式版本已确认",
        description: "当前正文与正式版本一致，可继续完成审核准备。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "正式版本确认失败",
        description: toPublicError(error, "当前正文已保留，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setOfficialLoadingVersionId("");
    }
  };

  const officialVersion = versions.find((item) => item.isOfficial);
  const officialVersionMatchesCurrent = Boolean(
    officialVersion &&
      officialVersion.title === editorValue.title &&
      officialVersion.content === editorValue.content &&
      !hasUnsavedChanges,
  );
  const canPrepare = Boolean(
    officialVersionMatchesCurrent &&
      !buildReviewChecks(editorValue).some((item) => item.status === "blocked"),
  );
  const prepareHint = !document
    ? "请先选择或新建内容"
    : !officialVersion
      ? "请先在多平台版本中生成并确认正式版本"
      : !officialVersionMatchesCurrent
        ? "当前正文与正式版本不一致，请先确认新版本"
        : !canPrepare
          ? "请先处理审核准备中的阻塞项"
          : "自动执行发布前检查，创建准备记录并进入发布中心";

  const preparePublish = async () => {
    if (!document || !officialVersion || preparing || !canPrepare) return;
    if (hasUnsavedChanges && !(await saveNow())) return;
    setPreparing(true);
    try {
      const compliance = await contentWorkspaceApi.checkCompliance({
        content: officialVersion.content,
        platform: officialVersion.platform,
        targetType: officialVersion.targetType,
        targetId: officialVersion.id,
        title: officialVersion.title,
        scenario: "pre_publish",
      });

      if (
        compliance.gate.manualReviewRequired ||
        !compliance.gate.publishAllowed
      ) {
        setActiveStep("review");
        addToast({
          title: "需要负责人复核",
          description: compliance.summary || compliance.gate.reason,
          color: "warning",
        });
        const reviewParams = new URLSearchParams({
          versionId: officialVersion.id,
          source: "content-workspace",
        });
        router.push(`/distribution/compliance?${reviewParams.toString()}`);
        return;
      }

      const preparation = await contentWorkspaceApi.preparePublish({
        versionId: officialVersion.id,
        platform: officialVersion.platform,
      });
      addToast({
        title: "发布准备已创建",
        description: "真实合规检查已通过，即将进入发布中心继续确认。",
        color: "success",
      });
      const params = new URLSearchParams({
        tab: "article",
        source: "content-workspace",
        articleId: document.id,
        preparationId: preparation.id,
        title: preparation.title,
        contentType: document.contentType,
      });
      router.push(`/distribution?${params.toString()}`);
    } catch (error) {
      setActiveStep("review");
      addToast({
        title: "尚未达到发布准备条件",
        description: toPublicError(error, "请先完成正式版本、合规检查和必要的人工审核。"),
        color: "warning",
      });
    } finally {
      setPreparing(false);
    }
  };

  const versionViews = useMemo(() => versions.map(versionToView), [versions]);

  return (
    <main
      aria-label="内容工作室"
      className="min-h-full overflow-hidden rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]"
    >
      <WorkspaceHeader
        creating={creating}
        disabled={!document}
        lastSavedAt={lastSavedAt}
        saveState={saveState}
        title={document?.title || ""}
        onCreate={createDraft}
        onSave={() => void saveNow()}
      />

      {loadFailed && !queue.length ? (
        <div className="flex min-h-[560px] flex-col items-center justify-center px-6 text-center">
          <RefreshCw aria-hidden="true" className="h-8 w-8 text-danger-400" />
          <h2 className="mt-4 text-base font-semibold text-foreground">内容服务暂时不可用</h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-default-500">
            页面没有创建本地假草稿。恢复内容服务后重试，已有文章和保存状态不会被覆盖。
          </p>
          <V2PrimaryButton
            className="mt-5"
            icon={RefreshCw}
            onClick={() => void refreshQueue(keyword)}
          >
            重新加载
          </V2PrimaryButton>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-3">
          <WorkspaceMobileTools
            activePanel={mobilePanel}
            contextContent={
              <WorkspaceContext
                brandVoice={brandVoice}
                idPrefix="workspace-context-mobile"
                knowledge={knowledge}
                materials={materials}
                value={editorValue}
                variant="drawer"
                onBrandVoiceChange={setBrandVoice}
                onInsertMaterial={(material) => {
                  insertMaterial(material);
                  setMobilePanel(null);
                }}
              />
            }
            onPanelChange={setMobilePanel}
          />

          {document || documentLoading ? (
            <ContentEditor
              activeStep={activeStep}
              candidate={candidate}
              canPrepare={canPrepare}
              confirmingOutline={confirmingOutline}
              hasUnsavedChanges={hasUnsavedChanges}
              loading={documentLoading}
              mobilePanelOpen={Boolean(mobilePanel)}
              officialLoadingVersionId={officialLoadingVersionId}
              prepareHint={prepareHint}
              preparing={preparing}
              saveState={saveState}
              value={editorValue}
              versions={versionViews}
              onApplyRulePreview={applyRulePreview}
              onChange={(nextValue) => {
                valueRef.current = nextValue;
                setEditorValue(nextValue);
                setCandidate(null);
              }}
              onDismissCandidate={() => setCandidate(null)}
              onConfirmOutline={() => void confirmOutline()}
              onPrepare={() => void preparePublish()}
              onPreviewRules={() => previewLocalRules()}
              onSetOfficialVersion={(versionId) =>
                void setOfficialVersion(versionId)
              }
              onSave={() => void saveNow()}
              onStepChange={setActiveStep}
            />
          ) : (
            <>
              {queueLoading ? (
                <section
                  aria-label="内容编辑工作区"
                  className="order-1 flex min-h-[560px] items-center justify-center rounded-[6px] border border-divider bg-content1 px-6 text-center lg:order-2"
                >
                  <Spinner label="正在加载内容" size="sm" />
                </section>
              ) : (
                <section
                  aria-label="内容编辑工作区"
                  className="order-1 flex min-h-[560px] items-center justify-center rounded-[6px] border border-divider bg-content1 px-6 text-center lg:order-2"
                >
                  <EmptyState
                    actions={
                      <V2PrimaryButton
                        icon={FilePlus2}
                        loading={creating}
                        onClick={createDraft}
                      >
                        新建内容草稿
                      </V2PrimaryButton>
                    }
                    description="不需要先理解全部功能。先新建草稿或从左侧队列选择内容，再按“简报 → 大纲 → 正文 → 多平台 → 审核”推进。"
                    headingLevel={2}
                    icon={<ClipboardList className="h-6 w-6" />}
                    isCompact={false}
                    title="从一个明确任务开始"
                  />
                </section>
              )}
            </>
          )}

        </div>
      )}
      {modal}
    </main>
  );
}
