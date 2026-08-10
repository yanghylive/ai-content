# BaiLongma KAYPAL Voice Connector

This small connector lets BaiLongma stay a general voice agent while calling KAYPAL 3010 only for business tools.

## Runtime Contract

- BaiLongma handles normal chat, search, file, reminder, TTS, and local tool tasks by itself.
- KAYPAL 3010 is called only when the command matches a KAYPAL business intent.
- High-risk business actions still go through the 3010 confirmation queue.
- The connector uses a short-lived Bearer token generated in 3010 at `/admin/voice-agent`.

## Example

### Direct Node/Electron import

```ts
import { createKaypalVoiceConnector } from "@kaypal/bailongma-voice-connector";

const connector = createKaypalVoiceConnector({
  baseUrl: "http://127.0.0.1:3011/api/voice",
  accessToken: process.env.KAYPAL_VOICE_TOKEN!,
});

const result = await connector.dispatchVoiceCommand("打开待确认");

if (result.route === "kaypal") {
  console.log(result.response.responseText);
} else {
  // Continue in BaiLongma's own general-agent pipeline.
  await bailongmaGeneralAgent.run(result.fallbackText);
}
```

### Local RPC bridge

Use this when BaiLongma should call a local HTTP endpoint instead of importing
the npm package directly.

Start the bridge after generating a short-lived token in 3010 at
`/admin/voice-agent`:

```bash
KAYPAL_VOICE_BASE_URL="http://127.0.0.1:3011/api/voice" \
KAYPAL_VOICE_TOKEN="<token-from-3010>" \
KAYPAL_VOICE_RPC_KEY="<local-rpc-key>" \
KAYPAL_VOICE_RPC_PORT=43110 \
npm run start:rpc
```

Then BaiLongma can dispatch recognized voice text to the local bridge:

```bash
curl -X POST "http://127.0.0.1:43110/dispatch" \
  -H "X-KAYPAL-RPC-KEY: <local-rpc-key>" \
  -H "Content-Type: application/json" \
  -d '{"text":"打开待确认","source":"bailongma-desktop"}'
```

The `/dispatch` response has two routes:

- `route: "kaypal"` means 3010 handled the business action.
- `route: "general-agent"` means BaiLongma should continue with its own chat,
  search, file, reminder, TTS, or local tools.

Available local RPC endpoints:

- `GET /health`, public health check
- `GET /schema`, requires RPC key
- `GET /state`, requires RPC key
- `POST /heartbeat`, requires RPC key
- `POST /command`, requires RPC key
- `POST /dispatch`, requires RPC key
- `POST /confirm`, requires RPC key

Security defaults:

- The bridge binds to `127.0.0.1` by default.
- Non-loopback binding is rejected unless explicitly enabled with
  `KAYPAL_VOICE_RPC_ALLOW_NETWORK=true`.
- Business actions still use 3010's short-lived Bearer token and confirmation
  queue.

## Smoke Test

```bash
npm install
npm run build
KAYPAL_VOICE_TOKEN=... npm run smoke
npm run smoke:rpc
```

Optional environment variables:

- `KAYPAL_VOICE_BASE_URL`, default `http://127.0.0.1:3011/api/voice`
- `KAYPAL_VOICE_COMMAND`, default `现在 3010 状态怎么样`
