"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { rpaStatus, captureScreen, executeActions, resumeAfterAsk, cancelActions, mapBoundsToScreen, type CaptureScreenResult } from "@/lib/mobile-bridge";
import { planMaiUiActions, type MaiUiAction } from "@/lib/api/mai-ui";

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
  const [pendingAsk, setPendingAsk] = useState<string>("");
  const [selRect, setSelRect] = useState<[number, number, number, number] | null>(null);
  const selRef = useRef<{ startX: number; startY: number; drawing: boolean }>({ startX: 0, startY: 0, drawing: false });
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
      pushLog(`❌ 规划调用失败：${e instanceof Error ? e.message : String(e)}`);
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
    const result = executeActions(mapped as MaiUiAction[]);
    if (result.ok) {
      pushLog(`✅ ${result.message}`);
    } else if (result.message.startsWith("ASK_USER:")) {
      const question = result.message.replace(/^ASK_USER:/, "").split("|")[0];
      setPendingAsk(question);
      pushLog(`⏸ 需要人工确认：${question}`);
    } else {
      pushLog(`❌ ${result.message}`);
    }
    setExecuting(false);
  }, [actions, shotMeta, pushLog]);

  const handleAskAnswer = useCallback(
    (proceed: boolean) => {
      setPendingAsk("");
      const result = resumeAfterAsk(proceed);
      if (proceed) {
        // 继续执行剩余动作（重新发一次完整序列会从头跑——改用续跑：直接再执行当前序列不可行，
        // 因为执行器已消费。这里提示：确认后由执行器内部继续，若执行器已结束则重新规划）
        pushLog(result.ok ? "⏩ 已确认，继续执行…" : `❌ ${result.message}`);
        // 执行器 resume 后会自动继续，无需再次调用 executeActions
      } else {
        pushLog("⛔ 已中止动作序列");
      }
    },
    [pushLog],
  );

  const handleCancel = useCallback(() => {
    cancelActions();
    setExecuting(false);
    pushLog("⛔ 已请求中止");
  }, [pushLog]);

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
      style={{ minHeight: "100dvh", paddingBottom: 90, background: isMobile ? undefined : "#f1f5f9" }}
    >
      <div className="mx-px" style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "12px 16px 28px" : "28px 24px" }}>
        {/* 头部 */}
        <div className="mx-header">
          <div className="mx-page-title">MAI-UI 工作台</div>
          <div className="mx-page-sub">
            截屏 → 指令 → 规划动作 → 手机自动执行（截图由 qwen-vl-max 理解）
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
              color: rpa.enabled ? "#059669" : rpa.available ? "#d97706" : "#64748b",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: rpa.enabled ? "#059669" : rpa.available ? "#d97706" : "#64748b" }} />
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
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13.5,
              fontFamily: "inherit",
              resize: "none",
              background: "#f8fafc",
              color: "var(--mx-ink)",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={handleCapture}
              style={{ flex: 1, ...btnStyle("#7c3aed") }}
            >
              ① 截屏
            </button>
            <button
              onClick={() => void handlePlan()}
              disabled={planning}
              style={{ flex: 1, ...btnStyle("#2563eb"), opacity: planning ? 0.6 : 1 }}
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
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
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
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid #e2e8f0",
                touchAction: "none",
                cursor: "crosshair",
                background: "#0f172a",
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
                    border: "2px solid #22c55e",
                    background: "rgba(34,197,94,0.18)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handleSelectClick}
                style={{ flex: 1, ...btnStyle("#16a34a") }}
              >
                🎯 用圈选区域点击
              </button>
              <button
                onClick={() => setSelRect(null)}
                style={{ ...btnStyle("#64748b") }}
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
              {model && <span style={{ fontSize: 11, color: "#94a3b8" }}>{model}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {actions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12.5,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: a.action === "ask_user" ? "#fffbeb" : a.action === "done" ? "#f0fdf4" : "#f8fafc",
                    border: "1px solid #e2e8f0",
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
                style={{ flex: 1, ...btnStyle("#059669"), opacity: executing ? 0.6 : 1 }}
              >
                {executing ? "执行中…" : "③ 执行动作"}
              </button>
              <button onClick={handleCancel} style={{ ...btnStyle("#64748b") }}>
                中止
              </button>
            </div>
          </div>
        )}

        {/* 日志 */}
        {logs.length > 0 && (
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 8 }}>执行日志</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontSize: 11.5, color: l.startsWith("❌") ? "#dc2626" : l.startsWith("⏸") ? "#d97706" : "#475569", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ask_user 人工确认弹层 */}
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
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 340 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1e1b4b", marginBottom: 6 }}>需要您确认</div>
            <div style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.6, marginBottom: 16 }}>{pendingAsk}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => handleAskAnswer(false)}
                style={{ flex: 1, ...btnStyle("#64748b") }}
              >
                中止
              </button>
              <button
                onClick={() => handleAskAnswer(true)}
                style={{ flex: 1, ...btnStyle("#059669") }}
              >
                继续执行
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
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "11px 0",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function actionColor(action: string): string {
  switch (action) {
    case "click": return "#7c3aed";
    case "input": return "#2563eb";
    case "swipe": return "#0891b2";
    case "wait": return "#64748b";
    case "back": case "home": return "#d97706";
    case "ask_user": return "#d97706";
    case "done": return "#059669";
    default: return "#334155";
  }
}
