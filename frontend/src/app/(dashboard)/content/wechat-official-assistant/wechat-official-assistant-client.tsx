"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Textarea,
  Tooltip,
  addToast,
} from "@heroui/react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileCode2,
  LockKeyhole,
  MonitorCheck,
  Newspaper,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import {
  agentWakerApi,
  type AgentWakerRun,
  type AgentWakerRunStatus,
} from "@/lib/api/agentwaker";
import { toPublicError } from "@/lib/public-error";
import {
  publishingApi,
  type JpagePreviewReceipt,
  type PublishAccount,
} from "@/lib/api/publishing";

const STATUS_COLOR: Record<
  AgentWakerRunStatus,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  draft: "default",
  running: "primary",
  waiting_for_confirmation: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "default",
};

const STEP_PROGRESS: Record<AgentWakerRun["currentStep"], number> = {
  input: 10,
  generation: 55,
  approval: 85,
  handoff: 100,
  failed: 100,
};

const initialForm = {
  goal: "",
  accountName: "",
  product: "",
  audience: "",
  author: "",
  tone: "专业、清楚、证据优先",
  keywords: "",
  sourceUrl: "",
  sourceMaterials: "",
};

function splitList(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function isActive(
  run: AgentWakerRun | null,
): run is AgentWakerRun & { status: "draft" | "running" } {
  return run?.status === "draft" || run?.status === "running";
}

function rememberRun(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("runId", runId);
  window.history.replaceState(null, "", url);
}

export function WechatOfficialAssistantClient() {
  const [form, setForm] = useState(initialForm);
  const [runs, setRuns] = useState<AgentWakerRun[]>([]);
  const [currentRun, setCurrentRun] = useState<AgentWakerRun | null>(null);
  const [roleAvailable, setRoleAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [executingRunId, setExecutingRunId] = useState("");
  const [historyBusyId, setHistoryBusyId] = useState("");
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [jpageAccounts, setJpageAccounts] = useState<PublishAccount[]>([]);
  const [jpageAccountId, setJpageAccountId] = useState("");
  const [jpageUploadConfirmationId, setJpageUploadConfirmationId] =
    useState("");
  const [jpageRenderConfirmationId, setJpageRenderConfirmationId] =
    useState("");
  const [jpagePreview, setJpagePreview] = useState<{
    ready: boolean;
    receipt: JpagePreviewReceipt | null;
  } | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState("");
  const [deliveryReloadKey, setDeliveryReloadKey] = useState(0);
  const [draftConfirmationId, setDraftConfirmationId] = useState("");
  const [draftReadbackConfirmationId, setDraftReadbackConfirmationId] =
    useState("");
  const [draftResult, setDraftResult] = useState<{
    publishRecordId: string;
    mediaId: string;
    readback: { matched: boolean };
  } | null>(null);
  const [publishConfirmationId, setPublishConfirmationId] = useState("");
  const [publishResult, setPublishResult] = useState<{
    publishRecordId: string;
    publishId: string;
    status: string;
    articleUrl?: string;
  } | null>(null);
  const selectedRunIdRef = useRef("");

  const refresh = useCallback(async () => {
    const [roles, result] = await Promise.all([
      agentWakerApi.roles(),
      agentWakerApi.runs(60),
    ]);
    setRoleAvailable(
      roles.some(
        (role) =>
          role.id === "wechat-official-account-operator" && role.available,
      ),
    );
    const channelRuns = result.runs.filter(
      (run) => run.role === "wechat-official-account-operator",
    );
    setRuns(channelRuns);
    return channelRuns;
  }, []);

  const currentRunId = currentRun?.runId;
  const activeRunId = isActive(currentRun) ? currentRun.runId : "";
  const refreshView = useCallback(async () => {
    const items = await refresh();
    const targetId =
      currentRunId && items.some((item) => item.runId === currentRunId)
        ? currentRunId
        : items[0]?.runId;
    const detail = targetId ? await agentWakerApi.run(targetId) : null;
    selectedRunIdRef.current = detail?.runId || "";
    setCurrentRun(detail);
    setDeliveryReloadKey((value) => value + 1);
  }, [currentRunId, refresh]);

  useEffect(() => {
    let active = true;
    void refresh()
      .then(async (items) => {
        if (!active || !items[0]) return;
        const requestedRunId = new URLSearchParams(window.location.search).get(
          "runId",
        );
        const selected =
          items.find((item) => item.runId === requestedRunId) || items[0];
        const detail = await agentWakerApi.run(selected.runId);
        if (active) {
          selectedRunIdRef.current = detail.runId;
          setCurrentRun(detail);
        }
      })
      .catch((error) => {
        if (!active) return;
        addToast({
          title: "公众号助理加载失败",
          description: toPublicError(error, "请检查 3011 服务后重试。"),
          color: "danger",
        });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    void publishingApi
      .getAccounts({ source: "api" })
      .then((items) => {
        const wechatAccounts = items.filter(
          (item) => item.platform === "wechat",
        );
        const previewAccounts = items.filter(
          (item) => item.platform === "jpage",
        );
        setAccounts(wechatAccounts);
        setJpageAccounts(previewAccounts);
        setAccountId((current) => current || wechatAccounts[0]?.id || "");
        setJpageAccountId((current) => current || previewAccounts[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setJpageUploadConfirmationId("");
    setJpageRenderConfirmationId("");
    setJpagePreview(null);
    const articleId = currentRun?.output?.articleId;
    if (!articleId) return () => undefined;
    void publishingApi
      .getJpagePreview(articleId)
      .then((result) => {
        if (active) {
          setJpagePreview({ ready: result.ready, receipt: result.receipt });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentRun?.output?.articleId, deliveryReloadKey]);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void agentWakerApi
        .run(activeRunId)
        .then((run) => {
          if (cancelled || selectedRunIdRef.current !== activeRunId) return;
          setCurrentRun(run);
          if (!isActive(run)) void refresh();
        })
        .catch(() => undefined);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, refresh]);

  useEffect(() => {
    let active = true;
    setDraftConfirmationId("");
    setDraftReadbackConfirmationId("");
    setDraftResult(null);
    setPublishConfirmationId("");
    setPublishResult(null);
    const articleId = currentRun?.output?.articleId;
    if (!articleId || !accountId) return () => undefined;

    void publishingApi
      .getRecords(articleId)
      .then((records) => {
        if (!active) return;
        const accountRecords = records.filter(
          (record) =>
            record.accountId === accountId && record.platform === "wechat",
        );
        const draftRecord = accountRecords.find(
          (record) =>
            record.payloadJson?.operation === "wechat-official-draft-create",
        );
        const draftData = draftRecord?.resultJson;
        const readback =
          draftData?.readback && typeof draftData.readback === "object"
            ? (draftData.readback as { matched?: boolean })
            : null;
        if (
          draftRecord &&
          typeof draftData?.mediaId === "string" &&
          typeof readback?.matched === "boolean"
        ) {
          setDraftResult({
            publishRecordId: draftRecord.id,
            mediaId: draftData.mediaId,
            readback: { matched: readback.matched },
          });
        }

        const publishRecord = accountRecords.find(
          (record) =>
            record.payloadJson?.operation === "wechat-official-publish-submit",
        );
        const publishData = publishRecord?.resultJson;
        if (publishRecord && typeof publishData?.status === "string") {
          const articleUrl =
            typeof publishData.articleUrl === "string"
              ? publishData.articleUrl
              : typeof publishRecord.publishUrl === "string" &&
                  publishRecord.publishUrl.startsWith("http")
                ? publishRecord.publishUrl
                : undefined;
          setPublishResult({
            publishRecordId: publishRecord.id,
            publishId:
              typeof publishData.publishId === "string"
                ? publishData.publishId
                : "",
            status: publishData.status,
            articleUrl,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accountId, currentRun?.output?.articleId, deliveryReloadKey]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        roleAvailable &&
        form.goal.trim() &&
        form.product.trim() &&
        form.audience.trim(),
      ),
    [form.audience, form.goal, form.product, roleAvailable],
  );

  const startExecution = (runId: string) => {
    if (executingRunId === runId) return;
    setExecutingRunId(runId);
    void agentWakerApi
      .executeRun(runId)
      .then((run) => {
        if (selectedRunIdRef.current === runId) setCurrentRun(run);
        void refresh();
        addToast({
          title: "公众号文章包已生成",
          description: "正文、微信 HTML 和来源账本已写入文章库。",
          color: "success",
        });
      })
      .catch((error) => {
        addToast({
          title: "公众号任务执行失败",
          description: toPublicError(error, "可在当前页面重试任务。"),
          color: "danger",
        });
        void agentWakerApi
          .run(runId)
          .then((run) => {
            if (selectedRunIdRef.current === runId) setCurrentRun(run);
          })
          .catch(() => undefined);
      })
      .finally(() => setExecutingRunId(""));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await agentWakerApi.createRun({
        role: "wechat-official-account-operator",
        workflow: "article-pipeline",
        goal: form.goal.trim(),
        inputs: {
          brand: form.accountName.trim(),
          accountName: form.accountName.trim(),
          product: form.product.trim(),
          audience: form.audience.trim(),
          author: form.author.trim(),
          tone: form.tone.trim(),
          keywords: splitList(form.keywords),
          sourceUrl: form.sourceUrl.trim(),
          sourceMaterials: splitList(form.sourceMaterials),
        },
      });
      selectedRunIdRef.current = created.runId;
      setCurrentRun(created);
      rememberRun(created.runId);
      setRuns((items) => [created, ...items]);
      startExecution(created.runId);
    } catch (error) {
      addToast({
        title: "任务创建失败",
        description: toPublicError(error, "请检查输入和角色配置。"),
        color: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openRun = async (runId: string) => {
    const previousRunId = selectedRunIdRef.current;
    selectedRunIdRef.current = runId;
    setHistoryBusyId(runId);
    try {
      setCurrentRun(await agentWakerApi.run(runId));
      rememberRun(runId);
    } catch (error) {
      selectedRunIdRef.current = previousRunId;
      addToast({
        title: "任务读取失败",
        description: toPublicError(error, "请稍后重试。"),
        color: "danger",
      });
    } finally {
      setHistoryBusyId("");
    }
  };

  const prepareJpagePreview = async () => {
    if (!currentRun?.output || !jpageAccountId) return;
    setDeliveryBusy("jpage-confirmation");
    try {
      const result = await publishingApi.createJpagePreviewConfirmation(
        currentRun.output.articleId,
        jpageAccountId,
      );
      setJpageUploadConfirmationId(result.confirmationId);
    } catch (error) {
      setJpageUploadConfirmationId("");
      addToast({
        title: "私有预览确认创建失败",
        description: toPublicError(error, "请检查内容审批和公众号文章授权。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const uploadJpagePreview = async () => {
    if (!currentRun?.output || !jpageAccountId || !jpageUploadConfirmationId)
      return;
    setDeliveryBusy("jpage-upload");
    try {
      const result = await publishingApi.createJpagePreview(
        currentRun.output.articleId,
        jpageAccountId,
        jpageUploadConfirmationId,
      );
      setJpagePreview(result);
      setJpageUploadConfirmationId("");
      addToast({
        title: "公众号文章私有预览已校验",
        description: "Markdown 与 HTML 内容、哈希和私有状态一致。",
        color: "success",
      });
    } catch (error) {
      setJpageUploadConfirmationId("");
      addToast({
        title: "公众号文章私有预览上传失败",
        description: toPublicError(
          error,
          "不会进入公众号草稿，请核对远端状态后重试。",
        ),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const prepareJpageRenderVerification = async () => {
    if (!currentRun?.output || !jpagePreview?.receipt) return;
    setDeliveryBusy("jpage-render-confirmation");
    try {
      const result = await publishingApi.createJpageRemoteRenderConfirmation(
        currentRun.output.articleId,
      );
      setJpageRenderConfirmationId(result.confirmationId);
    } catch (error) {
      setJpageRenderConfirmationId("");
      addToast({
        title: "远程渲染确认创建失败",
        description: toPublicError(error, "请重新打开私有预览后再确认。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const confirmJpageRenderVerification = async () => {
    if (!currentRun?.output || !jpageRenderConfirmationId) return;
    setDeliveryBusy("jpage-render-confirm");
    try {
      const result = await publishingApi.confirmJpageRemoteRender(
        currentRun.output.articleId,
        jpageRenderConfirmationId,
      );
      setJpagePreview(result);
      setJpageRenderConfirmationId("");
      addToast({
        title: "公众号文章移动端渲染已确认",
        color: "success",
      });
    } catch (error) {
      setJpageRenderConfirmationId("");
      addToast({
        title: "远程渲染确认失败",
        description: toPublicError(error, "请重新校验私有预览后重试。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const prepareOfficialDraft = async () => {
    if (!currentRun?.output || !accountId) return;
    setDeliveryBusy("draft-confirmation");
    try {
      const result = await publishingApi.createWechatDraftConfirmation(
        currentRun.output.articleId,
        accountId,
        currentRun.inputs.sourceUrl || undefined,
      );
      setDraftConfirmationId(result.confirmationId);
    } catch (error) {
      setDraftConfirmationId("");
      addToast({
        title: "草稿确认创建失败",
        description: toPublicError(error, "请检查内容审批、账号和封面素材。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const saveOfficialDraft = async () => {
    if (!currentRun?.output || !accountId || !draftConfirmationId) return;
    setDeliveryBusy("draft");
    try {
      const result = await publishingApi.createWechatDraft(
        currentRun.output.articleId,
        accountId,
        draftConfirmationId,
        currentRun.inputs.sourceUrl || undefined,
      );
      setDraftResult(result);
      setDraftConfirmationId("");
      addToast({
        title: result.readback.matched
          ? "公众号草稿已保存并校验"
          : "公众号草稿已保存，等待平台对账",
        description: result.readback.failureReason,
        color: result.readback.matched ? "success" : "warning",
      });
    } catch (error) {
      setDraftConfirmationId("");
      setDeliveryReloadKey((value) => value + 1);
      addToast({
        title: "保存公众号草稿失败",
        description: toPublicError(error, "发布记录已保留，请先核对后再操作。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const prepareDraftReadback = async () => {
    if (!draftResult || draftResult.readback.matched) return;
    setDeliveryBusy("draft-readback-confirmation");
    try {
      const result = await publishingApi.createWechatDraftReadbackConfirmation(
        draftResult.publishRecordId,
      );
      setDraftReadbackConfirmationId(result.confirmationId);
    } catch (error) {
      setDraftReadbackConfirmationId("");
      addToast({
        title: "草稿校验失败，未能成功创建",
        description: toPublicError(error, "请检查草稿记录后重试。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const reconcileDraftReadback = async () => {
    if (!draftResult || !draftReadbackConfirmationId) return;
    setDeliveryBusy("draft-readback");
    try {
      const result = await publishingApi.reconcileWechatDraft(
        draftResult.publishRecordId,
        draftReadbackConfirmationId,
      );
      setDraftResult({
        publishRecordId: result.publishRecordId,
        mediaId: result.mediaId,
        readback: { matched: result.readback.matched },
      });
      setDraftReadbackConfirmationId("");
      setDeliveryReloadKey((value) => value + 1);
      addToast({
        title: result.readback.matched
          ? "草稿校验通过"
          : "草稿仍未通过校验",
        description: result.readback.failureReason,
        color: result.readback.matched ? "success" : "warning",
      });
    } catch (error) {
      setDraftReadbackConfirmationId("");
      addToast({
        title: "草稿对账失败",
        description: toPublicError(
          error,
          "不会重复创建草稿，请稍后重新申请校验。",
        ),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const prepareOfficialPublish = async () => {
    if (!currentRun?.output || !accountId || !draftResult?.readback.matched)
      return;
    setDeliveryBusy("publish-confirmation");
    try {
      const result = await publishingApi.createWechatPublishConfirmation(
        currentRun.output.articleId,
        accountId,
        draftResult.mediaId,
      );
      setPublishConfirmationId(result.confirmationId);
    } catch (error) {
      setPublishConfirmationId("");
      addToast({
        title: "发布确认创建失败",
        description: toPublicError(error, "请检查草稿和账号状态。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const submitOfficialPublish = async () => {
    if (
      !currentRun?.output ||
      !accountId ||
      !draftResult ||
      !publishConfirmationId
    )
      return;
    setDeliveryBusy("publish");
    try {
      const result = await publishingApi.submitWechatPublish(
        currentRun.output.articleId,
        accountId,
        draftResult.mediaId,
        publishConfirmationId,
      );
      setPublishResult(result);
      setPublishConfirmationId("");
      addToast({ title: "公众号发布任务已提交", color: "success" });
    } catch (error) {
      setPublishConfirmationId("");
      setDeliveryReloadKey((value) => value + 1);
      addToast({
        title: "发布提交待核对",
        description: toPublicError(
          error,
          "不要直接重试，请使用状态回查确认平台结果。",
        ),
        color: "warning",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  const refreshOfficialPublish = async () => {
    if (!publishResult) return;
    setDeliveryBusy("refresh");
    try {
      const result = await publishingApi.refreshWechatPublish(
        publishResult.publishRecordId,
      );
      setPublishResult((current) =>
        current ? { ...current, ...result } : current,
      );
    } catch (error) {
      addToast({
        title: "发布状态回查失败",
        description: toPublicError(error, "请稍后再次回查。"),
        color: "danger",
      });
    } finally {
      setDeliveryBusy("");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center">
        <Spinner label="正在加载公众号运营助理" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-3 border-b border-divider pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-default-500">
            <Newspaper className="h-4 w-4" />
            AgentWaker / Weaver
          </div>
          <h1 className="text-[24px] font-semibold">公众号运营助理</h1>
        </div>
        <div className="flex items-center gap-2">
          <Chip
            color={roleAvailable ? "success" : "danger"}
            size="sm"
            startContent={
              roleAvailable ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )
            }
            variant="flat"
          >
            {roleAvailable ? "角色已就绪" : "角色不可用"}
          </Chip>
          <Tooltip content="刷新任务">
            <Button
              isIconOnly
              aria-label="刷新任务"
              size="sm"
              variant="light"
              onPress={() => void refreshView()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)]">
        <section className="h-fit rounded-[8px] border border-divider bg-background p-4">
          <div className="mb-4 flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-primary" />
            <h2 className="text-[15px] font-semibold">创建文章流水线</h2>
          </div>
          <div className="space-y-3">
            <Textarea
              isRequired
              label="运营目标"
              minRows={2}
              value={form.goal}
              onValueChange={(goal) => setForm((value) => ({ ...value, goal }))}
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Input
                label="公众号或品牌"
                value={form.accountName}
                onValueChange={(accountName) =>
                  setForm((value) => ({ ...value, accountName }))
                }
              />
              <Input
                isRequired
                label="文章主题"
                value={form.product}
                onValueChange={(product) =>
                  setForm((value) => ({ ...value, product }))
                }
              />
            </div>
            <Input
              isRequired
              label="目标读者"
              value={form.audience}
              onValueChange={(audience) =>
                setForm((value) => ({ ...value, audience }))
              }
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Input
                label="作者"
                value={form.author}
                onValueChange={(author) =>
                  setForm((value) => ({ ...value, author }))
                }
              />
              <Select
                label="写作语气"
                selectedKeys={[form.tone]}
                onSelectionChange={(keys) => {
                  const tone = String(Array.from(keys)[0] || form.tone);
                  setForm((value) => ({ ...value, tone }));
                }}
              >
                <SelectItem key="专业、清楚、证据优先">专业严谨</SelectItem>
                <SelectItem key="深入浅出、步骤明确">教程讲解</SelectItem>
                <SelectItem key="观点鲜明、克制可信">行业观点</SelectItem>
              </Select>
            </div>
            <Input
              label="关键词"
              value={form.keywords}
              onValueChange={(keywords) =>
                setForm((value) => ({ ...value, keywords }))
              }
            />
            <Input
              label="规范来源链接"
              placeholder="https://"
              type="url"
              value={form.sourceUrl}
              onValueChange={(sourceUrl) =>
                setForm((value) => ({ ...value, sourceUrl }))
              }
            />
            <Textarea
              label="事实与参考素材"
              minRows={4}
              value={form.sourceMaterials}
              onValueChange={(sourceMaterials) =>
                setForm((value) => ({ ...value, sourceMaterials }))
              }
            />
            <Button
              className="w-full"
              color="primary"
              isDisabled={
                !canSubmit || Boolean(executingRunId) || isActive(currentRun)
              }
              isLoading={submitting}
              startContent={
                submitting ? null : <WandSparkles className="h-4 w-4" />
              }
              onPress={() => void submit()}
            >
              生成公众号文章包
            </Button>
          </div>
        </section>

        <section className="min-w-0 rounded-[8px] border border-divider bg-background">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <div>
              <h2 className="text-[15px] font-semibold">文章与移动预览</h2>
              {currentRun ? (
                <p className="mt-0.5 text-[11px] text-default-400">
                  {formatTime(currentRun.updatedAt)}
                </p>
              ) : null}
            </div>
            {currentRun ? (
              <Chip
                color={STATUS_COLOR[currentRun.status]}
                size="sm"
                variant="flat"
              >
                {currentRun.statusLabel}
              </Chip>
            ) : null}
          </div>
          {!currentRun ? (
            <div className="flex min-h-[560px] flex-col items-center justify-center px-6 text-center">
              <FileCode2 className="h-9 w-9 text-default-300" />
              <p className="mt-3 text-[14px] font-medium text-default-600">
                暂无公众号文章产物
              </p>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-[11px] text-default-500">
                  <span>{currentRun.nextAction}</span>
                  <span>{STEP_PROGRESS[currentRun.currentStep]}%</span>
                </div>
                <Progress
                  aria-label="任务进度"
                  color={currentRun.status === "failed" ? "danger" : "primary"}
                  size="sm"
                  value={STEP_PROGRESS[currentRun.currentStep]}
                />
              </div>
              {isActive(currentRun) ? (
                <div className="flex min-h-[360px] items-center justify-center gap-3 text-[13px] text-default-500">
                  <Spinner size="sm" />
                  <span>任务在后台执行，刷新页面不会丢失进度</span>
                </div>
              ) : currentRun.output ? (
                <>
                  <WechatRunOutput run={currentRun} />
                  <JpagePreviewPanel
                    accounts={jpageAccounts}
                    accountId={jpageAccountId}
                    busy={deliveryBusy}
                    preview={jpagePreview}
                    renderConfirmationId={jpageRenderConfirmationId}
                    run={currentRun}
                    uploadConfirmationId={jpageUploadConfirmationId}
                    onAccountChange={(value) => {
                      setJpageAccountId(value);
                      setJpageUploadConfirmationId("");
                    }}
                    onConfirmRender={() =>
                      void confirmJpageRenderVerification()
                    }
                    onPrepareRender={() =>
                      void prepareJpageRenderVerification()
                    }
                    onPrepareUpload={() => void prepareJpagePreview()}
                    onUpload={() => void uploadJpagePreview()}
                  />
                  <WechatDeliveryPanel
                    accountId={accountId}
                    accounts={accounts}
                    busy={deliveryBusy}
                    draftConfirmationId={draftConfirmationId}
                    draftReadbackConfirmationId={draftReadbackConfirmationId}
                    draftResult={draftResult}
                    publishConfirmationId={publishConfirmationId}
                    publishResult={publishResult}
                    run={currentRun}
                    jpageReady={jpagePreview?.ready === true}
                    onAccountChange={setAccountId}
                    onPrepareDraft={() => void prepareOfficialDraft()}
                    onPrepareDraftReadback={() => void prepareDraftReadback()}
                    onPreparePublish={() => void prepareOfficialPublish()}
                    onRefreshPublish={() => void refreshOfficialPublish()}
                    onSaveDraft={() => void saveOfficialDraft()}
                    onReconcileDraftReadback={() =>
                      void reconcileDraftReadback()
                    }
                    onSubmitPublish={() => void submitOfficialPublish()}
                  />
                </>
              ) : currentRun.failureReason ? (
                <div className="space-y-3 border-l-2 border-danger bg-danger-50 px-3 py-3 text-[13px] text-danger-700">
                  <p>{currentRun.failureReason}</p>
                  <Button
                    color="danger"
                    isLoading={executingRunId === currentRun.runId}
                    size="sm"
                    startContent={<RotateCcw className="h-4 w-4" />}
                    variant="flat"
                    onPress={() => startExecution(currentRun.runId)}
                  >
                    重试任务
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-[8px] border border-divider bg-background">
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-default-500" />
            <h2 className="text-[15px] font-semibold">最近公众号任务</h2>
          </div>
          <span className="text-[11px] text-default-400">{runs.length} 条</span>
        </div>
        <div className="divide-y divide-divider">
          {runs.map((run) => (
            <button
              key={run.runId}
              className="grid w-full gap-2 px-4 py-3 text-left hover:bg-default-50 sm:grid-cols-[minmax(0,1fr)_120px_110px] sm:items-center"
              type="button"
              onClick={() => void openRun(run.runId)}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">
                  {run.goal}
                </span>
                <span className="block truncate text-[11px] text-default-400">
                  {run.inputs.product || "未填写主题"}
                </span>
              </span>
              <Chip color={STATUS_COLOR[run.status]} size="sm" variant="flat">
                {run.statusLabel}
              </Chip>
              <span className="flex items-center justify-end gap-2 text-[11px] text-default-400">
                {historyBusyId === run.runId ? <Spinner size="sm" /> : null}
                {formatTime(run.updatedAt)}
              </span>
            </button>
          ))}
          {!runs.length ? (
            <div className="px-4 py-8 text-center text-[13px] text-default-400">
              暂无任务记录
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function JpagePreviewPanel({
  run,
  accounts,
  accountId,
  busy,
  preview,
  uploadConfirmationId,
  renderConfirmationId,
  onAccountChange,
  onPrepareUpload,
  onUpload,
  onPrepareRender,
  onConfirmRender,
}: {
  run: AgentWakerRun;
  accounts: PublishAccount[];
  accountId: string;
  busy: string;
  preview: { ready: boolean; receipt: JpagePreviewReceipt | null } | null;
  uploadConfirmationId: string;
  renderConfirmationId: string;
  onAccountChange: (value: string) => void;
  onPrepareUpload: () => void;
  onUpload: () => void;
  onPrepareRender: () => void;
  onConfirmRender: () => void;
}) {
  const account = accounts.find((item) => item.id === accountId);
  const accountReady = Boolean(
    account?.status === "ready" &&
    account.hasApiToken &&
    account.config?.baseUrl,
  );
  const receipt = preview?.receipt;
  return (
    <div className="mt-5 space-y-3 border-t border-divider pt-5">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <LockKeyhole className="h-4 w-4 text-default-500" />
        公众号文章私有双文件预览
      </div>
      {accounts.length ? (
        <Select
          label="公众号文章授权"
          selectedKeys={accountId ? [accountId] : []}
          size="sm"
          onSelectionChange={(keys) =>
            onAccountChange(String(Array.from(keys)[0] || ""))
          }
        >
          {accounts.map((item) => (
            <SelectItem key={item.id}>{item.name}</SelectItem>
          ))}
        </Select>
      ) : (
        <Button as={Link} href="/platforms" size="sm" variant="flat">
          配置公众号文章授权
        </Button>
      )}
      {account && !accountReady ? (
        <div className="border-l-2 border-warning bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          该公众号文章授权未就绪，或缺少访问凭证、对外地址。
        </div>
      ) : null}
      {receipt ? (
        <div
          className={`space-y-2 border-l-2 px-3 py-3 text-[12px] ${preview?.ready ? "border-success bg-success-50 text-success-700" : "border-warning bg-warning-50 text-warning-700"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Markdown #{receipt.markdown.id} · HTML #{receipt.html.id} · 私有
            </span>
            <div className="flex gap-2">
              <Button
                as="a"
                href={receipt.markdown.authenticatedRenderUrl}
                rel="noreferrer"
                size="sm"
                target="_blank"
                variant="flat"
              >
                Markdown
              </Button>
              <Button
                as="a"
                href={receipt.html.authenticatedRenderUrl}
                rel="noreferrer"
                size="sm"
                target="_blank"
                variant="flat"
              >
                HTML
              </Button>
            </div>
          </div>
          <p>
            内容校验：通过 · 远程渲染：
            {receipt.remoteRenderGate === "pass" ? "通过" : "待确认"}
          </p>
          {!preview?.ready ? (
            renderConfirmationId ? (
              <Button
                color="warning"
                isLoading={busy === "jpage-render-confirm"}
                size="sm"
                startContent={<MonitorCheck className="h-4 w-4" />}
                onPress={onConfirmRender}
              >
                确认远程移动预览
              </Button>
            ) : (
              <Button
                isLoading={busy === "jpage-render-confirmation"}
                size="sm"
                variant="flat"
                onPress={onPrepareRender}
              >
                申请渲染确认
              </Button>
            )
          ) : null}
        </div>
      ) : run.status === "completed" && accountReady ? (
        uploadConfirmationId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-warning-50 px-3 py-3 text-[12px] text-warning-700">
            <span>即将上传当前锁定版本的 Markdown 与 HTML，保持私有。</span>
            <Button
              color="warning"
              isLoading={busy === "jpage-upload"}
              size="sm"
              onPress={onUpload}
            >
              确认私有上传
            </Button>
          </div>
        ) : (
          <Button
            isLoading={busy === "jpage-confirmation"}
            size="sm"
            variant="flat"
            onPress={onPrepareUpload}
          >
            申请私有预览上传
          </Button>
        )
      ) : null}
    </div>
  );
}

function WechatDeliveryPanel({
  run,
  accounts,
  accountId,
  busy,
  draftConfirmationId,
  draftReadbackConfirmationId,
  draftResult,
  publishConfirmationId,
  publishResult,
  jpageReady,
  onAccountChange,
  onPrepareDraft,
  onPrepareDraftReadback,
  onSaveDraft,
  onReconcileDraftReadback,
  onPreparePublish,
  onSubmitPublish,
  onRefreshPublish,
}: {
  run: AgentWakerRun;
  accounts: PublishAccount[];
  accountId: string;
  busy: string;
  draftConfirmationId: string;
  draftReadbackConfirmationId: string;
  draftResult: {
    publishRecordId: string;
    mediaId: string;
    readback: { matched: boolean };
  } | null;
  publishConfirmationId: string;
  publishResult: {
    publishRecordId: string;
    publishId: string;
    status: string;
    articleUrl?: string;
  } | null;
  jpageReady: boolean;
  onAccountChange: (value: string) => void;
  onPrepareDraft: () => void;
  onPrepareDraftReadback: () => void;
  onSaveDraft: () => void;
  onReconcileDraftReadback: () => void;
  onPreparePublish: () => void;
  onSubmitPublish: () => void;
  onRefreshPublish: () => void;
}) {
  const account = accounts.find((item) => item.id === accountId);
  const accountReady = Boolean(
    account?.status === "ready" &&
    account.hasApiToken &&
    account.config?.defaultThumbMediaId,
  );
  return (
    <div className="mt-5 space-y-3 border-t border-divider pt-5">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Newspaper className="h-4 w-4 text-default-500" />
        微信官方草稿与发布
      </div>
      {accounts.length ? (
        <Select
          label="目标公众号"
          selectedKeys={accountId ? [accountId] : []}
          size="sm"
          onSelectionChange={(keys) =>
            onAccountChange(String(Array.from(keys)[0] || ""))
          }
        >
          {accounts.map((item) => (
            <SelectItem key={item.id}>{item.name}</SelectItem>
          ))}
        </Select>
      ) : (
        <Button as={Link} href="/platforms" size="sm" variant="flat">
          配置公众号账号
        </Button>
      )}
      {account && !accountReady ? (
        <div className="border-l-2 border-warning bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          该账号未就绪，或缺少访问凭证、默认封面
          media_id，请先到平台授权补齐。
        </div>
      ) : null}
      {run.status !== "completed" ? (
        <div className="flex items-center justify-between gap-3 border-l-2 border-warning bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          <span>内容审批通过后，才允许写入公众号草稿箱。</span>
          <Button
            as={Link}
            href="/tasks/confirmations"
            size="sm"
            variant="flat"
          >
            去审批
          </Button>
        </div>
      ) : null}
      {run.status === "completed" && !jpageReady ? (
        <div className="border-l-2 border-warning bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          公众号文章私有双文件预览尚未完成校验与移动端渲染确认，草稿写入已阻止。
        </div>
      ) : null}
      {run.status === "completed" &&
      accountReady &&
      jpageReady &&
      !draftResult ? (
        draftConfirmationId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-warning-50 px-3 py-3 text-[12px] text-warning-700">
            <span>即将把当前锁定版本写入“{account?.name}”草稿箱。</span>
            <Button
              color="warning"
              isLoading={busy === "draft"}
              size="sm"
              onPress={onSaveDraft}
            >
              确认保存草稿
            </Button>
          </div>
        ) : (
          <Button
            isLoading={busy === "draft-confirmation"}
            size="sm"
            variant="flat"
            onPress={onPrepareDraft}
          >
            申请草稿写入确认
          </Button>
        )
      ) : null}
      {draftResult ? (
        <div className="space-y-2 border-l-2 border-success bg-success-50 px-3 py-3 text-[12px] text-success-700">
          <p>
            草稿已保存并校验：{draftResult.mediaId}；标题匹配：
            {draftResult.readback.matched ? "是" : "否"}
          </p>
          {!draftResult.readback.matched ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-warning-700">
              <span>
                草稿尚未通过标题和正文校验，正式发布已阻止；对账不会重复创建草稿。
              </span>
              {draftReadbackConfirmationId ? (
                <Button
                  color="warning"
                  isLoading={busy === "draft-readback"}
                  size="sm"
                  onPress={onReconcileDraftReadback}
                >
                  确认对账
                </Button>
              ) : (
                <Button
                  isLoading={busy === "draft-readback-confirmation"}
                  size="sm"
                  variant="flat"
                  onPress={onPrepareDraftReadback}
                >
                  申请草稿校验
                </Button>
              )}
            </div>
          ) : !publishResult ? (
            publishConfirmationId ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-danger-700">
                <span>正式发布是独立高风险动作，确认后将提交微信审核。</span>
                <Button
                  color="danger"
                  isLoading={busy === "publish"}
                  size="sm"
                  onPress={onSubmitPublish}
                >
                  确认正式发布
                </Button>
              </div>
            ) : (
              <Button
                color="danger"
                isLoading={busy === "publish-confirmation"}
                size="sm"
                variant="flat"
                onPress={onPreparePublish}
              >
                申请正式发布确认
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {publishResult ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary-50 px-3 py-3 text-[12px] text-primary-700">
          <span>
            发布任务：{publishResult.publishId}；状态：{publishResult.status}
          </span>
          <div className="flex gap-2">
            {publishResult.articleUrl ? (
              <Button
                as="a"
                href={publishResult.articleUrl}
                rel="noreferrer"
                size="sm"
                target="_blank"
                variant="flat"
              >
                查看文章
              </Button>
            ) : null}
            <Button
              isLoading={busy === "refresh"}
              size="sm"
              startContent={<RefreshCw className="h-4 w-4" />}
              variant="flat"
              onPress={onRefreshPublish}
            >
              回查状态
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WechatRunOutput({ run }: { run: AgentWakerRun }) {
  const output = run.output!;
  const checklistItems = Array.isArray(run.checklist?.items)
    ? run.checklist.items
    : [];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[20px] font-semibold leading-8">{output.title}</h3>
        <p className="mt-2 text-[13px] leading-6 text-default-600">
          {output.digest}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-default-400">
          {output.author ? <span>作者：{output.author}</span> : null}
          <span>{output.wordCount} 字符</span>
          <span>{output.sourceLedger.length} 条来源</span>
        </div>
      </div>

      {output.finalHtml ? (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <FileCode2 className="h-4 w-4 text-default-500" />
            微信移动预览
          </div>
          <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[8px] border border-divider bg-white">
            <iframe
              className="h-[640px] w-full bg-white"
              referrerPolicy="no-referrer"
              sandbox=""
              srcDoc={output.finalHtml}
              title="微信公众号文章移动预览"
            />
          </div>
        </div>
      ) : null}

      {output.sourceLedger.length ? (
        <div className="border-t border-divider pt-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <BookOpenCheck className="h-4 w-4 text-default-500" />
            来源账本
          </div>
          <div className="space-y-2">
            {output.sourceLedger.map((source, index) => (
              <div key={`${source.title}-${index}`} className="text-[12px]">
                <div className="font-medium text-default-700">
                  {source.title}
                </div>
                <div className="mt-0.5 text-default-500">{source.evidence}</div>
                {source.url ? (
                  <a
                    className="mt-0.5 inline-flex items-center gap-1 text-primary"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    查看来源 <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-divider pt-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
          <ShieldCheck className="h-4 w-4 text-default-500" />
          草稿与发布检查
        </div>
        <div className="space-y-2">
          {checklistItems.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2 text-[12px]"
            >
              {item.status === "ready" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        {run.risks.length ? (
          <div className="mt-3 border-l-2 border-warning bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
            {run.risks.join("；")}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-divider pt-4">
        <Button
          as={Link}
          href={`/content/articles?articleId=${encodeURIComponent(output.articleId)}`}
          variant="flat"
        >
          查看文章库
        </Button>
        {run.status === "waiting_for_confirmation" ? (
          <Button
            as={Link}
            color="warning"
            href="/tasks/confirmations"
            startContent={<ClipboardCheck className="h-4 w-4" />}
          >
            逐项确认
          </Button>
        ) : null}
      </div>
    </div>
  );
}
