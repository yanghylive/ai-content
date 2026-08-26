"use client";

import React, { useState } from "react";
import { Button, Input, addToast } from "@heroui/react";
import { CreditCard, History, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import { savingsApi, type CreditBalance, type RebateBalance } from "@/lib/api/savings";
import { toActionableError } from "@/lib/public-error";

interface WalletPanelProps {
  balance: RebateBalance | null;
  credit: CreditBalance | null;
  reload: () => Promise<void>;
}

export function WalletPanel({ balance, credit, reload }: WalletPanelProps) {
  const [showExchange, setShowExchange] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [accountMask, setAccountMask] = useState("");
  const [busy, setBusy] = useState(false);

  const toast = (title: string, color: "success" | "danger" = "success") =>
    addToast({ title, color });

  const handleExchange = async () => {
    const amount = Number(exchangeAmount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      const idem = `exchange-${Date.now()}`;
      const result = await savingsApi.exchange(amount, idem);
      toast(`✅ 兑换成功：${result.rebateAmount} 元返利 → ${result.creditAmount} AI 额度`);
      setExchangeAmount("");
      setShowExchange(false);
      await reload();
    } catch (e) {
      toast(toActionableError(e, "兑换失败"), "danger");
    } finally {
      setBusy(false);
    }
  };

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
      toast(`✅ 提现已提交（¥${result.amount}，状态 ${result.status}）——大额将人工审核`);
      setWithdrawAmount("");
      setAccountMask("");
      setShowWithdraw(false);
      await reload();
    } catch (e) {
      toast(toActionableError(e, "提现失败"), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xl font-extrabold tracking-tight text-foreground">
        <Wallet className="h-5 w-5 text-orange-500 dark:text-orange-400" />
        钱包
      </div>
      <div className="mt-0.5 text-12 text-default-500">返利去哪了，一目了然</div>

      {/* 大字余额主视觉 */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500 via-orange-500 to-amber-500 p-5 text-white shadow-lg shadow-orange-500/10">
        <div className="text-12 font-medium text-orange-100">可用返利（可提现 · 可抵算力）</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-4xl font-extrabold leading-none tracking-tight">¥{balance?.available ?? 0}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-center">
          <div>
            <div className="text-lg font-bold">¥{balance?.pending ?? 0}</div>
            <div className="text-11 text-orange-100">待结算</div>
          </div>
          <div>
            <div className="text-lg font-bold">¥{balance?.estimated ?? 0}</div>
            <div className="text-11 text-orange-100">预计</div>
          </div>
          <div>
            <div className="text-lg font-bold">¥{balance?.totalEarned ?? 0}</div>
            <div className="text-11 text-orange-100">累计获得</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            onPress={() => setShowExchange(true)}
            className="flex-1 bg-white/95 font-bold text-orange-600"
            size="sm"
          >
            <CreditCard className="h-3.5 w-3.5" />
            兑换 AI 额度
          </Button>
          <Button
            onPress={() => setShowWithdraw(true)}
            className="flex-1 border border-white/40 bg-white/10 font-bold text-white"
            size="sm"
            variant="bordered"
          >
            <Wallet className="h-3.5 w-3.5" />
            提现
          </Button>
        </div>
      </div>

      {/* 资产明细 */}
      <div className="mt-4 rounded-2xl border border-default-200 bg-white p-4 dark:border-default-800 dark:bg-content1">
        <div className="flex items-center gap-1.5 text-13 font-bold text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          资金明细
        </div>
        <div className="mt-3 space-y-2.5 text-12">
          <div className="flex items-center justify-between">
            <span className="text-default-500">可用返利（现金）</span>
            <b className="text-foreground">¥{balance?.available ?? 0}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-default-500">冻结（提现审核中）</span>
            <b className="text-foreground">¥{balance?.frozen ?? 0}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-default-500">待结算（订单确认后入账）</span>
            <b className="text-foreground">¥{balance?.pending ?? 0}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-default-500">AI 额度（积分）</span>
            <b className="text-orange-500 dark:text-orange-400">{credit?.balance ?? 0}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-default-500">AI 额度累计消耗</span>
            <b className="text-foreground">{credit?.totalConsumed ?? 0}</b>
          </div>
        </div>
      </div>

      {/* 收支流水 */}
      <div className="mt-4 rounded-2xl border border-default-200 bg-white p-4 dark:border-default-800 dark:bg-content1">
        <div className="flex items-center gap-1.5 text-13 font-bold text-foreground">
          <ReceiptText className="h-4 w-4 text-orange-500 dark:text-orange-400" />
          收支流水
        </div>
        <div className="mt-3 space-y-2.5 text-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-default-400" />
              <span className="text-default-500">累计获得返利</span>
            </div>
            <b className="text-emerald-500">+¥{balance?.totalEarned ?? 0}</b>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-3.5 w-3.5 text-default-400" />
              <span className="text-default-500">兑换/提现明细</span>
            </div>
            <span className="text-11 text-default-400">见「我的」页记录</span>
          </div>
          <div className="mt-1 rounded-lg bg-orange-50 px-3 py-2.5 text-11 leading-5 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300">
            💡 返利现金可 1:1 抵扣生图/生视频费用（积分优先，不足扣返利），与兑换额度并存——在素材中心支付时选择「返利支付」即可。
          </div>
        </div>
      </div>

      {/* 兑换弹层 */}
      {showExchange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowExchange(false)}>
          <div
            className="w-[300px] rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 text-14 font-bold text-foreground">
              <CreditCard className="h-4 w-4 text-orange-500 dark:text-orange-400" />
              返利兑换 AI 额度
            </div>
            <div className="mt-1 text-11 text-default-500">可用返利 ¥{balance?.available ?? 0}，比例 1:0.8</div>
            <Input
              type="number"
              value={exchangeAmount}
              onValueChange={setExchangeAmount}
              placeholder="兑换金额"
              size="lg"
              className="mt-3"
            />
            <div className="mt-4 flex gap-2">
              <Button
                color="primary"
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                isLoading={busy}
                onPress={() => void handleExchange()}
              >
                确认兑换
              </Button>
              <Button variant="flat" className="flex-1" onPress={() => setShowExchange(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 提现弹层 */}
      {showWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowWithdraw(false)}>
          <div
            className="w-[300px] rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 text-14 font-bold text-foreground">
              <Wallet className="h-4 w-4 text-orange-500 dark:text-orange-400" />
              返利提现
            </div>
            <div className="mt-1 text-11 text-default-500">可用返利 ¥{balance?.available ?? 0}，小额自动放行，大额人工审核</div>
            <Input
              type="number"
              value={withdrawAmount}
              onValueChange={setWithdrawAmount}
              placeholder="提现金额"
              size="lg"
              className="mt-3"
            />
            <Input
              value={accountMask}
              onValueChange={setAccountMask}
              placeholder="收款账户（如：支付宝 尾号8868）"
              size="lg"
              className="mt-2"
            />
            <div className="mt-4 flex gap-2">
              <Button
                color="primary"
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                isLoading={busy}
                onPress={() => void handleWithdraw()}
              >
                提交提现
              </Button>
              <Button variant="flat" className="flex-1" onPress={() => setShowWithdraw(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
