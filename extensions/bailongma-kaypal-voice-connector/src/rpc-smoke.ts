import { createKaypalVoiceRpcServer } from './rpc-server.js';
import type {
  DispatchResult,
  KaypalVoiceRpcConnector,
  VoiceCommandResult,
} from './rpc-server.js';

const rpcKey = 'kaypal-rpc-smoke-key';

const fakeKaypalResponse: VoiceCommandResult = {
  intent: 'open_page',
  handledBy: 'kaypal-voice-bridge',
  risk: 'low',
  responseText: '可以，打开 待确认。',
  action: {
    type: 'open_page',
    label: '待确认',
    href: '/tasks/confirmations',
  },
};

const fakeGeneralResponse: VoiceCommandResult = {
  intent: 'general_agent_fallback',
  handledBy: 'bailongma-general',
  risk: 'low',
  responseText:
    '这条更像 BaiLongma 的通用 Agent 任务，不需要调用 3010。',
};

const fakeConnector: KaypalVoiceRpcConnector = {
  async state() {
    return {
      companion: {
        productName: 'KAYPAL AI Companion',
        mode: 'general-agent-plus-kaypal-connector',
        independentAgentAvailable: true,
        summary: 'BaiLongma independent agent plus KAYPAL connector.',
        generalCapabilities: ['voice_chat', 'web_search'],
      },
      kaypal: {
        connected: true,
        pendingConfirmations: { count: 0, items: [] },
        recentWechatTasks: { count: 0, items: [] },
      },
      tools: {},
    };
  },
  async heartbeat(status = 'online') {
    return {
      connected: true,
      userId: 'smoke-user',
      clientKind: 'bailongma-desktop',
      clientName: 'BaiLongma RPC Smoke',
      deviceId: null,
      status,
      serverTime: new Date('2026-07-05T00:00:00.000Z').toISOString(),
    };
  },
  async command(input) {
    const text = typeof input === 'string' ? input : input.text;
    return text.includes('打开') ? fakeKaypalResponse : fakeGeneralResponse;
  },
  async confirm() {
    return {
      ...fakeKaypalResponse,
      intent: 'decide_confirmation',
      responseText: '已通过语音确认。',
    };
  },
  async dispatchVoiceCommand(input) {
    const response = await this.command(input);
    if (response.handledBy === 'kaypal-voice-bridge') {
      return { route: 'kaypal', response } satisfies DispatchResult;
    }
    return {
      route: 'general-agent',
      fallbackText: typeof input === 'string' ? input : input.text,
      response,
    } satisfies DispatchResult;
  },
};

const bridge = createKaypalVoiceRpcServer({
  connector: fakeConnector,
  rpcKey,
  port: 0,
});

const listening = await bridge.listen(0);

try {
  const unauthenticated = await fetch(`${listening.url}/state`);
  assert(unauthenticated.status === 401, 'state should require rpc key');

  const health = await rpcRequest(`${listening.url}/health`);
  assert(health.ok === true, 'health should be public');

  const schema = await rpcRequest(`${listening.url}/schema`, {
    headers: { 'X-KAYPAL-RPC-KEY': rpcKey },
  });
  assert(schema.ok === true, 'schema should be available with rpc key');

  const kaypal = await rpcRequest(`${listening.url}/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KAYPAL-RPC-KEY': rpcKey,
    },
    body: JSON.stringify({ text: '打开待确认' }),
  });
  assert(kaypal.ok === true, 'dispatch should succeed');
  assert(kaypal.data.route === 'kaypal', 'KAYPAL command should route kaypal');
  assert(
    kaypal.data.response.action.href === '/tasks/confirmations',
    'KAYPAL command should preserve action',
  );

  const general = await rpcRequest(`${listening.url}/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KAYPAL-RPC-KEY': rpcKey,
    },
    body: JSON.stringify({ text: '帮我总结这个本地文件' }),
  });
  assert(general.ok === true, 'general dispatch should succeed');
  assert(
    general.data.route === 'general-agent',
    'general command should route back to BaiLongma',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: listening.url,
        kaypalRoute: kaypal.data.route,
        generalRoute: general.data.route,
      },
      null,
      2,
    ),
  );
} finally {
  await bridge.close();
}

async function rpcRequest(url: string, init?: RequestInit) {
  return (await fetch(url, init).then((response) => response.json())) as {
    ok: boolean;
    data: any;
    error?: string;
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
