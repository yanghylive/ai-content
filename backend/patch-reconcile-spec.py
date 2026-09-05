# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

S = '/Users/yanghy/Documents/New project/ai-content/backend/src/modules/local-engine/agent-panel-bridge.service.spec.ts'

# stub 支持 /action-state（opts.actionStates 映射）
patch(S, """      if (route === '/action-request' && req.method === 'POST') {""",
"""      if (route === '/action-state' && req.method === 'POST') {
        const state = opts?.actionStates?.[String(body.actionId)] ?? 'pending';
        return send(200, { success: true, data: { actionId: body.actionId, state, panelId: 'panel-1', method: 'Page.navigate' } });
      }
      if (route === '/action-request' && req.method === 'POST') {""")
patch(S, """function startStubBridge(
  token: string,
  opts?: { slowScreenshotMs?: number },
) {""",
"""function startStubBridge(
  token: string,
  opts?: { slowScreenshotMs?: number; actionStates?: Record<string, string> },
) {""")

# setup 透传 actionStates
patch(S, """  async function setup(opts: { failOnUpsert?: boolean; withPrisma?: boolean } = {}) {
    const stub = await startStubBridge('tok-1');""",
"""  async function setup(opts: { failOnUpsert?: boolean; withPrisma?: boolean; actionStates?: Record<string, string> } = {}) {
    const stub = await startStubBridge('tok-1', { actionStates: opts.actionStates });""")

# 新用例：签新单前对账（rejected→落库终态；none→expired；pending 不动）
patch(S, """  it('审计旁路：落库抛错不阻断签单（拿不到库也得拿到票号）', async () => {""",
"""  it('签单对账：桌面已拒绝/已失效的旧面板单在签新单前收口落库（演示暴露的缺口）', async () => {
    const { stub, svc, prisma } = await setup({ actionStates: { 'old-rej': 'rejected', 'old-gone': 'none', 'old-wait': 'pending' } });
    try {
      // 预置三张该会话的未决面板单
      for (const id of ['old-rej', 'old-gone', 'old-wait']) {
        await svc.requestAction(ACTOR, { method: 'Page.navigate', params: { url: 'https://kaypal.cn/x' }, sessionId: 'agent-session-7' });
        // 手工改主键不可行（stub 恒返回 act-1）→ 直接种桩行
        prisma!.rows.set(id, {
          id, sessionId: 'agent-session-7', status: 'pending', action: 'Page.navigate',
          confirmationJson: { id, source: 'browser-panel', sessionId: 'agent-session-7', method: 'Page.navigate', status: null },
        });
      }
      // 清掉 requestAction 第一次种的 act-1，避免干扰
      prisma!.rows.delete('act-1');
      // 再签一张新单 → 触发对账
      await svc.requestAction(ACTOR, { method: 'Page.navigate', params: { url: 'https://kaypal.cn/y' }, sessionId: 'agent-session-7' });
      const rej = prisma!.rows.get('old-rej')!;
      expect(rej.status).toBe('consumed');
      expect((rej.confirmationJson as Record<string, unknown>).status).toBe('rejected');
      const gone = prisma!.rows.get('old-gone')!;
      expect(gone.status).toBe('consumed');
      expect((gone.confirmationJson as Record<string, unknown>).status).toBe('expired');
      const wait = prisma!.rows.get('old-wait')!;
      expect(wait.status).toBe('pending', '桥仍 pending 的单不动');
    } finally {
      await stub.close();
    }
  });

  it('审计旁路：落库抛错不阻断签单（拿不到库也得拿到票号）', async () => {""")
print('SPEC DONE')
