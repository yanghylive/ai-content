"use client";

import React, { useState } from "react";

/**
 * 合规中心（2026-08-09，生成式 AI 服务登记配套）：
 * 用户协议 / 隐私政策 / AI 生成内容说明 / 投诉举报 / 备案公示。
 * 依据：《生成式人工智能服务管理暂行办法》《人工智能生成合成内容标识办法》
 *      《互联网信息服务深度合成管理规定》《个人信息保护法》
 */

const TONGYI_FILING = {
  modelName: "通义千问大模型",
  modelNo: "ZheJiang-TongYiQianWen-20230901",
  algorithmName: "达摩院交互式多能型合成算法",
  algorithmNo: "网信算备 330110507206401230035 号",
};

type Tab = "terms" | "privacy" | "ai" | "report";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "terms", label: "用户协议" },
  { key: "privacy", label: "隐私政策" },
  { key: "ai", label: "AI 生成说明" },
  { key: "report", label: "投诉举报" },
];

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>("terms");

  return (
    <div>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">合规中心</h1>
            <p className="mx-page-sub">用户协议、隐私保护、AI 生成说明与投诉举报</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {/* Tab 切换 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 12,
                border: tab === t.key ? "1px solid #f6c478" : "1px solid rgba(142,165,190,.3)",
                background: tab === t.key ? "rgba(246,196,120,.12)" : "transparent",
                color: tab === t.key ? "#f6c478" : "rgba(215,230,248,.7)",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mx-card" style={{ padding: 16 }}>
          {tab === "terms" ? (
            <div style={{ fontSize: 13, lineHeight: 1.9, color: "#dbe7f5" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>用户协议</h2>
              <p style={{ margin: "0 0 12px", color: "rgba(219,234,254,.6)" }}>更新日期：2026-08-09 ｜ 生效日期：2026-08-09</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li style={{ marginBottom: 8 }}>
                  <b>服务说明</b>：本产品提供 AI 内容创作、素材管理、数据分析等功能。AI 生成内容基于大模型能力，可能存在不准确、不完整的情况，仅供创作参考，不构成专业建议。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>AI 内容标识</b>：本产品中由 AI 生成的内容（文本、图片等）均带有「AI 生成」标识，请在使用时注意甄别。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>用户责任</b>：您应对使用本产品生成的内容及其用途负责，不得利用 AI 生成功能从事违法活动、侵犯他人合法权益（包括但不限于著作权、肖像权、名誉权）或发布法律法规禁止的内容。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>未成年人保护</b>：本产品面向成年人使用。如您是未成年人，请在监护人指导下使用。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>账号安全</b>：您应妥善保管账号信息，因您自身原因导致的账号泄露或损失由您自行承担。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>服务变更与终止</b>：我们可能根据业务发展调整或终止部分服务，将提前通过合理方式通知。
                </li>
              </ol>
            </div>
          ) : null}

          {tab === "privacy" ? (
            <div style={{ fontSize: 13, lineHeight: 1.9, color: "#dbe7f5" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>隐私政策</h2>
              <p style={{ margin: "0 0 12px", color: "rgba(219,234,254,.6)" }}>更新日期：2026-08-09</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li style={{ marginBottom: 8 }}>
                  <b>收集的信息</b>：为提供 AI 服务，我们会处理您输入的对话内容、创作指令、上传的素材等必要信息。我们仅收集与服务直接相关的必要数据（最小必要原则）。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>信息用途</b>：您的输入内容用于生成 AI 回复、优化服务体验；不会用于与提供服务无关的用途，未经您的同意不会向第三方提供（法律法规要求除外）。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>AI 对话数据</b>：AI 对话记录仅用于为您提供服务与安全审计，留存期限符合法律法规要求（至少 6 个月），超期自动清理。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>您的权利</b>：您有权查阅、复制、更正、删除您的个人信息，可通过「我的记忆」管理 AI 记忆数据，或通过投诉举报入口联系我们。
                </li>
                <li style={{ marginBottom: 8 }}>
                  <b>数据安全</b>：我们采用加密传输、访问控制等措施保护您的数据安全。
                </li>
              </ol>
            </div>
          ) : null}

          {tab === "ai" ? (
            <div style={{ fontSize: 13, lineHeight: 1.9, color: "#dbe7f5" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>AI 生成内容说明与备案公示</h2>
              <p style={{ margin: "0 0 12px", color: "rgba(219,234,254,.6)" }}>
                本产品中所有 AI 生成内容（文本、图片、语音等）均带有「AI 生成」标识。AI 生成内容可能存在偏差，请理性判断、审慎使用。
              </p>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px", color: "#f4bb67" }}>使用的生成式 AI 服务（备案公示）</h3>
              <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(148,163,184,.25)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                <div>模型名称：<b>{TONGYI_FILING.modelName}</b></div>
                <div>大模型备案号：<b>{TONGYI_FILING.modelNo}</b></div>
                <div>算法名称：<b>{TONGYI_FILING.algorithmName}</b></div>
                <div>算法备案号：<b>{TONGYI_FILING.algorithmNo}</b></div>
                <div style={{ color: "rgba(219,234,254,.5)", marginTop: 4 }}>
                  备案信息可在「互联网信息服务算法备案系统」及国家网信办公示名单中查询核验。
                </div>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "rgba(219,234,254,.5)" }}>
                AI 生成的图片、视频等内容均按《人工智能生成合成内容标识办法》在元数据中携带生成标识，可溯源。
              </p>
            </div>
          ) : null}

          {tab === "report" ? (
            <div style={{ fontSize: 13, lineHeight: 1.9, color: "#dbe7f5" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>投诉与举报</h2>
              <p style={{ margin: "0 0 12px", color: "rgba(219,234,254,.6)" }}>
                如您发现本产品生成的内容存在违法违规、侵犯权益或使用体验问题，欢迎反馈。我们承诺 24 小时内响应，48 小时内处理完毕。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(148,163,184,.25)" }}>
                  <div style={{ fontSize: 12, color: "rgba(219,234,254,.6)", marginBottom: 4 }}>投诉/举报渠道</div>
                  <div style={{ fontSize: 13 }}>邮箱：<a href="mailto:support@jiuzhangai.com" style={{ color: "#f4bb67" }}>support@jiuzhangai.com</a></div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>联系电话：400-000-0000（工作日 9:00-18:00）</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>处理时限：24 小时内响应，48 小时内反馈处理结果</div>
                </div>
                <div style={{ fontSize: 12, color: "rgba(219,234,254,.5)" }}>
                  投诉时请提供：问题类型、涉及内容（截图/链接）、您的联系方式，以便我们快速定位处理。
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
