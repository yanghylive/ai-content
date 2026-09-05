# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

G = '/Users/yanghy/Documents/New project/ai-content/backend/src/modules/local-engine'
B = G + '/agent-panel-bridge.service.ts'

# 1) requestAction 签新单前对账
patch(B, """    const credentials = this.requireCredentials();
    const json = await this.call<{
      actionId?: string;
      binding?: { webContentsId?: number; method?: string };
    }>(credentials, '/action-request', 'POST', {""",
"""    const credentials = this.requireCredentials();
    // 审计对账（演示 2026-09-05 暴露的缺口）：桌面用户拒绝过的单过不了
    // resolveConfirmation 闸门，markApprovalSafe('rejected') 永远轮不到它——
    // 决定不落库，触达历史卡死 pending，重试还签新单（票堆积）。签新单前
    // 先问桥把该会话所有未决面板单的终态收口：rejected→已拒绝、none→已失效。
    await this.reconcileSessionTickets(actor, input.sessionId ?? null);
    const json = await this.call<{
      actionId?: string;
      binding?: { webContentsId?: number; method?: string };
    }>(credentials, '/action-request', 'POST', {""")

# 2) reconcile + markExpired 方法（挂在 markRejected 后）
patch(B, """  /** 用户在桌面面板点了「拒绝」：落库行收口为终态（status=consumed + json 标记） */
  async markRejected(actionId: string): Promise<void> {
    await this.markTicket(actionId, 'consumed');
    await this.patchConfirmationStatus(actionId, 'rejected');
  }""",
"""  /** 用户在桌面面板点了「拒绝」：落库行收口为终态（status=consumed + json 标记） */
  async markRejected(actionId: string): Promise<void> {
    await this.markTicket(actionId, 'consumed');
    await this.patchConfirmationStatus(actionId, 'rejected');
  }

  /** 桌面桥已无此单（面板重启/会话销毁）：收口为 expired，触达历史显示「已失效」 */
  async markExpired(actionId: string): Promise<void> {
    await this.markTicket(actionId, 'consumed');
    if (!this.prisma) return;
    try {
      const row = await this.prisma.agentConfirmation.findUnique({
        where: { id: actionId },
        select: { confirmationJson: true },
      });
      if (!row) return;
      const prev =
        row.confirmationJson && typeof row.confirmationJson === 'object'
          ? (row.confirmationJson as Record<string, unknown>)
          : {};
      if (prev.status) return; // 已有决定不覆盖
      await this.prisma.agentConfirmation.update({
        where: { id: actionId },
        data: {
          confirmationJson: { ...prev, status: 'expired', decidedAt: new Date().toISOString() } as unknown as object,
        },
      });
    } catch (error) {
      this.logger.warn(`面板确认单失效收口失败（${actionId}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 签新单前对账：该会话在库的未决面板单逐张问桥的真实状态，把终态收口进库。
   * - rejected → markRejected（用户点过拒绝，决定此前无法回写）
   * - none     → markExpired（桌面重启票蒸发，孤儿单收口，防触达历史永远"待你批准"）
   * - approved/pending → 不动（重试带票执行 / 浮层继续等批）
   * 桥不可达 = 整体放弃对账（不阻断签新单，审计旁路语义与落库一致）。
   */
  private async reconcileSessionTickets(
    actor: PanelBridgeActor,
    sessionId: string | null,
  ): Promise<void> {
    if (!this.prisma || !sessionId) return;
    let rows: Array<{ id: string; confirmationJson: unknown }>;
    try {
      rows = await this.prisma.agentConfirmation.findMany({
        where: { sessionId, status: 'pending' },
        select: { id: true, confirmationJson: true },
        take: 20,
      });
    } catch {
      return;
    }
    for (const row of rows) {
      if (!isPanelConfirmation(row.confirmationJson)) continue;
      const json = (row.confirmationJson || {}) as Record<string, unknown>;
      if (json.status === 'approved' || json.status === 'rejected' || json.status === 'expired') continue;
      let state: string | null = null;
      try {
        state = (await this.actionState(actor, row.id)).state;
      } catch {
        return; // 桥不可达：放弃本轮对账
      }
      if (state === 'rejected') await this.markRejected(row.id);
      else if (state === 'none') await this.markExpired(row.id);
    }
  }""")
print('BRIDGE RECONCILE DONE')
