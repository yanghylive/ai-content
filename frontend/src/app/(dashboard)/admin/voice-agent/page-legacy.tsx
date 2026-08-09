"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Spinner,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { getApiBase } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import {
  voiceApi,
  type VoiceCommandResult,
  type VoicePairResult,
  type VoiceState,
  type VoiceToolDescriptor,
  type VoiceToolRisk,
} from "@/lib/api/voice";

const sampleCommands = [
  "今天 KAYPAL 状态怎么样",
  "打开待确认",
  "搜索小红书咖啡店获客线索",
  "打开风控页",
  "帮我总结这个本地文件",
];

const riskLabels: Record<VoiceToolRisk, string> = {
  low: "可直接处理",
  medium: "需要留痕",
  high: "需要确认",
};

function getErrorMessage(error: unknown) {
  return toPublicError(error, "当前操作未完成，请稍后重试。");
}

function publicVoiceText(value: string | null | undefined, fallback: string) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (
    /(?:https?:\/\/|localhost|127\.0\.0\.1|\/kaypal-voice\/|\b(?:API|PID|JSON|HTTP)\b|\b[a-f0-9]{32,}\b)/i.test(
      text,
    )
  ) {
    return fallback;
  }
  return text;
}

function riskColor(risk: VoiceToolRisk) {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "success";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

type VoiceApiResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
};

type VoiceRuntimeState =
  | "checking"
  | "starting"
  | "online"
  | "authorizing"
  | "ready"
  | "offline"
  | "error";

export default function VoiceAgentPairingPage() {
  const [state, setState] = React.useState<VoiceState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [runningCommand, setRunningCommand] = React.useState(false);
  const [pairResult, setPairResult] = React.useState<VoicePairResult | null>(null);
  const [commandResult, setCommandResult] =
    React.useState<VoiceCommandResult | null>(null);
  const [commandText, setCommandText] = React.useState(sampleCommands[0]);
  const [runtimeState, setRuntimeState] =
    React.useState<VoiceRuntimeState>("checking");
  const [runtimeMessage, setRuntimeMessage] = React.useState(
    "正在检查本地语音服务",
  );
  const autoSyncAttemptedRef = React.useRef(false);
  const commandInputRef = React.useRef<HTMLInputElement | null>(null);

  const apiBase = React.useMemo(() => getApiBase().replace(/\/$/, ""), []);
  const voiceBase = `${apiBase}/voice`;
  const baiLongmaBase = "http://127.0.0.1:3721";

  const focusCommandInput = React.useCallback(() => {
    commandInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    commandInputRef.current?.focus();
  }, []);

  const loadState = React.useCallback(async () => {
    try {
      setLoading(true);
      const nextState = await voiceApi.state();
      setState(nextState);
    } catch (error) {
      addToast({
        title: "连接状态读取失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadState();
  }, [loadState]);

  const readBaiLongmaStatus = React.useCallback(async () => {
    try {
      const response = await fetch(`${baiLongmaBase}/kaypal-voice/status`);
      const payload = await response.json().catch(() => null);
      const ready = Boolean(
        payload?.ready || payload?.kaypalVoice?.ready || payload?.status?.ready,
      );
      if (response.ok && payload?.serviceRunning !== false) {
        setRuntimeState(ready ? "ready" : "online");
        setRuntimeMessage(
          ready
            ? "本地语音服务和 KAYPAL 账号均已就绪"
            : publicVoiceText(payload?.message, "本地语音服务已启动，账号尚未同步"),
        );
        return { serviceRunning: true, ready };
      }
    } catch {
      // The explicit offline state below is the user-visible source of truth.
    }
    setRuntimeState("offline");
    setRuntimeMessage("本地语音服务未启动，请点击“启动并重试”");
    return { serviceRunning: false, ready: false };
  }, [baiLongmaBase]);

  const ensureBaiLongmaRuntime = React.useCallback(async () => {
    setRuntimeState("starting");
    setRuntimeMessage("正在启动本地语音服务");
    const desktopRuntime = window.electronAPI?.baiLongma;
    if (desktopRuntime) {
      const status = await desktopRuntime.start();
      if (!status.serviceRunning) {
        setRuntimeState("error");
        setRuntimeMessage(status.error || status.message || "本地语音服务启动失败");
        return { serviceRunning: false, ready: false };
      }
    }
    return readBaiLongmaStatus();
  }, [readBaiLongmaStatus]);

  const openBaiLongma = React.useCallback(async () => {
    try {
      const desktopRuntime = window.electronAPI?.baiLongma;
      if (desktopRuntime) {
        const status = await desktopRuntime.open();
        setRuntimeState(status.ready ? "ready" : "online");
        setRuntimeMessage(status.message || "本地语音服务已启动");
        return;
      }
      const status = await readBaiLongmaStatus();
      if (!status.serviceRunning) {
        addToast({
          title: "本地语音服务未启动",
          description: "请先启动 BaiLongma 本地服务，再打开语音助手。",
          color: "danger",
        });
        return;
      }
      window.open(`${baiLongmaBase}/`, "_blank", "noopener,noreferrer");
    } catch (error) {
      setRuntimeState("error");
      setRuntimeMessage(getErrorMessage(error));
      addToast({
        title: "本地语音服务启动失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    }
  }, [baiLongmaBase, readBaiLongmaStatus]);

  const passAuthorizationToBaiLongma = React.useCallback(
    async (
      authorization: VoicePairResult,
      options: { silent?: boolean } = {},
    ) => {
      if (!authorization.accessToken) return false;
      try {
        setRuntimeState("authorizing");
        setRuntimeMessage("本地语音服务已启动，正在同步 KAYPAL 账号");
        const response = await fetch(`${baiLongmaBase}/kaypal-voice/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voiceBaseUrl: voiceBase,
            accessToken: authorization.accessToken,
            expiresAt: authorization.expiresAt,
            timeoutMs: 5000,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload?.ready) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        setRuntimeState("ready");
        setRuntimeMessage("本地语音服务和 KAYPAL 账号均已就绪");
        if (!options.silent) {
          addToast({
            title: "语音助手已准备好",
            description: "账号能力已同步完成。",
            color: "success",
          });
        }
        return true;
      } catch (error) {
        const status = await readBaiLongmaStatus();
        if (status.serviceRunning) {
          setRuntimeState("error");
          setRuntimeMessage("本地语音服务已启动，但账号同步失败");
        }
        if (!options.silent) {
          addToast({
            title: status.serviceRunning ? "账号同步失败" : "本地语音服务未启动",
            description: status.serviceRunning
              ? getErrorMessage(error)
              : "请点击“启动并重试”。",
            color: "danger",
          });
        }
        return false;
      }
    },
    [baiLongmaBase, readBaiLongmaStatus, voiceBase],
  );

  const syncBaiLongmaAccess = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      try {
        setSyncing(true);
        const runtime = await ensureBaiLongmaRuntime();
        if (!runtime.serviceRunning) {
          throw new Error("本地语音服务未启动，请点击“启动并重试”");
        }
        if (runtime.ready) {
          if (!options.silent) {
            addToast({
              title: "语音助手已准备好",
              description: "账号能力已准备完成。",
              color: "success",
            });
          }
          return;
        }
        const result = await voiceApi.pair({
          clientKind: "bailongma-desktop",
          clientName: "BaiLongma",
          requestedTtlHours: 24,
        });
        setPairResult(result);
        const synchronized = await passAuthorizationToBaiLongma(result, options);
        if (!synchronized) return;
        await loadState();
      } catch (error) {
        if (runtimeState === "starting") {
          setRuntimeState("error");
          setRuntimeMessage(getErrorMessage(error));
        }
        if (!options.silent) {
          addToast({
            title: "账号同步失败",
            description: getErrorMessage(error),
            color: "danger",
          });
        }
      } finally {
        setSyncing(false);
      }
    },
    [ensureBaiLongmaRuntime, loadState, passAuthorizationToBaiLongma, runtimeState],
  );

  React.useEffect(() => {
    if (!state || autoSyncAttemptedRef.current) return;
    autoSyncAttemptedRef.current = true;
    void syncBaiLongmaAccess({ silent: true });
  }, [state, syncBaiLongmaAccess]);

  const handlePair = async () => {
    try {
      await syncBaiLongmaAccess();
    } catch (error) {
      addToast({
        title: "同步失败",
        description: getErrorMessage(error),
        color: "danger",
      });
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadState(), readBaiLongmaStatus()]);
  };

  const handleRunCommand = async (explicitText?: string) => {
    const liveText = explicitText || commandText;
    const text = liveText.trim();
    if (liveText && liveText !== commandText) {
      setCommandText(liveText);
    }
    if (!text) {
      addToast({ title: "请输入语音指令", color: "warning" });
      return;
    }
    try {
      setRunningCommand(true);
      const response = await fetch(`${voiceBase}/command`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "kaypal-web" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | VoiceApiResponse<VoiceCommandResult>
        | null;
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || `请求失败: ${response.status}`);
      }
      const result = payload.data;
      setCommandResult(result);
      addToast({
        title:
          result.handledBy === "kaypal-voice-bridge"
            ? "KAYPAL 已处理"
            : "语音助手已处理",
        description: publicVoiceText(result.responseText, "指令已处理。"),
        color:
          result.handledBy === "kaypal-voice-bridge" ? "success" : "primary",
      });
    } catch (error) {
      addToast({
        title: "指令未完成",
        description: getErrorMessage(error),
        color: "danger",
      });
    } finally {
      setRunningCommand(false);
    }
  };

  const pendingCount = state?.kaypal.pendingConfirmations.count ?? 0;
  const plan =
    state?.kaypal.billing?.entitlement?.plan || state?.user.plan || "未同步";
  const connectionText =
    runtimeState === "ready"
      ? "可用"
      : runtimeState === "starting" || runtimeState === "authorizing" || syncing
        ? "同步中"
        : runtimeState === "online"
          ? "服务已启动"
          : runtimeState === "checking"
            ? "检查中"
            : "服务未启动";
  const runtimeReady = runtimeState === "ready";
  const runtimeUnavailable = runtimeState === "offline" || runtimeState === "error";
  const runtimeBusy =
    runtimeState === "checking" ||
    runtimeState === "starting" ||
    runtimeState === "authorizing";

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pb-10">
      <section className="rounded-[8px] border border-default-200 bg-content1 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip color="primary" variant="flat">
                BaiLongma
              </Chip>
              <Chip color={state?.kaypal.connected ? "success" : "default"} variant="flat">
                {state?.kaypal.connected ? "KAYPAL 账号可用" : "KAYPAL 账号未连接"}
              </Chip>
              <Chip color={runtimeReady ? "success" : runtimeUnavailable ? "danger" : "warning"} variant="flat">
                {connectionText}
              </Chip>
            </div>
            <h1 className="text-[24px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">
              BaiLongma 语音助手
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-default-500">
              同步 KAYPAL 账号能力后，即可在 BaiLongma 中使用相关业务功能。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {runtimeUnavailable ? (
              <Button
                color="danger"
                isLoading={syncing}
                startContent={!syncing ? <Icon icon="solar:restart-linear" /> : null}
                variant="flat"
                onPress={() => void handlePair()}
              >
                启动并重试
              </Button>
            ) : null}
            <Button
              color="primary"
              isDisabled={runtimeBusy}
              startContent={<Icon icon="solar:external-link-linear" />}
              onPress={() => void openBaiLongma()}
            >
              打开 BaiLongma
            </Button>
            <Button
              color="default"
              startContent={<Icon icon="solar:send-linear" />}
              variant="flat"
              onPress={focusCommandInput}
            >
              在本页试一句
            </Button>
            <Button
              isLoading={loading}
              startContent={!loading ? <Icon icon="solar:refresh-linear" /> : null}
              variant="flat"
              onPress={() => void handleRefresh()}
            >
              刷新状态
            </Button>
          </div>
        </div>
      </section>

      <Card className="border border-default-200 bg-content1 shadow-sm">
        <CardBody className="gap-4 p-5">
          <SectionTitle
            icon="solar:route-linear"
            title="开始使用"
            description="本地语音服务启动且账号同步成功后，才会显示为可用。"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <UsageStep
              label="1"
              title="启动本地服务"
              description="桌面应用会启动并检查本机语音服务。"
            />
            <UsageStep
              label="2"
              title="开始使用"
              description="点击“打开 BaiLongma”开始使用，也可以在本页发送一条语音指令。"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-default-200 bg-default-50 p-3 text-xs leading-5 text-default-500">
            <Chip
              color={runtimeReady ? "success" : runtimeUnavailable ? "danger" : "warning"}
              size="sm"
              variant="flat"
            >
              {runtimeReady
                ? "当前可用"
                : runtimeUnavailable
                  ? "服务未启动"
                  : runtimeState === "online"
                    ? "等待账号同步"
                    : "正在检查"}
            </Chip>
            <span>{runtimeMessage}</span>
            {runtimeUnavailable ? (
              <Button
                color="danger"
                isLoading={syncing}
                size="sm"
                variant="flat"
                onPress={() => void handlePair()}
              >
                启动并重试
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-5 p-5">
            <SectionTitle
              icon="solar:radio-linear"
              title="当前状态"
              description="查看语音助手当前可用的账号和业务能力。"
            />
            {loading && !state ? (
              <div className="flex items-center justify-center gap-2 rounded-[8px] border border-dashed border-default-300 p-8 text-sm text-default-500">
                <Spinner size="sm" />
                正在读取连接状态
              </div>
            ) : state ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric label="语音助手" value={connectionText} />
                  <Metric label="套餐" value={plan} />
                  <Metric label="待确认" value={`${pendingCount} 个`} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <CapabilityColumn
                    title="语音助手能力"
                    tools={state.tools.general}
                  />
                  <CapabilityColumn title="KAYPAL 业务能力" tools={state.tools.kaypal} />
                </div>
                <CapabilityColumn title="混合任务" tools={state.tools.hybrid} />
              </>
            ) : (
              <div className="rounded-[8px] border border-dashed border-default-300 p-8 text-sm text-default-500">
                暂无状态，请确认已经登录 KAYPAL。
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-5 p-5">
            <SectionTitle
              icon="solar:user-check-linear"
              title="BaiLongma 账号"
              description="登录 KAYPAL 后，系统会自动为 BaiLongma 准备账号能力。"
            />
            {runtimeReady ? (
              <div className="space-y-3 rounded-[8px] border border-success-200 bg-success-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-success-700">
                      账号能力已同步
                    </p>
                    <p className="text-xs text-default-500">
                      {pairResult
                        ? `本次同步有效期至 ${formatDateTime(pairResult.expiresAt)}`
                        : "本机语音助手已准备就绪"}
                    </p>
                  </div>
                  <Button
                    color="success"
                    isLoading={syncing}
                    size="sm"
                    startContent={!syncing ? <Icon icon="solar:refresh-linear" /> : null}
                    variant="flat"
                    onPress={() => void handlePair()}
                  >
                    重新检查
                  </Button>
                </div>
                <p className="text-xs leading-5 text-default-500">
                  BaiLongma 已可使用 KAYPAL 业务能力。
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-[8px] border border-dashed border-default-300 bg-default-50 p-4 text-sm leading-6 text-default-600">
                <div className="flex items-center gap-3">
                  {syncing ? <Spinner size="sm" /> : null}
                  <span>
                    {runtimeUnavailable
                      ? "本地语音服务未启动，账号尚未同步到语音助手。"
                      : pairResult
                        ? "KAYPAL 已签发账号授权，但本地语音服务尚未确认接收。"
                        : runtimeState === "online"
                          ? "本地语音服务已启动，等待同步 KAYPAL 账号。"
                          : "正在检查本地语音服务和账号授权。"}
                  </span>
                </div>
                <Button
                  color={runtimeUnavailable ? "danger" : "primary"}
                  isLoading={syncing}
                  size="sm"
                  variant="flat"
                  onPress={() => void handlePair()}
                >
                  {runtimeUnavailable ? "启动并重试" : "同步账号"}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-5 p-5">
            <SectionTitle
              icon="solar:shield-check-linear"
              title="安全规则"
              description="用户可以自然说话，但业务动作仍按 KAYPAL 的安全边界执行。"
            />
            <div className="grid gap-3">
              <BoundaryItem
                title="日常语音功能"
                description="聊天、搜索、文件总结、写作和提醒由语音助手直接处理。"
              />
              <BoundaryItem
                title="KAYPAL 业务功能"
                description="待确认、用量、情报搜索、微信草稿等 KAYPAL 事项会自动交给工作台。"
              />
              <BoundaryItem
                title="敏感动作要确认"
                description="外发、发布、批量触达和客户操作会进入待我确认，并保留结果留存。"
              />
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-5 p-5">
            <SectionTitle
              icon="solar:send-linear"
              title="发送语音指令"
              description="系统会根据指令内容自动选择合适的处理方式。"
            />
            <div className="flex flex-wrap gap-2">
              {sampleCommands.map((item, index) => (
                <button
                  key={item}
                  className={`rounded-[8px] px-3 py-2 text-sm font-medium transition-colors ${
                    commandText === item
                      ? "bg-primary text-primary-foreground"
                      : "bg-default-100 text-default-700 hover:bg-default-200"
                  }`}
                  data-voice-command-sample={index}
                  type="button"
                  onClick={() => {
                    setCommandText(item);
                    void handleRunCommand(item);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-default-700">
              <span>你可以这样说</span>
              <input
                ref={commandInputRef}
                data-voice-command-input
                className="h-11 rounded-[8px] border border-default-200 bg-content1 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
              />
            </label>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
              data-voice-command-send
              disabled={runningCommand}
              type="button"
              onClick={() => void handleRunCommand(commandText)}
            >
              {!runningCommand ? <Icon icon="solar:send-linear" /> : null}
              发送指令
            </button>
            {commandResult ? (
              <div className="space-y-3 rounded-[8px] border border-default-200 bg-default-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={
                      commandResult.handledBy === "kaypal-voice-bridge"
                        ? "success"
                        : "primary"
                    }
                    variant="flat"
                  >
                    {commandResult.handledBy === "kaypal-voice-bridge"
                      ? "KAYPAL 已处理"
                      : "语音助手已处理"}
                  </Chip>
                  <Chip color={riskColor(commandResult.risk)} variant="flat">
                    {riskLabels[commandResult.risk]}
                  </Chip>
                </div>
                <p className="text-sm leading-6 text-default-700">
                  {publicVoiceText(commandResult.responseText, "指令已处理。")}
                </p>
                {commandResult.action?.href ? (
                  <Button
                    as="a"
                    href={commandResult.action.href}
                    size="sm"
                    startContent={<Icon icon="solar:external-link-linear" />}
                    variant="flat"
                  >
                    打开 {commandResult.action.label}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-primary-50 text-primary">
        <Icon icon={icon} width={20} />
      </div>
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold text-[var(--kaypal-v3-ink)]">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-default-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      <p className="text-xs text-default-500">{label}</p>
      <p className="mt-1 truncate text-lg font-bold text-[var(--kaypal-v3-ink)]">
        {value}
      </p>
    </div>
  );
}

function UsageStep({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {label}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            {title}
          </p>
          <p className="mt-1 text-xs leading-5 text-default-500">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function CapabilityColumn({
  title,
  tools,
}: {
  title: string;
  tools: VoiceToolDescriptor[];
}) {
  return (
    <div className="rounded-[8px] border border-default-200 p-3">
      <p className="mb-3 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
        {title}
      </p>
      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="rounded-[8px] border border-default-100 bg-default-50 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-default-800">
                {tool.title}
              </p>
              <Chip color={riskColor(tool.risk)} size="sm" variant="flat">
                {riskLabels[tool.risk]}
              </Chip>
              {tool.requiresKaypalConnection ? (
                <Chip color="warning" size="sm" variant="flat">
                  账号能力
                </Chip>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-default-500">
              {publicVoiceText(tool.description, "可通过语音使用此功能。")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoundaryItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
      <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
        {title}
      </p>
      <p className="mt-2 text-xs leading-5 text-default-500">{description}</p>
    </div>
  );
}
