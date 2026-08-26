"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { rpaStatus, captureScreen, requestScreenCapture, executeActions, resumeAfterAsk, cancelActions, pauseActions, resumeActions, mapBoundsToScreen, type CaptureScreenResult } from "@/lib/mobile-bridge";
import { planMaiUiActions, sinkMaiUiTaskToCrm, type MaiUiAction } from "@/lib/api/mai-ui";
import { createMaiUiTask, reportTaskStatus, addTaskEvidence, createApproval, actApproval, sha256Hex } from "@/lib/api/mobile-executor";
import { toActionableError } from "@/lib/public-error";

/** MAI-UI 手机端工作台：截屏 → 指令 → 规划动作 → 无障碍执行 → 人工确认 */
export default function MaiUiWorkbenchPage() {
  const isMobile = useIsMobile();
  const [rpa, setRpa] = useState<{ enabled: boolean; available: boolean }>({ enabled: false, available: false });
  const [instruction, setInstruction] = useState("");
  const [screenShot, setScreenShot] = useState<string>("");
  const [shotMeta, setShotMeta] = useState<Partial<CaptureScreenResult>>({});
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [actions, setActions] = useState<MaiUiAction[]>([]);
  const [pendingAsk, setPendingAsk] = useState<{ question: string; riskLevel: string; summary: string } | null>(null);
  const [selRect, setSelRect] = useState<[number, number, number, number] | null>(null);
  const selRef = useRef<{ startX: number; startY: number; drawing: boolean }>({ startX: 0, startY: 0, drawing: false });
  const [lastTask, setLastTask] = useState<{ id: string; resultMessage: string; actionCount: number } | null>(null);
  const [sinking, setSinking] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [model, setModel] = useState("");

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 30));
  }, []);

  useEffect(() => {
    setRpa(rpaStatus());
  }, []);

  const handleCapture = useCallback(() => {
    pushLog("截屏中…");
    const result = captureScreen();
    if (result.ok && result.message.startsWith("data:")) {
      setScreenShot(result.message);
      setShotMeta(result);
      pushLog(
        result.width
          ? `✅ 截屏成功（${result.width}×${result.height}，屏幕 ${result.screenWidth}×${result.screenHeight}）`
          : "✅ 截屏成功",
      );
    } else if (
      result.message.includes("不支持系统截图") ||
      result.message.includes("未授权") ||
      result.message.includes("屏幕录制")
    ) {
      // Android 8-10 老设备需 MediaProjection 授权，自动发起系统授权弹窗
      pushLog("⚠️ 需要屏幕录制授权，正在发起系统授权…");
      const auth = requestScreenCapture();
      pushLog(auth.ok ? `📲 ${auth.message}（授权后请重新截屏）` : `❌ ${auth.message}`);
    } else {
      pushLog(`❌ ${result.message}`);
    }
  }, [pushLog]);

  const handlePlan = useCallback(async () => {
    if (!screenShot) {
      pushLog("❌ 请先截屏");
      return;
    }
    if (!instruction.trim()) {
      pushLog("❌ 请输入操作指令");
      return;
    }
    setPlanning(true);
    pushLog(`规划中：${instruction}…`);
    try {
      const base64 = screenShot.replace(/^data:image\/\w+;base64,/, "");
      const result = await planMaiUiActions({
        imageBase64: base64,
        instruction: instruction.trim(),
        width: shotMeta.width,
        height: shotMeta.height,
      });
      if (result.ok && result.actions.length > 0) {
        setActions(result.actions);
        setModel(result.model);
        pushLog(`✅ 规划出 ${result.actions.length} 个候选动作（${result.model}）`);
      } else {
        setActions([]);
        pushLog(`❌ 规划失败：${result.parseError || "无动作"}`);
      }
    } catch (e) {
      pushLog(`❌ 规划调用失败：${toActionableError(e, "未知错误")}`);
    } finally {
      setPlanning(false);
    }
  }, [screenShot, instruction, shotMeta.width, shotMeta.height, pushLog]);

  const handleExecute = useCallback(async () => {
    if (actions.length === 0) {
      pushLog("❌ 无动作可执行，请先规划");
      return;
    }
    setExecuting(true);
    pushLog(`执行 ${actions.length} 个动作…（请勿操作手机）`);
    // 规划坐标基于缩放截图，执行前映射到真实屏幕坐标（2026-08-22）
    const mapped = actions.map((a) =>
      a.bounds
        ? { ...a, bounds: mapBoundsToScreen(a.bounds, shotMeta) }
        : a,
    );
    // P0-1：接入 ExecutorTask 受控任务流——建任务留痕 + running 占位防 agent 误领（2026-08-22）
    let taskId = "";
    try {
      const task = await createMaiUiTask({
        instruction: instruction.trim() || "手动执行动作序列",
        actions: mapped as MaiUiAction[],
      });
      taskId = task.id;
      await reportTaskStatus(taskId, { status: "running" });
      pushLog(`📋 任务 ${taskId.slice(-6)} 已创建`);
    } catch (e) {
      pushLog(`⚠️ 任务创建失败（继续直接执行）：${toActionableError(e, "未知错误")}`);
    }
    const result = executeActions(mapped as MaiUiAction[], taskId);
    // P1 证据链：执行完成后截屏存证（审计留痕，2026-08-22）
    if (taskId && result.ok) {
      try {
        const shotAfter = captureScreen();
        if (shotAfter.ok && shotAfter.message.startsWith("data:")) {
          await addTaskEvidence(taskId, {
            type: "screenshot",
            stepIndex: -1,
            content: { dataUrl: shotAfter.message, stage: "after-execution" },
          });
          pushLog(`📸 执行后截图已存证`);
        }
      } catch {
        /* 存证失败不阻塞 */
      }
    }
    // 回传执行结果（ASK_USER 暂停不标终态，保持 executing 等 resume 后定论）
    if (taskId) {
      try {
        const isAskUser = result.message.startsWith("ASK_USER:");
        if (!isAskUser) {
          await reportTaskStatus(taskId, result.ok
            ? { status: "done", result: { message: result.message } }
            : { status: "failed", error: result.message });
        }
      } catch { /* 回传失败不阻塞 */ }
    }
    if (result.ok) {
      pushLog(`✅ ${result.message}${taskId ? `（任务 ${taskId.slice(-6)}）` : ""}`);
      if (taskId) {
        setLastTask({ id: taskId, resultMessage: result.message, actionCount: actions.length });
      }
    } else if (result.message.startsWith("ASK_USER:")) {
      const question = result.message.replace(/^ASK_USER:/, "").split("|")[0];
      // P2-24 审批卡：动作摘要 + 风险分级（含外发/写内容动作 → high）
      const summary = actions.map((a) => a.action).join(" → ");
      const riskLevel = actions.some((a) => a.action === "send_dm" || a.action === "input")
        ? "high"
        : "medium";
      setPendingAsk({ question, riskLevel, summary });
      pushLog(`⏸ 需要人工确认：${question}`);
    } else {
      pushLog(`❌ ${result.message}`);
    }
    setExecuting(false);
  }, [actions, shotMeta, instruction, pushLog]);

  const handleAskAnswer = useCallback(
    async (proceed: boolean) => {
      const ask = pendingAsk;
      setPendingAsk(null);
      if (!proceed) {
        resumeAfterAsk(false);
        pushLog("⛔ 已中止动作序列");
        return;
      }
      // P2 ApprovalToken：继续前走一次性审批（短时 + 内容 hash 绑定防篡改，2026-08-22）
      if (!lastTask) {
        pushLog("⚠️ 无关联任务，无法审批（已直接继续）");
        resumeAfterAsk(true);
        return;
      }
      pushLog("🛂 申请外发审批…");
      try {
        const contentText = JSON.stringify({
          instruction: instruction.trim(),
          actions: actions.map((a) => ({ action: a.action, target: a.target, text: a.text })),
        });
        const hash = await sha256Hex(contentText);
        const approval = await createApproval({
          actionType: "mai_ui_execute",
          riskLevel: ask?.riskLevel ?? "medium",
          inputHash: hash,
          actionId: lastTask.id,
          reason: `MAI-UI 外发确认：${instruction.trim().slice(0, 40)}`,
        });
        await actApproval(approval.id, "approve");
        pushLog(`✅ 审批通过（${approval.id.slice(-6)}），继续执行`);
        // P1 防篡改：把审批动作 hash 传给壳代码，consume 时校验「执行动作 == 审批动作」
        resumeAfterAsk(true, approval.id, hash);
      } catch (e) {
        pushLog(`⛔ 审批未通过：${toActionableError(e, "未知错误")}（已中止）`);
        resumeAfterAsk(false);
      }
    },
    [lastTask, instruction, actions, pendingAsk, pushLog],
  );

  const handleCancel = useCallback(() => {
    cancelActions();
    setExecuting(false);
    pushLog("⛔ 已请求中止");
  }, [pushLog]);

  const [paused, setPaused] = useState(false);

  const handlePause = useCallback(() => {
    const r = pauseActions();
    if (r.ok) {
      setPaused(true);
      pushLog(`⏸ ${r.message}`);
    } else {
      pushLog(`❌ ${r.message}`);
    }
  }, [pushLog]);

  const handleResume = useCallback(() => {
    const r = resumeActions();
    if (r.ok) {
      setPaused(false);
      pushLog(`▶ ${r.message}`);
    } else {
      pushLog(`❌ ${r.message}`);
    }
  }, [pushLog]);

  /** 沉淀本次执行到 CRM（来源=MAI-UI 设备执行） */
  const handleSinkCrm = useCallback(async () => {
    if (!lastTask) return;
    setSinking(true);
    pushLog("沉淀到 CRM…");
    try {
      const customer = await sinkMaiUiTaskToCrm({
        displayName: (instruction.trim() || "MAI-UI 设备执行").slice(0, 30),
        taskId: lastTask.id,
        instruction: instruction.trim() || "手动执行",
        actionCount: lastTask.actionCount,
        resultMessage: lastTask.resultMessage,
      });
      pushLog(`✅ 已沉淀到 CRM：${customer.displayName}`);
      setLastTask(null);
    } catch (e) {
      pushLog(`❌ 沉淀失败：${toActionableError(e, "未知错误")}`);
    } finally {
      setSinking(false);
    }
  }, [lastTask, instruction, pushLog]);

  /** 圈选开始（截图预览容器 pointerdown） */
  const handleSelectStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!shotMeta.width || !shotMeta.height) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) * shotMeta.width) / rect.width;
      const sy = ((e.clientY - rect.top) * shotMeta.height) / rect.height;
      selRef.current = { startX: sx, startY: sy, drawing: true };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [shotMeta],
  );

  const handleSelectMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = selRef.current;
      if (!st.drawing || !shotMeta.width || !shotMeta.height) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) * shotMeta.width) / rect.width;
      const cy = ((e.clientY - rect.top) * shotMeta.height) / rect.height;
      const x1 = Math.max(0, Math.min(st.startX, cx));
      const y1 = Math.max(0, Math.min(st.startY, cy));
      const x2 = Math.min(shotMeta.width, Math.max(st.startX, cx));
      const y2 = Math.min(shotMeta.height, Math.max(st.startY, cy));
      setSelRect([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
    },
    [shotMeta],
  );

  const handleSelectEnd = useCallback(() => {
    selRef.current.drawing = false;
  }, []);

  /** 用圈选区域生成点击动作 */
  const handleSelectClick = useCallback(() => {
    if (!selRect) {
      pushLog("❌ 请先在截图上圈选目标区域");
      return;
    }
    const [x1, y1, x2, y2] = selRect;
    if (x2 - x1 < 4 || y2 - y1 < 4) {
      pushLog("❌ 圈选区域太小（宽高至少 4px）");
      return;
    }
    setActions([
      { action: "click", target: "用户圈选区域", bounds: selRect },
    ]);
    setModel("");
    pushLog(`圈选区域 → 点击 [${selRect.join(",")}]`);
  }, [selRect, pushLog]);

  const actionLabel = (a: MaiUiAction) => {
    const parts = [a.action];
    if (a.target) parts.push(`「${a.target}」`);
    if (a.text) parts.push(`=${a.text}`);
    if (a.bounds) parts.push(`@[${a.bounds.join(",")}]`);
    if (a.direction) parts.push(a.direction);
    if (a.distance) parts.push(`${a.distance}px`);
    if (a.ms) parts.push(`${a.ms}ms`);
    if (a.question) parts.push(`❓${a.question}`);
    return parts.join(" ");
  };

  return (
    <div
      className="kx-mobile-ambient"
      style={{ minHeight: "100dvh", paddingBottom: 90, background: isMobile ? undefined : "var(--kaypal-v3-paper-muted)" }}
    >
      <div className="mx-px" style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "12px 16px 28px" : "28px 24px" }}>
        {/* 统一页头（桌面/移动同一品牌结构） */}
        <div className="kx-page-head">
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">MAI-UI 工作台</h1>
            <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
              截屏 → 指令 → 规划动作 → 手机自动执行（截图由 qwen-vl-max 理解）
            </p>
          </div>
        </div>

        {/* 无障碍状态 */}
        <div
          className="mx-card"
          style={{ marginTop: 12, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)" }}>无障碍操作</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: rpa.enabled ? "var(--kaypal-v3-success)" : rpa.available ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-muted)",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: rpa.enabled ? "var(--kaypal-v3-success)" : rpa.available ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-muted)" }} />
            {rpa.enabled ? "已开启" : rpa.available ? "未开启" : "不在 App 内"}
          </span>
        </div>

        {/* 指令输入 */}
        <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 8 }}>
            操作指令
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：在搜索框搜索「空气炸锅食谱」，打开第一个结果"
            rows={2}
            style={{
              width: "100%",
              border: "1px solid var(--kaypal-v3-border)",
              borderRadius: "var(--kaypal-v3-radius-sm)",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "none",
              background: "var(--kaypal-v3-paper-muted)",
              color: "var(--mx-ink)",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={handleCapture}
              style={{ flex: 1, ...btnStyle("var(--kaypal-v3-purple)") }}
            >
              ① 截屏
            </button>
            <button
              onClick={() => void handlePlan()}
              disabled={planning}
              style={{ flex: 1, ...btnStyle("var(--kaypal-v3-cobalt)"), opacity: planning ? 0.6 : 1 }}
            >
              {planning ? "规划中…" : "② 规划动作"}
            </button>
          </div>
        </div>

        {/* 截图预览 */}
        {screenShot && (
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 8 }}>
              当前屏幕截图
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>当前屏幕截图</span>
              <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)" }}>
                拖拽圈选目标 → 一键点击
              </span>
            </div>
            <div
              onPointerDown={handleSelectStart}
              onPointerMove={handleSelectMove}
              onPointerUp={handleSelectEnd}
              onPointerCancel={handleSelectEnd}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: shotMeta.width && shotMeta.height
                  ? `${shotMeta.width} / ${shotMeta.height}`
                  : "9 / 20",
                maxHeight: 460,
                borderRadius: "var(--kaypal-v3-radius-sm)",
                overflow: "hidden",
                border: "1px solid var(--kaypal-v3-border)",
                touchAction: "none",
                cursor: "crosshair",
                background: "var(--kaypal-v3-ink)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- dataURL 截图不适合 next/image 优化 */}
              <img
                src={screenShot}
                alt="屏幕截图"
                style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", userSelect: "none" }}
                draggable={false}
              />
              {selRect && (
                <div
                  style={{
                    position: "absolute",
                    left: `${(selRect[0] / (shotMeta.width || 1)) * 100}%`,
                    top: `${(selRect[1] / (shotMeta.height || 1)) * 100}%`,
                    width: `${((selRect[2] - selRect[0]) / (shotMeta.width || 1)) * 100}%`,
                    height: `${((selRect[3] - selRect[1]) / (shotMeta.height || 1)) * 100}%`,
                    border: "2px solid var(--kaypal-v3-success)",
                    background: "var(--kaypal-v3-success-soft)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handleSelectClick}
                style={{ flex: 1, ...btnStyle("var(--kaypal-v3-success)") }}
              >
                🎯 用圈选区域点击
              </button>
              <button
                onClick={() => setSelRect(null)}
                style={{ ...btnStyle("var(--kaypal-v3-muted)") }}
              >
                清除选区
              </button>
            </div>
          </div>
        )}

        {/* 动作列表 */}
        {actions.length > 0 && (
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>
                候选动作（{actions.length} 步）
              </span>
              {model && <span style={{ fontSize: 12, color: "var(--kaypal-v3-muted)" }}>{model}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {actions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 13,
                    padding: "8px 10px",
                    borderRadius: "var(--kaypal-v3-radius-xs)",
                    background: a.action === "ask_user" ? "var(--kaypal-v3-amber-soft)" : a.action === "done" ? "var(--kaypal-v3-success-soft)" : "var(--kaypal-v3-paper-muted)",
                    border: "1px solid var(--kaypal-v3-border)",
                    color: "var(--mx-ink)",
                    fontFamily: "ui-monospace, monospace",
                    wordBreak: "break-all",
                  }}
                >
                  <b style={{ color: actionColor(a.action) }}>{i + 1}.</b> {actionLabel(a)}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => void handleExecute()}
                disabled={executing}
                style={{ flex: 1, ...btnStyle("var(--kaypal-v3-success)"), opacity: executing ? 0.6 : 1 }}
              >
                {executing ? "执行中…" : "③ 执行动作"}
              </button>
              {paused ? (
                <button onClick={handleResume} style={{ ...btnStyle("var(--kaypal-v3-cobalt)") }}>
                  ▶ 继续
                </button>
              ) : (
                <button onClick={handlePause} style={{ ...btnStyle("var(--kaypal-v3-cobalt)") }}>
                  ⏸ 暂停
                </button>
              )}
              <button onClick={handleCancel} style={{ ...btnStyle("var(--kaypal-v3-muted)") }}>
                中止
              </button>
            </div>
            {lastTask && (
              <button
                onClick={() => void handleSinkCrm()}
                disabled={sinking}
                style={{ marginTop: 10, width: "100%", ...btnStyle("var(--kaypal-v3-purple)"), opacity: sinking ? 0.6 : 1 }}
              >
                {sinking ? "沉淀中…" : "📥 沉淀到 CRM"}
              </button>
            )}
          </div>
        )}

        {/* 日志 */}
        {logs.length > 0 && (
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 8 }}>执行日志</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: l.startsWith("❌") ? "var(--kaypal-v3-danger)" : l.startsWith("⏸") ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-soft-ink)", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ask_user 审批卡（P2-24：风险分级 + 动作摘要 + 一次性审批） */}
      {pendingAsk && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: 24,
          }}
        >
          <div style={{ background: "var(--kaypal-v3-paper)", borderRadius: "var(--kaypal-v3-radius)", padding: 20, width: "100%", maxWidth: 360 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kaypal-v3-ink)", marginBottom: 10 }}>需要您确认</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: pendingAsk.riskLevel === "high" ? "var(--kaypal-v3-danger-soft)" : "var(--kaypal-v3-amber-soft)",
                  color: pendingAsk.riskLevel === "high" ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-amber)",
                }}
              >
                {pendingAsk.riskLevel === "high" ? "⚠️ 高风险（外发/写内容）" : "🟡 中风险"}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--kaypal-v3-muted)",
                background: "var(--kaypal-v3-paper-muted)",
                borderRadius: "var(--kaypal-v3-radius-xs)",
                padding: "8px 10px",
                marginBottom: 12,
                wordBreak: "break-all",
              }}
            >
              动作序列：{pendingAsk.summary || "—"}
            </div>
            <div style={{ fontSize: 14, color: "var(--kaypal-v3-soft-ink)", lineHeight: 1.6, marginBottom: 16 }}>
              {pendingAsk.question}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => handleAskAnswer(false)}
                style={{ flex: 1, ...btnStyle("var(--kaypal-v3-muted)") }}
              >
                中止
              </button>
              <button
                onClick={() => handleAskAnswer(true)}
                style={{ flex: 1, ...btnStyle("var(--kaypal-v3-success)") }}
              >
                批准并执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "var(--kaypal-v3-paper)",
    border: "none",
    borderRadius: "var(--kaypal-v3-radius-sm)",
    padding: "11px 0",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function actionColor(action: string): string {
  switch (action) {
    case "click": return "var(--kaypal-v3-purple)";
    case "input": return "var(--kaypal-v3-cobalt)";
    case "swipe": return "var(--kaypal-v3-cobalt)";
    case "wait": return "var(--kaypal-v3-muted)";
    case "back": case "home": return "var(--kaypal-v3-amber)";
    case "ask_user": return "var(--kaypal-v3-amber)";
    case "done": return "var(--kaypal-v3-success)";
    default: return "var(--kaypal-v3-soft-ink)";
  }
}
