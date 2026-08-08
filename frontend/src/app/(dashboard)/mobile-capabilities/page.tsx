"use client";

/**
 * 手机端能力边界说明（A1，2026-08-08）
 * 让手机端用户清楚：哪些事手机可直接完成，哪些必须到电脑端。
 * 避免"手机端是不是全能"的认知错位（竞品计划 P1「需明确边界」）。
 */
export default function MobileCapabilitiesPage() {
  return (
    <div>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">JIUZHANG AI</div>
            <h1 className="mx-page-title">手机端能做什么</h1>
            <p className="mx-page-sub">移动端能力边界说明</p>
          </div>
        </div>
      </header>

      {/* 手机上可直接完成 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#059669" }}>✅ 手机上可直接完成</span>
          </div>
          {[
            ["查看工作台", "今天 / 内容 / 发布 / 消息 / 我的，全站数据随手看"],
            ["审批任务", "「待我确认」里对回复草稿、客户跟进等点击「确认发送」"],
            ["轻编辑内容", "内容工作区：写文章、继续草稿、管素材"],
            ["任务监控", "发布任务、排队中、今日已发、失败统计实时看"],
            ["结果确认", "发布结果回读（成功/失败/待回执），失败原因可查看"],
            ["素材采集", "链接去水印采集（抖音/小红书）、AI 生图、AI 配音"],
          ].map(([title, desc]) => (
            <div key={title} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <span style={{ color: "#059669", flexShrink: 0 }}>✓</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                <div style={{ fontSize: 11.5, color: "rgba(219,234,254,.58)", marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 需要电脑端 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#d98a2d" }}>🖥️ 需要在电脑端完成</span>
          </div>
          {[
            ["自动发布", "手机端不自动发布：发布包需到目标平台 App 手动完成（设计如此）"],
            ["账号重新扫码", "平台账号登录过期后，需在电脑端打开 JIUZHANG AI 重新扫码"],
            ["微信互动", "微信联系人/群定位、群发、朋友圈仅支持电脑端（macOS 桌面微信）"],
            ["视频工作坊 / 换脸", "暂未开放"],
          ].map(([title, desc]) => (
            <div key={title} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <span style={{ color: "#d98a2d", flexShrink: 0 }}>•</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                <div style={{ fontSize: 11.5, color: "rgba(219,234,254,.58)", marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 说明 */}
      <section className="mx-px" style={{ paddingBottom: 28, marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(219,234,254,.62)" }}>
            ℹ️ 手机端适合快速查看、审批和轻量编辑；需要发布内容、重新扫码登录账号、微信互动等操作时，请到电脑端完成，避免误操作。
          </div>
        </div>
      </section>
    </div>
  );
}
