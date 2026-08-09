"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  savingsApi,
  type OfferView,
  type RebateBalance,
  type CreditBalance,
  type PriceWatch,
} from "@/lib/api/savings";

/** 快捷功能入口 */
const QUICK_ACTIONS = [
  { label: "比价", icon: "🔍", action: "search" },
  { label: "监控", icon: "⏰", action: "watch" },
  { label: "兑换额度", icon: "⚡", action: "exchange" },
  { label: "提现", icon: "💸", action: "withdraw" },
  { label: "采购", icon: "🛒", action: "procurement" },
  { label: "我的订单", icon: "📦", action: "orders" },
];

export default function SavingsPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [balance, setBalance] = useState<RebateBalance | null>(null);
  const [credit, setCredit] = useState<CreditBalance | null>(null);
  const [watches, setWatches] = useState<PriceWatch[]>([]);
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [accountMask, setAccountMask] = useState("");
  const [showExchange, setShowExchange] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [meituanActs, setMeituanActs] = useState<OfferView[]>([]);
  const [promoLink, setPromoLink] = useState<string | null>(null);
  const [showPromo, setShowPromo] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [b, c, w, mt] = await Promise.all([
        savingsApi.rebateBalance(),
        savingsApi.creditBalance(),
        savingsApi.listWatches(),
        savingsApi.meituanActivities().catch(() => []),
      ]);
      setBalance(b);
      setCredit(c);
      setWatches(w);
      setMeituanActs(mt);
    } catch {
      /* 未登录或接口暂不可用时静默 */
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 解析/搜索 */
  const handleSearch = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // 含 http/口令 → 解析；否则关键词搜索
      const looksLikeLink = /https?:\/\/|[¥￥]/.test(text);
      if (looksLikeLink) {
        const offer = await savingsApi.parse(text);
        setOffers([offer]);
      } else {
        const list = await savingsApi.search(text);
        setOffers(list.slice(0, 10));
      }
      setMsg(`✅ 找到 ${offers.length} 个结果`);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "查询失败（大淘客 Key 配置后可查询）"}`);
    } finally {
      setBusy(false);
    }
  };

  /** 兑换 AI 额度 */
  const handleExchange = async () => {
    const amount = Number(exchangeAmount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      const idem = `exchange-${Date.now()}`;
      const result = await savingsApi.exchange(amount, idem);
      setMsg(
        `✅ 兑换成功：${result.rebateAmount} 元返利 → ${result.creditAmount} AI 额度`,
      );
      setExchangeAmount("");
      setShowExchange(false);
      await loadAll();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "兑换失败"}`);
    } finally {
      setBusy(false);
    }
  };

  /** 美团活动生成推广链接 */
  const handleTranslink = async (act: OfferView) => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await savingsApi.translink({
        platformCode: "meituan",
        activityId: act.itemId,
      });
      setPromoLink(result.promoUrl);
      setShowPromo(true);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "生成推广链接失败"}`);
    } finally {
      setBusy(false);
    }
  };

  /** 提现 */
  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0 || !accountMask.trim()) return;
    setBusy(true);
    try {
      const idem = `withdraw-${Date.now()}`;
      const result = await savingsApi.withdraw({
        amount,
        channel: "mock",
        accountMask: accountMask.trim(),
        idempotencyKey: idem,
      });
      setMsg(
        `✅ 提现已提交（¥${result.amount}，状态 ${result.status}）——大额将人工审核`,
      );
      setWithdrawAmount("");
      setAccountMask("");
      setShowWithdraw(false);
      await loadAll();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "提现失败"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f6c478" }}>
            💰 省钱返利
          </div>
          <div style={{ fontSize: 12, color: "rgba(215,230,248,.5)", marginTop: 2 }}>
            本来就要买，顺手省钱，返利还能抵算力
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", color: "#d7e6f8", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
        >
          刷新
        </button>
      </div>

      {/* 搜索/解析输入 */}
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          placeholder="粘贴商品链接/口令，或输入关键词搜索"
          style={{
            flex: 1,
            background: "rgba(255,255,255,.06)",
            border: "1px solid rgba(142,165,190,.3)",
            borderRadius: 10,
            padding: "10px 12px",
            color: "#e8f1fb",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={busy}
          style={{
            background: "linear-gradient(135deg,#f6c478,#e8a94e)",
            border: "none",
            borderRadius: 10,
            padding: "0 16px",
            color: "#1a1d24",
            fontWeight: 700,
            fontSize: 13,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "…" : "查"}
        </button>
      </div>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#f6c478", wordBreak: "break-all" }}>
          {msg}
        </div>
      )}

      {/* 返利资产卡 */}
      <div
        style={{
          marginTop: 14,
          background: "linear-gradient(135deg, rgba(246,196,120,.12), rgba(246,196,120,.04))",
          border: "1px solid rgba(246,196,120,.3)",
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(215,230,248,.6)" }}>
          <span>可用 <b style={{ color: "#f6c478", fontSize: 18 }}>¥{balance?.available ?? 0}</b></span>
          <span>待结算 <b style={{ color: "#d7e6f8" }}>¥{balance?.pending ?? 0}</b></span>
          <span>预计 <b style={{ color: "#d7e6f8" }}>¥{balance?.estimated ?? 0}</b></span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(215,230,248,.6)" }}>
          累计获得 ¥{balance?.totalEarned ?? 0} ｜ AI 额度{" "}
          <b style={{ color: "#f6c478" }}>{credit?.balance ?? 0}</b>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowExchange(true)}
            style={{ flex: 1, background: "rgba(246,196,120,.15)", border: "1px solid rgba(246,196,120,.4)", borderRadius: 8, padding: "8px 0", color: "#f6c478", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            ⚡ 兑换 AI 额度
          </button>
          <button
            type="button"
            onClick={() => setShowWithdraw(true)}
            style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 0", color: "#d7e6f8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            💸 提现
          </button>
        </div>
      </div>

      {/* 快捷功能 */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {QUICK_ACTIONS.map((q) => (
          <div
            key={q.action}
            onClick={() => {
              if (q.action === "exchange") setShowExchange(true);
              if (q.action === "withdraw") setShowWithdraw(true);
            }}
            style={{
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(142,165,190,.2)",
              borderRadius: 10,
              padding: "10px 0",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 18 }}>{q.icon}</div>
            <div style={{ fontSize: 12, color: "#d7e6f8", marginTop: 4 }}>{q.label}</div>
          </div>
        ))}
      </div>

      {/* 美团本地生活 */}
      {meituanActs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#d7e6f8" }}>
              🍜 美团本地生活（{meituanActs.length}）
            </div>
            <div style={{ fontSize: 10, color: "rgba(215,230,248,.4)" }}>外卖/到店/买菜，点卡片生成推广链接</div>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {meituanActs.map((a, i) => (
              <div
                key={`mt-${a.itemId}-${i}`}
                onClick={() => void handleTranslink(a)}
                style={{
                  flex: "0 0 140px",
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(142,165,190,.2)",
                  borderRadius: 10,
                  padding: 8,
                  cursor: "pointer",
                }}
              >
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt={a.title}
                    style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6 }}
                  />
                ) : (
                  <div style={{ width: "100%", height: 70, borderRadius: 6, background: "linear-gradient(135deg,#3a4152,#2a2f3a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                    🍜
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#e8f1fb", fontWeight: 600, marginTop: 6, lineHeight: 1.4 }}>
                  {a.title.slice(0, 16)}
                </div>
                {a.commissionRate > 0 && (
                  <div style={{ fontSize: 10, color: "#7ee2a8", marginTop: 3 }}>
                    佣金 {a.commissionRate}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 比价结果 */}
      {offers.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#d7e6f8", marginBottom: 8 }}>
            比价结果（{offers.length}）
          </div>
          {offers.map((o, i) => (
            <div
              key={`${o.itemId}-${i}`}
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(142,165,190,.2)",
                borderRadius: 10,
                padding: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 13, color: "#e8f1fb", fontWeight: 600 }}>
                {o.title.slice(0, 40)}
              </div>
              <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 2 }}>
                {o.shopName || ""} ｜ {o.platformCode}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12 }}>
                <span>
                  支付价 <b style={{ color: "#f6c478" }}>¥{o.payPrice}</b>
                </span>
                <span>
                  返利 <b style={{ color: "#7ee2a8" }}>¥{o.estRebate}</b>
                </span>
                <span>
                  净成本 <b style={{ color: "#7ee2a8" }}>¥{o.estNetCost}</b>
                </span>
              </div>
              {o.couponAmount > 0 && (
                <div style={{ fontSize: 11, color: "#f6c478", marginTop: 4 }}>
                  🎫 优惠券 ¥{o.couponAmount}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 监控列表 */}
      {watches.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#d7e6f8", marginBottom: 8 }}>
            价格监控（{watches.length}）
          </div>
          {watches.slice(0, 5).map((w) => (
            <div
              key={w.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(142,165,190,.2)",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "#e8f1fb" }}>{w.title.slice(0, 24)}</div>
              <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)" }}>
                {w.targetPayPrice ? `≤¥${w.targetPayPrice}` : ""}
                {w.minRebate ? ` 返利≥¥${w.minRebate}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 兑换弹层 */}
      {showExchange && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#1e2430", border: "1px solid rgba(142,165,190,.3)", borderRadius: 14, padding: 18, width: 300 }}>
            <div style={{ color: "#f6c478", fontWeight: 700, fontSize: 15 }}>⚡ 返利兑换 AI 额度</div>
            <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 4 }}>
              可用返利 ¥{balance?.available ?? 0}，比例 1:0.8
            </div>
            <input
              type="number"
              value={exchangeAmount}
              onChange={(e) => setExchangeAmount(e.target.value)}
              placeholder="兑换金额"
              style={{ width: "100%", marginTop: 10, background: "rgba(255,255,255,.06)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 10px", color: "#e8f1fb", fontSize: 13, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void handleExchange()}
                disabled={busy}
                style={{ flex: 1, background: "linear-gradient(135deg,#f6c478,#e8a94e)", border: "none", borderRadius: 8, padding: "8px 0", color: "#1a1d24", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              >
                确认兑换
              </button>
              <button
                type="button"
                onClick={() => setShowExchange(false)}
                style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 0", color: "#d7e6f8", fontSize: 12, cursor: "pointer" }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 推广链接弹层 */}
      {showPromo && promoLink && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#1e2430", border: "1px solid rgba(142,165,190,.3)", borderRadius: 14, padding: 18, width: 300 }}>
            <div style={{ color: "#7ee2a8", fontWeight: 700, fontSize: 15 }}>🔗 推广链接已生成</div>
            <div
              style={{
                marginTop: 10,
                background: "rgba(255,255,255,.06)",
                border: "1px solid rgba(142,165,190,.3)",
                borderRadius: 8,
                padding: 10,
                color: "#e8f1fb",
                fontSize: 11,
                wordBreak: "break-all",
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {promoLink}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(promoLink);
                  setShowPromo(false);
                  setMsg("✅ 推广链接已复制");
                }}
                style={{ flex: 1, background: "linear-gradient(135deg,#f6c478,#e8a94e)", border: "none", borderRadius: 8, padding: "8px 0", color: "#1a1d24", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              >
                复制链接
              </button>
              <button
                type="button"
                onClick={() => setShowPromo(false)}
                style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 0", color: "#d7e6f8", fontSize: 12, cursor: "pointer" }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提现弹层 */}
      {showWithdraw && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#1e2430", border: "1px solid rgba(142,165,190,.3)", borderRadius: 14, padding: 18, width: 300 }}>
            <div style={{ color: "#f6c478", fontWeight: 700, fontSize: 15 }}>💸 返利提现</div>
            <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 4 }}>
              可用返利 ¥{balance?.available ?? 0}，小额自动放行，大额人工审核
            </div>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="提现金额"
              style={{ width: "100%", marginTop: 10, background: "rgba(255,255,255,.06)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 10px", color: "#e8f1fb", fontSize: 13, outline: "none" }}
            />
            <input
              value={accountMask}
              onChange={(e) => setAccountMask(e.target.value)}
              placeholder="收款账户（如：支付宝 尾号8868）"
              style={{ width: "100%", marginTop: 8, background: "rgba(255,255,255,.06)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 10px", color: "#e8f1fb", fontSize: 13, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void handleWithdraw()}
                disabled={busy}
                style={{ flex: 1, background: "linear-gradient(135deg,#f6c478,#e8a94e)", border: "none", borderRadius: 8, padding: "8px 0", color: "#1a1d24", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              >
                提交提现
              </button>
              <button
                type="button"
                onClick={() => setShowWithdraw(false)}
                style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "8px 0", color: "#d7e6f8", fontSize: 12, cursor: "pointer" }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
