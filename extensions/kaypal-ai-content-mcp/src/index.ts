#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createKaypalAiContentAppHtml,
  createKaypalAiContentAppMetadata,
  KAYPAL_AI_CONTENT_APP_MIME_TYPE,
  KAYPAL_AI_CONTENT_APP_URI,
} from './app-resource.js';
import { createContext } from './context.js';
import { registerKaypalAiContentTools } from './tools.js';

async function main(): Promise<void> {
  const ctx = createContext();
  const server = new McpServer({
    name: 'kaypal-ai-content-mcp',
    version: '0.1.0',
  });

  registerKaypalAiContentTools(server, ctx);

  server.registerResource(
    'kaypal-ai-content-app',
    KAYPAL_AI_CONTENT_APP_URI,
    {
      title: 'Kaypal AI Content',
      description:
        'Kaypal AI Content Goose MCP 应用入口，连接本机 3010/3011 工作台。',
      mimeType: KAYPAL_AI_CONTENT_APP_MIME_TYPE,
      _meta: {
        'io.modelcontextprotocol/ui': {
          mimeTypes: [KAYPAL_AI_CONTENT_APP_MIME_TYPE],
        },
      },
    },
    async () => ({
      contents: [
        {
          ...createKaypalAiContentAppMetadata(),
          mimeType: KAYPAL_AI_CONTENT_APP_MIME_TYPE,
          text: createKaypalAiContentAppHtml(),
          _meta: {
            'io.modelcontextprotocol/ui': {
              mimeTypes: [KAYPAL_AI_CONTENT_APP_MIME_TYPE],
              prefersBorder: false,
              csp: {
                connectDomains: [
                  'http://127.0.0.1:3010',
                  'http://127.0.0.1:3011',
                  'http://localhost:3010',
                  'http://localhost:3011',
                ],
              },
            },
          },
        },
      ],
    }),
  );

  server.registerResource(
    'kaypal-ai-content-summary',
    'kaypal-ai-content://summary',
    {
      title: 'Kaypal AI Content MCP Summary',
      description: 'Kaypal AI Content local 3010/3011 MCP bridge summary.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'kaypal-ai-content://summary',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              extension: 'kaypal-ai-content-mcp',
              version: '0.1.0',
              apiBase: ctx.apiBase,
              frontendBase: ctx.frontendBase,
              authCookieProvided: Boolean(ctx.cookieHeader),
              app: createKaypalAiContentAppMetadata(),
              tools: [
                'kaypal_ai_content_open_app',
                'kaypal_ai_content_local_services',
                'kaypal_ai_content_health_check',
                'kaypal_ai_content_open_page',
                'kaypal_ai_content_account_status',
                'kaypal_ai_content_kaypal_profile',
                'kaypal_ai_content_runtime_status',
                'kaypal_ai_content_list_tasks',
                'kaypal_ai_content_list_records',
                'kaypal_ai_content_generate_reply',
                'kaypal_ai_content_open_interaction_entry',
                'kaypal_ai_content_discover_topics',
                'kaypal_ai_content_generate_article',
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore shutdown errors
    }
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[kaypal-ai-content-mcp] running api=${ctx.apiBase} frontend=${ctx.frontendBase} authCookie=${Boolean(
      ctx.cookieHeader,
    )}`,
  );
}

main().catch((error) => {
  console.error('[kaypal-ai-content-mcp] fatal:', error);
  process.exit(1);
});
