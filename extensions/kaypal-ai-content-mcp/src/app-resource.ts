export const KAYPAL_AI_CONTENT_APP_NAME = 'kaypal-ai-content';
export const KAYPAL_AI_CONTENT_APP_URI = `ui://apps/${KAYPAL_AI_CONTENT_APP_NAME}`;
export const KAYPAL_AI_CONTENT_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export function createKaypalAiContentAppHtml(): string {
  return String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kaypal AI Content</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #121723;
      --muted: #667085;
      --line: #d8dde8;
      --brand: #101828;
      --accent: #155eef;
      --ok: #15803d;
      --bad: #b42318;
      --warn: #b54708;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1016;
        --panel: #171b24;
        --text: #f4f6fb;
        --muted: #a4adbb;
        --line: #2b3240;
        --brand: #f4f6fb;
        --accent: #7aa7ff;
        --ok: #6ee7a8;
        --bad: #ff9b8f;
        --warn: #ffd08a;
      }
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 22px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .logo {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--brand);
      color: var(--bg);
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 24px;
      letter-spacing: 0;
      flex: 0 0 auto;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 11px;
      color: var(--muted);
      font-size: 13px;
      background: color-mix(in srgb, var(--panel) 88%, transparent);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--warn);
    }
    .status.ok .dot { background: var(--ok); }
    .status.bad .dot { background: var(--bad); }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 146px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 14px;
    }
    .card h2 {
      margin: 0 0 6px;
      font-size: 16px;
      letter-spacing: 0;
    }
    .card p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    button, a.action {
      border: 1px solid var(--line);
      border-radius: 8px;
      min-height: 36px;
      padding: 0 12px;
      background: color-mix(in srgb, var(--panel) 94%, var(--accent));
      color: var(--text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      text-decoration: none;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-align: center;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    .tools {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .panel {
      margin-top: 14px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .panel strong { color: var(--text); }
    code {
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .hint {
      display: grid;
      gap: 6px;
      margin-top: 10px;
    }
    @media (max-width: 820px) {
      main { padding: 18px; }
      header { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">
        <div class="logo">K.</div>
        <div>
          <h1>Kaypal AI Content</h1>
          <div class="sub">Goose 应用入口，本机 3010/3011 仍是实际工作台。</div>
        </div>
      </div>
      <div class="status" id="status"><span class="dot"></span><span id="statusText">正在检查本机服务</span></div>
    </header>

    <section class="grid" aria-label="Kaypal AI Content actions">
      <article class="card">
        <div>
          <h2>启动本机服务</h2>
          <p>把启动 3010/3011 的明确任务发送给 Goose，由 Goose 调用 Kaypal MCP 工具执行。</p>
        </div>
        <button class="primary" type="button" data-prompt="start">发给 Goose 启动</button>
      </article>
      <article class="card">
        <div>
          <h2>运行检查</h2>
          <p>读取 Runtime、Agent-S、浏览器、文件访问、证据目录和模型授权状态。</p>
        </div>
        <div class="tools">
          <button type="button" data-prompt="runtime">发给 Goose 检查</button>
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/capabilities/account">打开页面</a>
        </div>
      </article>
      <article class="card">
        <div>
          <h2>账号与权益</h2>
          <p>检查 Kaypal 登录用户、套餐、积分，以及抖音、快手、小红书、视频号账号状态。</p>
        </div>
        <div class="tools">
          <button type="button" data-prompt="accounts">发给 Goose 检查</button>
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/distribution?tab=accounts">平台账号</a>
        </div>
      </article>
      <article class="card">
        <div>
          <h2>互动工作台</h2>
          <p>打开抖音和视频号评论、私信页面，或让 Goose 先列出最近任务和记录。</p>
        </div>
        <div class="tools">
          <button type="button" data-prompt="interaction">查任务</button>
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/workbench/douyin-comments">抖音评论</a>
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/workbench/channel-messages">视频号私信</a>
        </div>
      </article>
      <article class="card">
        <div>
          <h2>内容生产</h2>
          <p>打开素材、选题、文章、小红书笔记和视频工坊。</p>
        </div>
        <div class="tools">
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/materials">素材</a>
          <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/topics">选题</a>
        </div>
      </article>
      <article class="card">
        <div>
          <h2>发布中心</h2>
          <p>打开图文发布、视频发布、发布素材和发布记录。</p>
        </div>
        <a class="action" target="_blank" rel="noreferrer" href="http://127.0.0.1:3010/distribution">打开发布</a>
      </article>
    </section>

    <section class="panel" id="details">
      这个 Goose 应用通过 <code>ui/message</code> 把任务发回 Goose 对话，再由 Kaypal MCP 工具执行。
    </section>
  </main>
  <script>
    class GooseBridge {
      constructor() {
        this.pending = new Map();
        this.nextId = 1;
        window.addEventListener('message', (event) => this.handle(event));
        this.init();
      }
      handle(event) {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if ('id' in data && this.pending.has(data.id)) {
          const pair = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) pair.reject(new Error(data.error.message || 'Goose request failed'));
          else pair.resolve(data.result);
        }
      }
      request(method, params) {
        return new Promise((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, reject });
          window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
          window.setTimeout(() => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              reject(new Error('请求 Goose 超时'));
            }
          }, 30000);
        });
      }
      notify(method, params) {
        window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
      }
      async init() {
        try {
          await this.request('ui/initialize', {
            protocolVersion: '2026-01-26',
            appInfo: { name: 'kaypal-ai-content', version: '0.3.0' },
            appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }
          });
          this.notify('ui/notifications/initialized', {});
        } finally {
          this.reportSize();
        }
      }
      reportSize() {
        this.notify('ui/notifications/size-changed', {
          width: document.body.scrollWidth,
          height: document.body.scrollHeight
        });
      }
      sendMessage(text) {
        return this.request('ui/message', {
          role: 'user',
          content: [{ type: 'text', text }]
        });
      }
    }

    const bridge = new GooseBridge();
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const details = document.getElementById('details');

    const prompts = {
      start: '使用 Kaypal AI Content 本机工作台 Goose MCP，调用 kaypal_ai_content_local_services action=start confirm=true 启动本机 3010/3011；启动后再调用 kaypal_ai_content_local_services action=status 和 kaypal_ai_content_health_check，把结果告诉我。不要改业务代码。',
      runtime: '使用 Kaypal AI Content 本机工作台 Goose MCP，先调用 kaypal_ai_content_health_check，再调用 kaypal_ai_content_runtime_status。请按正常/异常列出运行检查项；如果 3011 没启动，先提醒启动服务。',
      accounts: '使用 Kaypal AI Content 本机工作台 Goose MCP，调用 kaypal_ai_content_kaypal_profile 和 kaypal_ai_content_account_status，检查 Kaypal 登录用户、套餐、积分、抖音/快手/小红书/视频号账号状态。',
      interaction: '使用 Kaypal AI Content 本机工作台 Goose MCP，分别读取抖音评论、抖音私信、视频号评论、视频号私信最近任务和记录；只读检查，不发送外部平台消息。'
    };

    async function probe() {
      const targets = [
        ['3010 前端', 'http://127.0.0.1:3010/'],
        ['3011 后端', 'http://127.0.0.1:3011/api/local-engine/health']
      ];
      const results = [];
      for (const pair of targets) {
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 1800);
          const res = await fetch(pair[1], { method: 'GET', mode: 'no-cors', signal: controller.signal });
          window.clearTimeout(timer);
          results.push([pair[0], true, res.status || 'reachable']);
        } catch (error) {
          results.push([pair[0], false, error && error.message ? error.message : 'failed']);
        }
      }
      const okCount = results.filter((item) => item[1]).length;
      statusEl.classList.remove('ok', 'bad');
      if (okCount === targets.length) {
        statusEl.classList.add('ok');
        statusText.textContent = '本机服务可访问';
      } else if (okCount === 0) {
        statusEl.classList.add('bad');
        statusText.textContent = '本机服务未启动';
      } else {
        statusText.textContent = '部分服务可访问';
      }
      details.innerHTML = results.map((item) =>
        '<div><strong>' + item[0] + '</strong>：' + (item[1] ? '可访问' : '不可访问') + ' <code>' + String(item[2]) + '</code></div>'
      ).join('') + '<div class="hint"><div>需要自动处理时，点上面的“发给 Goose”按钮。</div></div>';
      bridge.reportSize();
    }

    async function sendPrompt(key, button) {
      const prompt = prompts[key];
      if (!prompt) return;
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = '已发送...';
      try {
        await bridge.sendMessage(prompt);
        details.innerHTML = '<strong>已发给 Goose：</strong><div class="hint"><code>' + prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></div>';
      } catch (error) {
        details.innerHTML = '<strong>发送失败：</strong> ' + (error && error.message ? error.message : 'unknown');
      } finally {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = oldText;
          bridge.reportSize();
        }, 900);
      }
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prompt]');
      if (!button) return;
      sendPrompt(button.dataset.prompt, button);
    });

    probe();
  </script>
</body>
</html>`;
}

export function createKaypalAiContentAppMetadata() {
  return {
    uri: KAYPAL_AI_CONTENT_APP_URI,
    name: KAYPAL_AI_CONTENT_APP_NAME,
    title: 'Kaypal AI Content',
    description:
      'Kaypal AI Content 本机工作台入口，可检查 3010/3011 并把启动、运行检查、账号检查任务发送给 Goose。',
    mimeType: KAYPAL_AI_CONTENT_APP_MIME_TYPE,
    mcpServers: ['kaypal-ai-content-mcp'],
    width: 1080,
    height: 780,
    resizable: true,
  };
}
