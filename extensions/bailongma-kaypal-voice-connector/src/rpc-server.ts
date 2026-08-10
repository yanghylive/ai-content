#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKaypalVoiceConnector,
  type DispatchResult,
  type KaypalVoiceConnector,
  type VoiceClientKind,
  type VoiceCommandInput,
  type VoiceCommandResult,
  type VoiceConfirmInput,
  type VoiceState,
} from './index.js';

type HeartbeatStatus = 'online' | 'idle' | 'busy';

export type KaypalVoiceRpcConnector = Pick<
  KaypalVoiceConnector,
  'state' | 'heartbeat' | 'command' | 'confirm' | 'dispatchVoiceCommand'
>;

export type KaypalVoiceRpcServerOptions = {
  baseUrl?: string;
  accessToken?: string;
  clientName?: string;
  clientKind?: VoiceClientKind;
  deviceId?: string;
  host?: string;
  port?: number;
  rpcKey?: string;
  allowNetworkBind?: boolean;
  connector?: KaypalVoiceRpcConnector;
};

export type KaypalVoiceRpcServerHandle = {
  server: Server;
  rpcKey: string;
  listen: (
    port?: number,
    host?: string,
  ) => Promise<{ url: string; rpcKey: string }>;
  close: () => Promise<void>;
};

type RpcResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_RPC_HOST = '127.0.0.1';
const DEFAULT_RPC_PORT = 43110;
const MAX_BODY_BYTES = 128 * 1024;

export function createKaypalVoiceRpcServer(
  options: KaypalVoiceRpcServerOptions,
): KaypalVoiceRpcServerHandle {
  const host = options.host || DEFAULT_RPC_HOST;
  const port = options.port || DEFAULT_RPC_PORT;
  const rpcKey = options.rpcKey?.trim() || randomBytes(24).toString('hex');

  if (!isLoopbackHost(host) && !options.allowNetworkBind) {
    throw new Error(
      'Refusing to bind KAYPAL voice RPC outside loopback. Set allowNetworkBind only for trusted networks.',
    );
  }

  const connector =
    options.connector ||
    createKaypalVoiceConnector({
      baseUrl: options.baseUrl,
      accessToken: requireAccessToken(options.accessToken),
      clientName: options.clientName,
      clientKind: options.clientKind,
      deviceId: options.deviceId,
    });

  const server = createServer(async (request, response) => {
    setCommonHeaders(request, response);

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url || '/', `http://${request.headers.host}`);

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          data: {
            status: 'ok',
            bridge: 'kaypal-bailongma-voice-rpc',
            kaypalVoiceBaseUrl: options.baseUrl || 'http://127.0.0.1:3011/api/voice',
          },
        } satisfies RpcResponse<unknown>);
        return;
      }

      if (!isAuthorized(request, rpcKey)) {
        throw new HttpError(401, 'Missing or invalid KAYPAL voice RPC key');
      }

      if (request.method === 'GET' && url.pathname === '/schema') {
        sendJson(response, 200, {
          ok: true,
          data: rpcSchema(),
        } satisfies RpcResponse<unknown>);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/state') {
        const state = await connector.state();
        sendJson(response, 200, { ok: true, data: state });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/heartbeat') {
        const body = await readJson(request);
        const heartbeat = await connector.heartbeat(readHeartbeatStatus(body));
        sendJson(response, 200, { ok: true, data: heartbeat });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/command') {
        const body = await readJson(request);
        const command = readCommandInput(body);
        const result = await connector.command(command);
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/dispatch') {
        const body = await readJson(request);
        const command = readCommandInput(body);
        const result = await connector.dispatchVoiceCommand(command);
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/confirm') {
        const body = await readJson(request);
        const result = await connector.confirm(readConfirmInput(body));
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      throw new HttpError(404, 'KAYPAL voice RPC endpoint not found');
    } catch (error) {
      const statusCode =
        error instanceof HttpError ? error.statusCode : 502;
      sendJson(response, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : 'Request failed',
      });
    }
  });

  return {
    server,
    rpcKey,
    listen: (listenPort = port, listenHost = host) =>
      listen(server, listenPort, listenHost, rpcKey),
    close: () => close(server),
  };
}

async function listen(
  server: Server,
  port: number,
  host: string,
  rpcKey: string,
) {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort =
    typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    rpcKey,
  };
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function setCommonHeaders(
  request: IncomingMessage,
  response: { setHeader: (name: string, value: string) => void },
) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const origin = request.headers.origin;
  if (typeof origin === 'string' && isLoopbackOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-KAYPAL-RPC-KEY',
    );
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS',
    );
  }
}

function sendJson(
  response: {
    writeHead: (statusCode: number) => void;
    end: (chunk: string) => void;
  },
  statusCode: number,
  body: RpcResponse<unknown>,
) {
  response.writeHead(statusCode);
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new HttpError(413, 'KAYPAL voice RPC request body is too large');
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'KAYPAL voice RPC request body must be JSON');
  }
}

function readCommandInput(value: unknown): VoiceCommandInput {
  const record = asRecord(value);
  const text = optionalString(record.text);
  if (!text) {
    throw new HttpError(400, 'Voice command text is required');
  }

  return {
    text,
    source: optionalString(record.source) || 'bailongma-desktop',
    locale: optionalString(record.locale) || undefined,
    platform: readPlatform(record.platform),
    target: readTarget(record.target),
    keyword: optionalString(record.keyword) || undefined,
    limit: readNumber(record.limit),
    confirmationId: optionalString(record.confirmationId) || undefined,
    decision: readDecision(record.decision),
    context: readRecord(record.context),
  };
}

function readConfirmInput(value: unknown): VoiceConfirmInput {
  const record = asRecord(value);
  return {
    confirmationId: optionalString(record.confirmationId) || undefined,
    decision: readDecision(record.decision),
    spokenText: optionalString(record.spokenText) || undefined,
    note: optionalString(record.note) || undefined,
    confirmedChecks: readBooleanRecord(record.confirmedChecks),
  };
}

function readHeartbeatStatus(value: unknown): HeartbeatStatus {
  const status = optionalString(asRecord(value).status);
  if (status === 'idle' || status === 'busy') return status;
  return 'online';
}

function readPlatform(value: unknown): VoiceCommandInput['platform'] {
  if (
    value === 'all' ||
    value === 'douyin' ||
    value === 'xiaohongshu' ||
    value === 'bilibili' ||
    value === 'wechat' ||
    value === 'gongzhonghao'
  ) {
    return value;
  }
  return undefined;
}

function readTarget(value: unknown): VoiceCommandInput['target'] {
  if (
    value === 'all' ||
    value === 'post' ||
    value === 'account' ||
    value === 'comment' ||
    value === 'engagement'
  ) {
    return value;
  }
  return undefined;
}

function readDecision(value: unknown): VoiceCommandInput['decision'] {
  if (value === 'approve' || value === 'reject') return value;
  return undefined;
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readBooleanRecord(value: unknown) {
  const record = readRecord(value);
  if (!record) return undefined;

  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, boolean] => {
      return typeof entry[1] === 'boolean';
    }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isAuthorized(request: IncomingMessage, rpcKey: string) {
  const headerKey = request.headers['x-kaypal-rpc-key'];
  if (headerKey === rpcKey) return true;

  const authorization = request.headers.authorization || '';
  return authorization === `Bearer ${rpcKey}`;
}

function requireAccessToken(accessToken: string | undefined) {
  const token = accessToken?.trim();
  if (!token) {
    throw new Error('KAYPAL_VOICE_TOKEN is required for the RPC bridge');
  }
  return token;
}

function isLoopbackHost(host: string) {
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]'
  );
}

function isLoopbackOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function rpcSchema() {
  return {
    bridge: 'kaypal-bailongma-voice-rpc',
    auth: {
      header: 'X-KAYPAL-RPC-KEY',
      alternative: 'Authorization: Bearer <rpc-key>',
    },
    endpoints: [
      'GET /health',
      'GET /schema',
      'GET /state',
      'POST /heartbeat',
      'POST /command',
      'POST /dispatch',
      'POST /confirm',
    ],
    dispatchContract: {
      request: {
        text: '打开待确认',
        source: 'bailongma-desktop',
      },
      kaypalRoute: {
        route: 'kaypal',
        response: sampleCommandResult('open_page', 'kaypal-voice-bridge'),
      } satisfies DispatchResult,
      generalRoute: {
        route: 'general-agent',
        fallbackText: '帮我总结这个本地文件',
        response: sampleCommandResult(
          'general_agent_fallback',
          'bailongma-general',
        ),
      } satisfies DispatchResult,
    },
  };
}

function sampleCommandResult(
  intent: VoiceCommandResult['intent'],
  handledBy: VoiceCommandResult['handledBy'],
): VoiceCommandResult {
  return {
    intent,
    handledBy,
    risk: handledBy === 'kaypal-voice-bridge' ? 'low' : 'low',
    responseText:
      handledBy === 'kaypal-voice-bridge'
        ? '可以，打开 待确认。'
        : '这条更像 BaiLongma 的通用 Agent 任务。',
  };
}

function isMainModule() {
  return process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

async function main() {
  const bridge = createKaypalVoiceRpcServer({
    baseUrl: process.env.KAYPAL_VOICE_BASE_URL,
    accessToken: process.env.KAYPAL_VOICE_TOKEN,
    clientName: process.env.KAYPAL_VOICE_CLIENT_NAME || 'BaiLongma RPC',
    clientKind:
      (process.env.KAYPAL_VOICE_CLIENT_KIND as VoiceClientKind | undefined) ||
      'bailongma-desktop',
    deviceId: process.env.KAYPAL_VOICE_DEVICE_ID,
    host: process.env.KAYPAL_VOICE_RPC_HOST || DEFAULT_RPC_HOST,
    port: Number(process.env.KAYPAL_VOICE_RPC_PORT || DEFAULT_RPC_PORT),
    rpcKey: process.env.KAYPAL_VOICE_RPC_KEY,
    allowNetworkBind: process.env.KAYPAL_VOICE_RPC_ALLOW_NETWORK === 'true',
  });
  const listening = await bridge.listen();

  console.log(
    JSON.stringify(
      {
        status: 'ready',
        url: listening.url,
        rpcKey: listening.rpcKey,
        authHeader: `X-KAYPAL-RPC-KEY: ${listening.rpcKey}`,
      },
      null,
      2,
    ),
  );
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export type { DispatchResult, VoiceCommandInput, VoiceCommandResult, VoiceState };
