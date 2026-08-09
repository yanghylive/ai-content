/**
 * 省钱返利日对账脚本（M5-3，需求清单 V1.1 §8 合规-6）：
 * 返利账本 vs 订单佣金 / 提现 / 兑换 / 账户余额，输出差异报告。
 *
 * 用法（生产）：
 *   cd /www/wwwroot/ai-content/backend
 *   env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
 *     npx ts-node src/scripts/savings-reconcile-daily.ts
 *
 * 建议：cron 每日 02:00 执行，输出到日志，差异非零时告警。
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const report: string[] = [];
  const line = (s: string) => report.push(s);

  line('=== 省钱返利日对账 ===');
  line(`时间：${new Date().toISOString()}`);

  // 1. 账本按 bizType 汇总
  const ledger = await prisma.rebateLedger.groupBy({
    by: ['bizType'],
    _sum: { changeAmount: true },
  });
  line('\n[1] 账本流水（changeAmount 汇总）');
  for (const r of ledger) {
    line(`  ${r.bizType}: ${Number(r._sum.changeAmount || 0).toFixed(2)}`);
  }

  // 2. 订单
  const orders = await prisma.cpsOrder.aggregate({
    _sum: { estCommission: true, userRebate: true },
    _count: true,
  });
  line('\n[2] 订单');
  line(
    `  单数: ${orders._count} | 预估佣金: ${Number(orders._sum.estCommission || 0).toFixed(2)} | 用户返利: ${Number(orders._sum.userRebate || 0).toFixed(2)}`,
  );

  // 3. 提现 / 兑换
  const withdrawals = await prisma.rebateWithdrawal.aggregate({
    _sum: { amount: true },
  });
  const exchanges = await prisma.rebateExchange.aggregate({
    _sum: { rebateAmount: true, creditAmount: true },
  });
  line('\n[3] 提现 / 兑换');
  line(`  提现总额: ${Number(withdrawals._sum.amount || 0).toFixed(2)}`);
  line(
    `  兑换返利: ${Number(exchanges._sum.rebateAmount || 0).toFixed(2)} → 额度 ${Number(exchanges._sum.creditAmount || 0).toFixed(2)}`,
  );

  // 4. 账户余额
  const accounts = await prisma.rebateAccount.aggregate({
    _sum: { available: true, frozen: true, pending: true, totalEarned: true },
  });
  line('\n[4] 账户余额');
  line(
    `  可用: ${Number(accounts._sum.available || 0).toFixed(2)} | 冻结: ${Number(accounts._sum.frozen || 0).toFixed(2)} | 待结算: ${Number(accounts._sum.pending || 0).toFixed(2)} | 累计: ${Number(accounts._sum.totalEarned || 0).toFixed(2)}`,
  );

  // 5. 平衡校验：累计赚取 ≈ 用户返利 - 提现 - 兑换（返利 + 冻结/待结算 = 未流出）
  const sum = (t: string) =>
    Number(ledger.find((r) => r.bizType === t)?._sum.changeAmount || 0);
  const estIn = sum('REBATE_EST') + sum('REBATE_SETTLE') + sum('REVERSE');
  const paidOut = sum('WITHDRAW_CONFIRM') + sum('EXCHANGE_CONFIRM');
  const frozenHold = sum('WITHDRAW_FREEZE') + sum('EXCHANGE_FREEZE');
  const unfrozen = sum('WITHDRAW_UNFREEZE');
  const expectedHold = accounts._sum.available
    ? Number(accounts._sum.available) +
      Number(accounts._sum.frozen) +
      Number(accounts._sum.pending)
    : 0;
  line('\n[5] 平衡校验（账本口径）');
  line(`  流入合计(est/settle/reverse): ${estIn.toFixed(2)}`);
  line(
    `  流出合计(confirm): ${paidOut.toFixed(2)} | 冻结在途: ${(frozenHold - unfrozen).toFixed(2)}`,
  );
  line(`  账户余额合计: ${expectedHold.toFixed(2)}`);
  const drift = Math.abs(
    estIn - paidOut - (frozenHold - unfrozen) - expectedHold,
  );
  line(
    `  差异: ${drift.toFixed(2)} ${drift > 0.01 ? '⚠️ 需人工核查' : '✅ 平衡'}`,
  );

  await prisma.$disconnect();
  console.log(report.join('\n'));
  process.exit(drift > 0.01 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error('对账失败:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
