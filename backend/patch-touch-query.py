# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

G = '/Users/yanghy/Documents/New project/ai-content/backend/src/modules/growth'

# ============ service：触达历史查询（面板确认单 = AI 代操作审计） ============
patch(G + '/growth.service.ts', """  private async findUnifiedLead(""",
"""  /**
   * 线索「触达历史」：AI 代操作在面板里对该客户做过的动作（含批/拒审批态）。
   *
   * 数据源 = AgentConfirmation（source=browser-panel 的面板确认单）按
   * confirmationJson.leadId 反查——获客跟进执行时经 agent-browser run 的
   * leadId 透传落库（executor 签单 → bridge persistTicket）。自动获客的
   * RPA 批量触达走执行记录体系（获客任务实时执行记录），不在本时间线重复。
   * json_extract 是 SQLite 能力；leadId 全局唯一（cuid），线索归属已由
   * sameGrowthRecord 作用域校验，行本身不再二次过滤。
   */
  async getLeadTouchHistory(userId: string, leadId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const item = store.leads.find((l) =>
      this.sameGrowthRecord(l, scope, leadId),
    );
    if (!item) throw new NotFoundException('线索不存在');
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, session_id AS sessionId, action, status,
               target, target_label AS targetLabel,
               confirmation_json AS confirmationJson,
               created_at AS createdAt, decided_at AS decidedAt
        FROM local_engine_agent_confirmations
        WHERE json_extract(confirmation_json, '$.leadId') = ${leadId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
    } catch (error) {
      // json_extract 不可用（非 SQLite 方言）时降级空列表，不炸详情页
      this.logger.warn(
        `[getLeadTouchHistory] 查询失败（降级空列表）：${error instanceof Error ? error.message : String(error)}`,
      );
      return { available: false, items: [], message: '触达历史暂不可用' };
    }
    const items = rows.map((r) => {
      let json: Record<string, unknown> = {};
      try {
        const raw = r.confirmationJson;
        json = typeof raw === 'string' ? JSON.parse(raw) : ((raw as Record<string, unknown>) || {});
      } catch { /* 脏数据跳过解析 */ }
      const summary = (json.summary || {}) as Record<string, unknown>;
      const decision = json.status === 'approved' || json.status === 'rejected' ? json.status : null;
      return {
        id: String(r.id),
        sessionId: r.sessionId ? String(r.sessionId) : null,
        method: String(json.method || r.action || ''),
        label: String(summary.label || r.targetLabel || json.action || '操作'),
        // 动作内容摘要（审批卡片同源）：目标元素文本 / 输入文本 / 导航 URL
        detail: String(summary.targetText || summary.text || summary.url || ''),
        // 生命周期：pending（待批）/ approved（批准待执行）/ rejected（拒绝终态）
        //          / consumed（已执行完成）/ in_use（执行中）
        status: String(r.status || ''),
        decision,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      };
    });
    return { available: true, items };
  }

  private async findUnifiedLead(""")

# ============ controller：路由（挂在 attribution 后） ============
patch(G + '/growth.controller.ts', """  @Delete('leads/:id')""",
"""  @Get('leads/:id/touch-history')
  getLeadTouchHistory(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.growthService.getLeadTouchHistory(this.getUserId(request), id);
  }

  @Delete('leads/:id')""")
print('QUERY API DONE')
