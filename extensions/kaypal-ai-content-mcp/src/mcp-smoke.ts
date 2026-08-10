import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, '..');
const projectRoot = resolve(extensionRoot, '../..');
const serverPath = resolve(__dirname, 'index.js');
const nodeBin = process.env.KAYPAL_AI_CONTENT_NODE_BIN || process.execPath;

const client = new Client({
  name: 'kaypal-ai-content-mcp-smoke',
  version: '0.1.0',
});

const transport = new StdioClientTransport({
  command: nodeBin,
  args: [serverPath],
  cwd: extensionRoot,
  env: {
    ...process.env,
    KAYPAL_AI_CONTENT_API_BASE:
      process.env.KAYPAL_AI_CONTENT_API_BASE || 'http://127.0.0.1:3011/api',
    KAYPAL_AI_CONTENT_FRONTEND_BASE:
      process.env.KAYPAL_AI_CONTENT_FRONTEND_BASE || 'http://127.0.0.1:3010',
    KAYPAL_AI_CONTENT_ROOT:
      process.env.KAYPAL_AI_CONTENT_ROOT || projectRoot,
    KAYPAL_AI_CONTENT_LOCAL_MCP_AUTH_FILE:
      process.env.KAYPAL_AI_CONTENT_LOCAL_MCP_AUTH_FILE ||
      resolve(projectRoot, 'backend/data/local-mcp-auth.json'),
  } as Record<string, string>,
  stderr: 'pipe',
});

async function callTool(name: string, args: Record<string, unknown>) {
  return client.request(
    {
      method: 'tools/call',
      params: { name, arguments: args },
    },
    CallToolResultSchema,
  );
}

function firstText(result: Awaited<ReturnType<typeof callTool>>): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : JSON.stringify(first, null, 2);
}

async function main(): Promise<void> {
  const stderr = transport.stderr;
  if (stderr) {
    stderr.on('data', (chunk) => {
      process.stderr.write(`[server] ${chunk.toString()}`);
    });
  }

  await client.connect(transport);

  const tools = await client.request(
    { method: 'tools/list', params: {} },
    ListToolsResultSchema,
  );
  console.log(`tools=${tools.tools.length}`);
  console.log(tools.tools.map((tool) => tool.name).join('\n'));

  const resources = await client.request(
    { method: 'resources/list', params: {} },
    ListResourcesResultSchema,
  );
  console.log(`resources=${resources.resources.length}`);
  console.log(resources.resources.map((resource) => resource.uri).join('\n'));

  const appResource = await client.request(
    {
      method: 'resources/read',
      params: { uri: 'ui://apps/kaypal-ai-content' },
    },
    ReadResourceResultSchema,
  );
  const appContent = appResource.contents[0];
  console.log('\n--- ui://apps/kaypal-ai-content ---');
  console.log(
    JSON.stringify(
      {
        uri: appContent?.uri,
        mimeType: appContent?.mimeType,
        hasText:
          Boolean(appContent && 'text' in appContent && appContent.text.length > 1000),
      },
      null,
      2,
    ),
  );

  const app = await callTool('kaypal_ai_content_open_app', {});
  console.log('\n--- kaypal_ai_content_open_app ---');
  console.log(firstText(app));

  const health = await callTool('kaypal_ai_content_health_check', {});
  console.log('\n--- kaypal_ai_content_health_check ---');
  console.log(firstText(health));

  const services = await callTool('kaypal_ai_content_local_services', {
    action: 'status',
  });
  console.log('\n--- kaypal_ai_content_local_services status ---');
  console.log(firstText(services));

  const runtime = await callTool('kaypal_ai_content_runtime_status', {});
  console.log('\n--- kaypal_ai_content_runtime_status ---');
  console.log(firstText(runtime));

  await transport.close();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await transport.close();
  } catch {
    // ignore close error in smoke failure path
  }
  process.exit(1);
});
