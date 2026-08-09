"use client";

import { useCallback, useEffect, useState } from "react";
import { savingsApi } from "@/lib/api/savings";

/**
 * 省钱返利管理后台（M5）：
 * 订单 / 提现审核 / 兑换 / 对账 / 供应商 五个 Tab。
 * 鉴权：后端 requireAdmin（组织 admin/owner）。
 */

type Tab = "orders" | "withdrawals" | "exchanges" | "reconcile" | "vendors";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "orders", label: "📦 订单" },
  { key: "withdrawals", label: "💸 提现审核" },
  { key: "exchanges", label: "⚡ 兑换" },
  { key: "reconcile", label: "📊 对账" },
  { key: "vendors", label: "🔌 供应商" },
];

export default function SavingsAdminPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Array<Record<string, unknown>>>([]);
  const [wdTotal, setWdTotal] = useState(0);
  const [exchanges, setExchanges] = useState<Array<Record<string, unknown>>>([]);
  const [reconcile, setReconcile] = useState<Record<string, unknown> | null>(null);
  const [vendors, setVendors] = useState<Array<Record<string, unknown>>>([]);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const [o, w, e, r, v] = await Promise.all([
        savingsApi.adminOrders().catch(() => ({ items: [], total: 0, page: 1 })),
        savingsApi.adminWithdrawals().catch(() => ({ items: [], total: 0, page: 1 })),
        savingsApi.adminExchanges().catch(() => ({ items: [], total: 0, page: 1 })),
        savingsApi.adminReconcile().catch(() => null),
        savingsApi.adminVendors().catch(() => []),
      ]);
      setOrders(o.items as Array<Record<string, unknown>>);
      setOrderTotal(o.total);
      setWithdrawals(w.items as Array<Record<string, unknown>>);
      setWdTotal(w.total);
      setExchanges(e.items as Array<Record<string, unknown>>);
      setReconcile(r as Record<string, unknown> | null);
      setVendors(v as Array<Record<string, unknown>>);
    } catch {
      setMsg("❌ 加载失败（需要组织管理员权限）");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 提现审核 */
  const review = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    try {
      if (action === "approve") await savingsApi.adminApproveWithdrawal(id);
      else await savingsApi.adminRejectWithdrawal(id, "管理员驳回");
      setMsg(`✅ 已${action === "approve" ? "通过" : "驳回"}（渠道打款处理中）`);
      await load();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "操作失败"}`);
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(142,165,190,.2)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  };
  const label = { fontSize: 11, color: "rgba(215,230,248,.5)", marginBottom: 2 } as const;
  const value = { fontSize: 13, color: "#e8f1fb", fontWeight: 600 } as const;

  return (
    <div style={{ padding: 16, color: "#e8f1fb", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>🛠️ 省钱返利管理</div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(142,165,190,.3)", borderRadius: 8, padding: "6px 12px", color: "#d7e6f8", fontSize: 12, cursor: "pointer" }}
        >
          {busy ? "加载中…" : "刷新"}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 12, color: "#7ee2a8", marginBottom: 10 }}>{msg}</div>
      )}

      {/* Tab 切换 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? "linear-gradient(135deg,#f6c478,#e8a94e)" : "rgba(255,255,255,.06)",
              border: "1px solid rgba(142,165,190,.25)",
              borderRadius: 8,
              padding: "6px 12px",
              color: tab === t.key ? "#1a1d24" : "#d7e6f8",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 订单 */}
      {tab === "orders" && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(215,230,248,.5)", marginBottom: 8 }}>
            共 {orderTotal} 单
          </div>
          {orders.length === 0 && <div style={{ ...card, textAlign: "center", color: "rgba(215,230,248,.4)" }}>暂无订单</div>}
          {orders.map((o) => (
            <div key={String(o.id)} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={value}>{String(o.orderNo || "").slice(0, 24)}</span>
                <span style={{ fontSize: 11, color: "#f6c478" }}>{String(o.platformCode || "")}</span>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
                <span>实付 <b style={{ color: "#f6c478" }}>¥{Number(o.payAmount || 0)}</b></span>
                <span>佣金 <b style={{ color: "#7ee2a8" }}>¥{Number(o.estCommission || 0)}</b></span>
                <span>用户返利 <b style={{ color: "#7ee2a8" }}>¥{Number(o.userRebate || 0)}</b></span>
                <span style={{ color: "rgba(215,230,248,.5)" }}>{String(o.status || "")}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 提现审核 */}
      {tab === "withdrawals" && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(215,230,248,.5)", marginBottom: 8 }}>
            共 {wdTotal} 笔（REVIEWING = 待审核）
          </div>
          {withdrawals.length === 0 && <div style={{ ...card, textAlign: "center", color: "rgba(215,230,248,.4)" }}>暂无提现</div>}
          {withdrawals.map((w) => (
            <div key={String(w.id)} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={value}>¥{Number(w.amount || 0)}</div>
                  <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 2 }}>
                    {String(w.channel || "")} ｜ {String(w.accountMask || "")} ｜ {String(w.status || "")}
                  </div>
                </div>
                {String(w.status) === "REVIEWING" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => void review(String(w.id), "approve")}
                      disabled={busy}
                      style={{ background: "linear-gradient(135deg,#7ee2a8,#4caf7d)", border: "none", borderRadius: 6, padding: "5px 10px", color: "#1a1d24", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      onClick={() => void review(String(w.id), "reject")}
                      disabled={busy}
                      style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,120,120,.4)", borderRadius: 6, padding: "5px 10px", color: "#ff9b9b", fontSize: 11, cursor: "pointer" }}
                    >
                      驳回
                    </button>
                  </div>
                )}
              </div>
              {w.failReason ? (
                <div style={{ fontSize: 11, color: "#ff9b9b", marginTop: 4 }}>
                  原因：{String(w.failReason as string)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* 兑换 */}
      {tab === "exchanges" && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(215,230,248,.5)", marginBottom: 8 }}>共 {exchanges.length} 笔</div>
          {exchanges.length === 0 && <div style={{ ...card, textAlign: "center", color: "rgba(215,230,248,.4)" }}>暂无兑换</div>}
          {exchanges.map((x) => (
            <div key={String(x.id)} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={value}>¥{Number(x.rebateAmount || 0)} → {Number(x.creditAmount || 0)} 额度</span>
                <span style={{ fontSize: 11, color: "rgba(215,230,248,.5)" }}>{String(x.status || "")}</span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 4 }}>{String(x.createdAt || "")}</div>
            </div>
          ))}
        </div>
      )}

      {/* 对账 */}
      {tab === "reconcile" && reconcile && (
        <div>
          <div style={{ fontSize: 12, color: "rgba(215,230,248,.5)", marginBottom: 8 }}>返利账本 vs 订单/提现/兑换</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {[
              ["订单预估佣金", `¥${Number((reconcile.orders as Record<string, unknown>)?.estCommission || 0)}`],
              ["用户返利", `¥${Number((reconcile.orders as Record<string, unknown>)?.userRebate || 0)}`],
              ["提现总额", `¥${Number(reconcile.withdrawals || 0)}`],
              ["兑换返利", `¥${Number((reconcile.exchanges as Record<string, unknown>)?.rebateAmount || 0)}`],
              ["账户可用", `¥${Number((reconcile.accounts as Record<string, unknown>)?.available || 0)}`],
              ["账户冻结", `¥${Number((reconcile.accounts as Record<string, unknown>)?.frozen || 0)}`],
              ["账户待结算", `¥${Number((reconcile.accounts as Record<string, unknown>)?.pending || 0)}`],
              ["累计赚取", `¥${Number((reconcile.accounts as Record<string, unknown>)?.totalEarned || 0)}`],
            ].map(([k, v]) => (
              <div key={String(k)} style={card}>
                <div style={label}>{k}</div>
                <div style={value}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 供应商 */}
      {tab === "vendors" && (
        <div>
          {vendors.length === 0 && <div style={{ ...card, textAlign: "center", color: "rgba(215,230,248,.4)" }}>暂无供应商</div>}
          {vendors.map((v) => (
            <div key={String(v.code)} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={value}>{String(v.code)}</span>
                <span style={{ fontSize: 11, color: v.ready ? "#7ee2a8" : "#f6c478" }}>
                  {v.ready ? "✅ 就绪" : "⏳ 凭证未齐"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(215,230,248,.5)", marginTop: 4 }}>
                {Object.entries(v.configured as Record<string, boolean>)
                  .map(([k, ok]) => `${k}: ${ok ? "✅" : "❌"}`)
                  .join("  ")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
