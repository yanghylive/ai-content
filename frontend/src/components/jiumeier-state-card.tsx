"use client";

/**
 * 九妹儿状态卡 —— AI 浏览器控制台的「人肉状态灯」。
 *
 * 四张状态立绘映射 Agent 的真实生命周期（数据源=会话 status + 事件流，
 * 由调用方推导后传入，本组件纯展示、无自有状态）：
 *   idle   待机：无会话 / created / stopped / paused
 *   listen 聆听：有动作等你批准（needs-human / 待确认单）或出错待处理
 *   think  思考：running 且最新事件是 observe/快照（正在看页面、规划动作）
 *   run    执行：running 且最新事件是 step（动作序列正在面板上跑）
 *
 * 切换用透明度交叉淡入；徽章 role=status 供读屏播报；
 * prefers-reduced-motion 时禁用脉冲。
 */

export type JiumeierState = "idle" | "listen" | "think" | "run";

const STATES: Record<
  JiumeierState,
  { label: string; tone: string; title: string; sub: string; img: string }
> = {
  idle: {
    label: "待机",
    tone: "#a49db0",
    title: "待机中",
    sub: "给个任务，我就开工",
    img: "/brand/jiumeier-state-idle.webp",
  },
  listen: {
    label: "聆听",
    tone: "#f59e0b",
    title: "等你拿主意",
    sub: "有动作需要你批准，或随时接管页面",
    img: "/brand/jiumeier-state-listen.webp",
  },
  think: {
    label: "思考",
    tone: "#8b5cf6",
    title: "正在分析页面…",
    sub: "观察 DOM，规划下一步动作",
    img: "/brand/jiumeier-state-think.webp",
  },
  run: {
    label: "执行",
    tone: "#10b981",
    title: "执行中",
    sub: "代操作面板页面，动作实时可见",
    img: "/brand/jiumeier-state-run.webp",
  },
};

const ORDER: JiumeierState[] = ["idle", "listen", "think", "run"];

export function JiumeierStateCard({ state }: { state: JiumeierState }) {
  const cur = STATES[state] ?? STATES.idle;
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,.25)",
        borderRadius: 12,
        overflow: "hidden",
        alignSelf: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 9px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 静态导出，无需优化 */}
        <img
          alt=""
          src="/brand/jiumeier-face.webp"
          width={40}
          height={40}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            objectFit: "cover",
            objectPosition: "50% 22%",
            border: "2px solid rgba(139,92,246,.35)",
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>九妹儿</span>
          <span style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)" }}>
            JIU MEIER · 你的增长搭档
          </span>
        </div>
        <span
          role="status"
          aria-live="polite"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 11px",
            borderRadius: 12,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: ".06em",
            color: "#fff",
            background: cur.tone,
            transition: "background .3s",
            flexShrink: 0,
          }}
        >
          <span
            className="kx-jm-pulse"
            style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }}
          />
          {cur.label}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          height: 372,
          background: "#17101f",
          overflow: "hidden",
        }}
      >
        {ORDER.map((k) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={k}
            src={STATES[k].img}
            alt=""
            aria-hidden={k !== state}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "50% 15%",
              opacity: k === state ? 1 : 0,
              transition: "opacity .45s ease",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(0deg,rgba(14,9,20,.88) 0,rgba(14,9,20,.25) 32%,transparent 58%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            bottom: 11,
            color: "#fff",
            textShadow: "0 1px 8px rgba(0,0,0,.6)",
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{cur.title}</div>
          <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 1 }}>{cur.sub}</div>
        </div>
      </div>

      <style>{`
        .kx-jm-pulse { animation: kxJmPulse 1.2s ease-in-out infinite; }
        @keyframes kxJmPulse { 0%,100%{opacity:1} 50%{opacity:.25} }
        @media (prefers-reduced-motion: reduce) { .kx-jm-pulse { animation: none; } }
      `}</style>
    </div>
  );
}
