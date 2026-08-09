"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Play,
  RefreshCcw,
  Save,
  Send,
  ShieldAlert,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { voiceApi, type VoiceState } from "@/lib/api/voice";
import { toPublicError } from "@/lib/public-error";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
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

  // 麦克风录音 + 云 ASR
  const recorder = useVoiceRecorder();
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrText, setAsrText] = useState<string | null>(null);

  // TTS 朗读开关
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);

  // 设置面板
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [asrSettings, setAsrSettings] = useState<Record<string, string>>({});
  const [ttsSettings, setTtsSettings] = useState<Record<string, string>>({});
  const [ttsCaps, setTtsCaps] = useState<{
    providers: Array<{ id: string; label: string; streaming?: boolean }>;
    voices: Record<string, unknown>;
  } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

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

  // 停止/清理 TTS 音频
  const stopTts = useCallback(() => {
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    setTtsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopTts();
      recorder.cancel();
    };
  }, [stopTts, recorder]);

  // 朗读一段文本（走后端云 TTS）
  const speak = useCallback(
    async (text: string) => {
      if (!ttsEnabled || !text?.trim()) return;
      try {
        stopTts();
        setTtsPlaying(true);
        const blob = await voiceApi.ttsStream(text);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          setTtsPlaying(false);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          setTtsPlaying(false);
        };
        void audio.play().catch(() => {
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          setTtsPlaying(false);
        });
      } catch (err) {
        flash(`语音朗读不可用：${toPublicError(err, "TTS 未配置")}`);
        setTtsPlaying(false);
      }
    },
    [ttsEnabled, stopTts, flash],
  );

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
      await speak(reply); // 朗读回复（TTS 开启时）
    } catch (err: unknown) {
      setError(toPublicError(err, "命令执行失败"));
    } finally {
      setRunning(false);
    }
  };

  // 按住/点击录音 → 云 ASR → 文本 → 自动执行
  const handleRecordClick = async () => {
    if (recorder.recording === "recording") {
      const pcm = await recorder.stop();
      if (!pcm.byteLength) {
        flash("没有录到声音，请靠近麦克风再试");
        return;
      }
      setAsrBusy(true);
      setAsrText(null);
      try {
        const result = await voiceApi.asrTranscribe(pcm);
        if (!result.text) {
          flash("没有识别到内容，请再试一次");
          setAsrText("");
          return;
        }
        setAsrText(result.text);
        setCommandText(result.text);
        await runCommand(result.text);
      } catch (err) {
        setError(toPublicError(err, "语音识别失败，请检查语音设置中的云 ASR 凭证"));
      } finally {
        setAsrBusy(false);
      }
    } else if (recorder.recording === "idle") {
      setAsrText(null);
      await recorder.start();
    }
  };

  // 设置面板加载
  const openSettings = async () => {
    setSettingsOpen((open) => {
      void open; // keep closure stable
      return true;
    });
    try {
      const [asr, tts, caps] = await Promise.all([
        voiceApi.getAsrSettings(),
        voiceApi.getTtsSettings(),
        voiceApi.ttsCapabilities(),
      ]);
      setAsrSettings(asr);
      setTtsSettings(tts);
      setTtsCaps(caps);
    } catch (err) {
      setError(toPublicError(err, "读取语音设置失败"));
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const nextAsr = await voiceApi.updateAsrSettings(asrSettings);
      const nextTts = await voiceApi.updateTtsSettings(ttsSettings);
      setAsrSettings(nextAsr);
      setTtsSettings(nextTts);
      flash("语音设置已保存");
      setSettingsOpen(false);
    } catch (err) {
      setError(toPublicError(err, "保存语音设置失败"));
    } finally {
      setSavingSettings(false);
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
        description="点麦克风说话，或输入文字；识别后自动执行并朗读回复"
      >
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            disabled={asrBusy}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border-2 transition ${
              recorder.recording === "recording"
                ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)] animate-pulse"
                : "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)] hover:bg-[var(--kaypal-v3-accent)] hover:text-white"
            }`}
            onClick={() => void handleRecordClick()}
            title={recorder.recording === "recording" ? "停止并识别" : "点击说话"}
          >
            {asrBusy ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : recorder.recording === "recording" ? (
              <MicOff className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </button>
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
              {recorder.recording === "recording"
                ? "正在聆听… 再次点击结束并识别"
                : recorder.recording === "processing"
                  ? "正在识别语音…"
                  : "点击麦克风，说一句话控制整个系统"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
              语音服务由平台统一配置并按量计费（kaypal.cn），一般可直接使用
            </p>
          </div>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              ttsEnabled
                ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]"
            }`}
            onClick={() => {
              if (ttsEnabled) stopTts();
              setTtsEnabled(!ttsEnabled);
            }}
            title="朗读回复"
          >
            {ttsPlaying ? (
              <AudioLines className="h-3.5 w-3.5 animate-pulse" />
            ) : ttsEnabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
            {ttsPlaying ? "朗读中" : ttsEnabled ? "朗读已开" : "朗读关"}
          </button>
          <V2GhostButton
            icon={settingsOpen ? XCircle : Save}
            onClick={() => {
              if (settingsOpen) {
                setSettingsOpen(false);
              } else {
                void openSettings();
              }
            }}
          >
            {settingsOpen ? "收起" : "语音设置"}
          </V2GhostButton>
        </div>
        {recorder.error && (
          <p className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
            {recorder.error}
          </p>
        )}
        {asrText && (
          <p className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-sm text-[var(--kaypal-v3-accent-ink)]">
            识别：{asrText}
          </p>
        )}
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

      {/* 语音设置（云 ASR / 云 TTS 凭证） */}
      {settingsOpen && (
        <V2Section
          title="语音设置"
          description="语音识别与合成由平台统一配置云服务，按量计入你的 KAYPAL 账户（kaypal.cn 计费），一般无需自备云账号。以下为高级选项：平台未统一配置时可自填云凭证，密文仅掩码回显。"
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                ASR 语音识别（阿里云/腾讯/讯飞/火山任选一组）
              </p>
              <label className="text-xs text-[var(--kaypal-v3-muted)]">服务商</label>
              <V2Input
                placeholder="aliyun / tencent / xunfei / volcengine"
                value={asrSettings.provider || ""}
                onChange={(e) =>
                  setAsrSettings((s) => ({ ...s, provider: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">
                阿里云百炼 API Key（sk- 开头）
              </label>
              <V2Input
                placeholder="sk-…"
                value={asrSettings.aliyunApiKey || ""}
                onChange={(e) =>
                  setAsrSettings((s) => ({ ...s, aliyunApiKey: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">腾讯 SecretId</label>
              <V2Input
                value={asrSettings.tencentSecretId || ""}
                onChange={(e) =>
                  setAsrSettings((s) => ({ ...s, tencentSecretId: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">腾讯 SecretKey</label>
              <V2Input
                value={asrSettings.tencentSecretKey || ""}
                onChange={(e) =>
                  setAsrSettings((s) => ({ ...s, tencentSecretKey: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">讯飞 AppId / ApiKey</label>
              <div className="flex gap-2">
                <V2Input
                  placeholder="AppId"
                  value={asrSettings.xunfeiAppId || ""}
                  onChange={(e) =>
                    setAsrSettings((s) => ({ ...s, xunfeiAppId: e.target.value }))
                  }
                />
                <V2Input
                  placeholder="ApiKey"
                  value={asrSettings.xunfeiApiKey || ""}
                  onChange={(e) =>
                    setAsrSettings((s) => ({ ...s, xunfeiApiKey: e.target.value }))
                  }
                />
              </div>
              <label className="text-xs text-[var(--kaypal-v3-muted)]">火山 API Key</label>
              <V2Input
                value={asrSettings.volcAsrApiKey || ""}
                onChange={(e) =>
                  setAsrSettings((s) => ({ ...s, volcAsrApiKey: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                TTS 语音合成（火山/豆包/OpenAI/讯飞星火任选一组）
              </p>
              <label className="text-xs text-[var(--kaypal-v3-muted)]">服务商</label>
              <V2Input
                placeholder="volcano / doubao / openai / minimax / elevenlabs"
                value={ttsSettings.provider || ""}
                onChange={(e) =>
                  setTtsSettings((s) => ({ ...s, provider: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">音色 ID</label>
              <V2Input
                placeholder="如 BV001_streaming（火山）"
                value={ttsSettings.voiceId || ""}
                onChange={(e) =>
                  setTtsSettings((s) => ({ ...s, voiceId: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">火山 AppId / Token</label>
              <div className="flex gap-2">
                <V2Input
                  placeholder="AppId"
                  value={ttsSettings.volcanoAppId || ""}
                  onChange={(e) =>
                    setTtsSettings((s) => ({ ...s, volcanoAppId: e.target.value }))
                  }
                />
                <V2Input
                  placeholder="Token"
                  value={ttsSettings.volcanoToken || ""}
                  onChange={(e) =>
                    setTtsSettings((s) => ({ ...s, volcanoToken: e.target.value }))
                  }
                />
              </div>
              <label className="text-xs text-[var(--kaypal-v3-muted)]">豆包 Key</label>
              <V2Input
                value={ttsSettings.doubaoKey || ""}
                onChange={(e) =>
                  setTtsSettings((s) => ({ ...s, doubaoKey: e.target.value }))
                }
              />
              <label className="text-xs text-[var(--kaypal-v3-muted)]">OpenAI Key</label>
              <V2Input
                value={ttsSettings.openaiKey || ""}
                onChange={(e) =>
                  setTtsSettings((s) => ({ ...s, openaiKey: e.target.value }))
                }
              />
              {ttsCaps?.providers?.length ? (
                <p className="text-xs text-[var(--kaypal-v3-muted)]">
                  可用服务商：{ttsCaps.providers.map((p) => p.label).join(" / ")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <V2GhostButton onClick={() => setSettingsOpen(false)}>取消</V2GhostButton>
            <V2PrimaryButton
              icon={Save}
              loading={savingSettings}
              onClick={() => void saveSettings()}
            >
              保存设置
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}
    </div>
  );
}
