# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

# ============ 1) bridge spec：leadId 落库断言 ============
patch('/Users/yanghy/Documents/New project/ai-content/backend/src/modules/local-engine/agent-panel-bridge.service.spec.ts',
"""      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
        summary: { label: '导航', url: 'https://kaypal.cn/x' },
        sessionId: 'agent-session-7',
      });""",
"""      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
        summary: { label: '导航', url: 'https://kaypal.cn/x' },
        sessionId: 'agent-session-7',
        leadId: 'lead-1788495284452-2c4509',
      });""")
patch('/Users/yanghy/Documents/New project/ai-content/backend/src/modules/local-engine/agent-panel-bridge.service.spec.ts',
"""      const json = row!.confirmationJson as Record<string, unknown>;
      expect(json.source).toBe('browser-panel');
      expect(json.sessionId).toBe('agent-session-7');
      expect(json.status).toBe('pending');""",
"""      const json = row!.confirmationJson as Record<string, unknown>;
      expect(json.source).toBe('browser-panel');
      expect(json.sessionId).toBe('agent-session-7');
      expect(json.status).toBe('pending');
      // 触达审计：leadId 随签单落进 confirmationJson（线索详情按它反查触达历史）
      expect(json.leadId).toBe('lead-1788495284452-2c4509');""")

# ============ 2) 前端 API 方法 + DTO ============
F = '/Users/yanghy/Documents/New project/ai-content/frontend/src/lib/api/growth.ts'
patch(F, """    getLeadAttribution: (id: string) =>
        api.get<LeadAttributionDto>(`/growth/leads/${id}/attribution`),""",
"""    getLeadAttribution: (id: string) =>
        api.get<LeadAttributionDto>(`/growth/leads/${id}/attribution`),
    // AI 代操作触达历史（面板确认单时间线：签单→审批→执行）
    getLeadTouchHistory: (id: string) =>
        api.get<LeadTouchHistoryDto>(`/growth/leads/${id}/touch-history`),""")

patch(F, """export interface LeadScoreHistoryDto {""",
"""export interface LeadTouchHistoryDto {
    available: boolean;
    message?: string;
    items: Array<{
        id: string;
        sessionId: string | null;
        method: string;
        label: string;
        detail: string;
        /** pending 待批 / approved 已批待执行 / in_use 执行中 / consumed 已完成 / rejected 已拒 */
        status: string;
        decision: "approved" | "rejected" | null;
        createdAt: string;
        decidedAt: string | null;
    }>;
}

export interface LeadScoreHistoryDto {""")
print('BATCH DONE')
