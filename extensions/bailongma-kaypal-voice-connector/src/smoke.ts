import { createKaypalVoiceConnector } from './index.js';

const accessToken = process.env.KAYPAL_VOICE_TOKEN;

if (!accessToken) {
  console.error('Missing KAYPAL_VOICE_TOKEN');
  process.exit(1);
}

const connector = createKaypalVoiceConnector({
  baseUrl: process.env.KAYPAL_VOICE_BASE_URL,
  accessToken,
  clientName: 'BaiLongma Smoke',
});

const command = process.env.KAYPAL_VOICE_COMMAND || '现在 3010 状态怎么样';

const heartbeat = await connector.heartbeat('online');
const result = await connector.dispatchVoiceCommand(command);

console.log(
  JSON.stringify(
    {
      heartbeat,
      route: result.route,
      intent: result.response.intent,
      handledBy: result.response.handledBy,
      risk: result.response.risk,
      responseText: result.response.responseText,
    },
    null,
    2,
  ),
);
