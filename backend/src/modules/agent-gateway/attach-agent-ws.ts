import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { AuthService, requireAuth } from './core/auth';
import { TenantContext } from './core/types';
import { AgentGatewayService } from './agent-gateway.service';

/**
 * 同源 WS 事件代理（/api/agent/octop/ws）——对齐 docs/contracts/agent.openapi.yaml 3.3。
 * - 身份：Sec-WebSocket-Protocol: kaypal-auth.<token>（首选）或 Authorization / ?token=（兼容）
 * - 会话所有权：订阅他人会话 → FORBIDDEN 关闭
 * - lastEventId 增量重放；无效/超窗 → RESUME_WINDOW_EXPIRED 关闭
 * 由 main.ts 在 listen 前调用一次。
 */
export function attachAgentGatewayWs(
  httpServer: HttpServer,
  agent: AgentGatewayService,
  auth: AuthService,
): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/agent/octop/ws',
    handleProtocols: (protocols) => {
      const match = [...(protocols as Set<string>)].find((p) => p.startsWith('kaypal-auth.'));
      return match ?? false;
    },
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') ?? '';
    const lastEventId = url.searchParams.get('lastEventId') ?? undefined;
    const protoToken = (req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .find((p) => p.startsWith('kaypal-auth.'))
      ?.slice('kaypal-auth.'.length);
    const token = protoToken ?? req.headers['authorization']?.toString() ?? url.searchParams.get('token') ?? undefined;

    void (async () => {
      // 身份：HMAC 签名令牌或 Kaypal 正式 access_token（P0-2）
      let ctx: TenantContext;
      try {
        ctx = await requireAuth(auth, token);
      } catch {
        ws.send(JSON.stringify({ error: 'UNAUTHORIZED' }));
        ws.close();
        return;
      }

      const session = agent.gateway.getSession(sessionId);
      if (!session || session.tenantId !== ctx.tenantId || session.userId !== ctx.userId || session.agentId !== ctx.agentId) {
        ws.send(JSON.stringify({ error: 'FORBIDDEN' }));
        ws.close();
        return;
      }

      try {
        const history = lastEventId
          ? agent.gateway.getEventsSince(sessionId, lastEventId)
          : agent.gateway.snapshotEvents(sessionId);
        for (const e of history) ws.send(JSON.stringify(e));
      } catch {
        ws.send(JSON.stringify({ error: 'RESUME_WINDOW_EXPIRED' }));
        ws.close();
        return;
      }

      const unsub = agent.gateway.subscribeEvents(sessionId, (event) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      });
      ws.on('close', () => unsub());
    })();
  });

  return wss;
}
