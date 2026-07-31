"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Mic,
  Play,
  RefreshCcw,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { voiceApi, type VoiceState } from "@/lib/api/voice";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2Field,
  V2GhostButton,
  V2Input,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

const SAMPLE_COMMANDS = [
  "今天 JIUZHANG AI 状态怎么样",
  "打开待确认",
  "搜索小红书咖啡店获客线索",
  "打开风控页",
  "帮我总结这个本地文件",
];

/** 智能语音控制台（BaiLongma 白龙马）——配对/语音命令/高风险确认 完整版 */
export function VoiceAgentCenter() {
  const [state, setState] = useState<VoiceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 语音命令
  const [commandText, setCommandText] = useState("");
  const [running, setRunning] = useState(false);
  const [commandResult, setCommandResult] = useState<string | null>(null);
  // 确认队列
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await voiceApi.state();
      setState(result);
    } catch (err: unknown) {
      setError(toPublicError(err, "语音服务连接失败，请确认本地语音模块在运行"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 执行语音命令（文本方式模拟说话）
  const runCommand = async (text: string) => {
    const cmd = text.trim();
    if (!cmd) return;
    setRunning(true);
    setError(null);
    setCommandResult(null);
    try {
      const result = (await voiceApi.command({ text: cmd } as never)) as {
        message?: string;
        reply?: string;
        status?: string;
      };
      const reply = result.reply || result.message || "命令已执行";
      setCommandResult(reply);
      await load(); // 命令可能改变了待确认队列
    } catch (err: unknown) {
      setError(toPublicError(err, "命令执行失败"));
    } finally {
      setRunning(false);
    }
  };

  // 确认/拒绝高风险命令
  const handleConfirm = async (id: string, approved: boolean) => {
    setConfirmingId(id);
    setError(null);
    try {
      await voiceApi.confirm({ confirmationId: id, approved } as never);
      flash(approved ? "已确认执行" : "已拒绝");
      await load();
    } catch (err: unknown) {
      setError(toPublicError(err, "确认操作失败"));
    } finally {
      setConfirmingId(null);
    }
  };

  const companion = state?.companion;
  const kaypal = state?.kaypal;
  const pendingItems = kaypal?.pendingConfirmations?.items || [];
  const toolCount =
    (state?.tools?.general?.length || 0) +
    (state?.tools?.kaypal?.length || 0) +
    (state?.tools?.hybrid?.length || 0);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">正在连接本地语音服务…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Mic className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">语音控制台</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {companion?.productName || "BaiLongma"} 白龙马 · 用声音控制整个系统
            </p>
          </div>
        </div>
        <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4 text-sm text-[var(--kaypal-v3-success)]">
          {notice}
        </p>
      )}

      {/* 状态卡 */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="kaypal-v3-panel p-5">
          <p className="text-sm text-[var(--kaypal-v3-muted)]">本地语音模块</p>
          <div className="mt-2">
            <V2StatusChip tone={companion?.embeddedIn3010 ? "success" : "muted"}>
              {companion?.embeddedIn3010 ? "已就绪" : "未连接"}
            </V2StatusChip>
          </div>
          <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
            {companion?.mode || "-"}
          </p>
        </div>
        <div className="kaypal-v3-panel p-5">
          <p className="text-sm text-[var(--kaypal-v3-muted)]">云端连接</p>
          <div className="mt-2">
            <V2StatusChip tone={kaypal?.connected ? "success" : "danger"}>
              {kaypal?.connected ? "已连接" : "未连接"}
            </V2StatusChip>
          </div>
          <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
            {state?.user?.name || "-"} · {state?.user?.plan || "-"}
          </p>
        </div>
        <div className="kaypal-v3-panel p-5">
          <p className="text-sm text-[var(--kaypal-v3-muted)]">可语音控制的能力</p>
          <p className="mt-2 text-2xl font-bold text-[var(--kaypal-v3-accent-ink)]">
            {toolCount} 项
          </p>
          <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
            {(companion?.generalCapabilities || []).slice(0, 2).join(" · ") || "打开页面/查状态/搜线索等"}
          </p>
        </div>
      </section>

      {/* 语音命令区 */}
      <V2Section
        title="对白龙马说话"
        description="输入文字模拟语音命令（接麦克风后可直接说话）"
      >
        <V2Field label="命令">
          <div className="flex gap-2">
            <V2Input
              placeholder="例如：打开待确认 / 今天状态怎么样 / 搜索小红书咖啡店获客线索"
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !running) void runCommand(commandText);
              }}
            />
            <V2PrimaryButton
              icon={running ? Loader2 : Send}
              loading={running}
              onClick={() => void runCommand(commandText)}
            >
              {running ? "执行中" : "执行"}
            </V2PrimaryButton>
          </div>
        </V2Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 py-1.5 text-xs text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
              onClick={() => void runCommand(cmd)}
            >
              {cmd}
            </button>
          ))}
        </div>
        {commandResult && (
          <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)]">
              <Play className="h-3.5 w-3.5" /> 执行结果
            </p>
            <p className="whitespace-pre-wrap text-sm text-[var(--kaypal-v3-soft-ink)]">
              {commandResult}
            </p>
          </div>
        )}
      </V2Section>

      {/* 高风险命令待确认 */}
      <V2Section
        title={`高风险命令待确认（${pendingItems.length}）`}
        description="涉及发布/删除/发送的命令需要你点头才执行"
      >
        {pendingItems.length === 0 ? (
          <V2EmptyState
            icon={ShieldAlert}
            title="没有待确认的语音命令"
            description="白龙马执行高风险动作前会先把命令送到这里等你确认"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pendingItems.map((item) => (
              <div key={item.id} className="kaypal-v3-panel p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <V2StatusChip tone={item.riskLevel === "high" ? "danger" : "warning"}>
                        {item.riskLevel === "high" ? "高风险" : "中风险"}
                      </V2StatusChip>
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {item.title || "语音命令"}
                      </p>
                    </div>
                    {item.description ? (
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <V2GhostButton
                      icon={XCircle}
                      loading={confirmingId === item.id}
                      onClick={() => void handleConfirm(item.id, false)}
                    >
                      拒绝
                    </V2GhostButton>
                    <V2PrimaryButton
                      icon={CheckCircle2}
                      loading={confirmingId === item.id}
                      onClick={() => void handleConfirm(item.id, true)}
                    >
                      确认执行
                    </V2PrimaryButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>
    </div>
  );
}
