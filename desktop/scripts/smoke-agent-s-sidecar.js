#!/usr/bin/env node
/**
 * Agent-S sidecar 启动 smoke 验证
 *
 * 目的：打包前先确认 sidecar 真的能起来、跑通 mock run、产生 artifact。
 * 卡点 3 修复（handoff §6 / §9 Step 2）。
 *
 * 用法：
 *   node scripts/smoke-agent-s-sidecar.js
 *   KAYPAL_AGENT_S_PORT=17779 node scripts/smoke-agent-s-sidecar.js
 *
 * 通过标准：
 *   - /healthz 返 ok
 *   - mock session 能跑到 completed
 *   - artifacts 数组非空
 *   - 进程能正常退出
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SCRIPT_DIR = __dirname;
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const SIDECAR_DIR = path.join(DESKTOP_DIR, 'sidecars/agent-s-executor');
const REQUIREMENTS = path.join(SIDECAR_DIR, 'requirements.txt');
const ENTRY = path.join(SIDECAR_DIR, 'main.py');

const REQUIRED_PYTHON_MAJOR = 3;
const REQUIRED_PYTHON_MINOR = 12;

const PORT = Number(process.env.KAYPAL_AGENT_S_PORT || '17779');
const TOKEN = process.env.KAYPAL_AGENT_S_TOKEN || 'change-me-local-token';
const SMOKE_TIMEOUT_MS = 60000;

function log(label, msg) {
  console.log(`[smoke] ${label}: ${msg}`);
}

function findPython() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('py', 'python3', 'python');
  } else {
    candidates.push('python3.12', 'python3', 'python');
  }
  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString().trim();
      const m = out.match(/Python\s+(\d+)\.(\d+)/);
      if (m) {
        const major = Number(m[1]);
        const minor = Number(m[2]);
        if (major > REQUIRED_PYTHON_MAJOR ||
            (major === REQUIRED_PYTHON_MAJOR && minor >= REQUIRED_PYTHON_MINOR)) {
          return cmd;
        }
        log('python', `skip ${cmd} (${out}), need ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+`);
      }
    } catch (_) {
      // not found, try next
    }
  }
  return null;
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'x-kaypal-agent-s-token': TOKEN };
    if (data) headers['content-type'] = 'application/json';
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: urlPath, method, headers },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          let parsed;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) { parsed = chunks; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await request('GET', '/healthz');
      if (r.status === 200 && r.body && r.body.status === 'ok') return r.body;
    } catch (_) {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Agent-S /healthz did not return ok within ${timeoutMs}ms`);
}

async function pollSessionCompleted(sessionId, timeoutMs = SMOKE_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await request('GET', `/sessions/${sessionId}`);
    if (r.status === 200 && r.body && r.body.status === 'completed') return r.body;
    if (r.status === 200 && r.body && r.body.status === 'failed') {
      throw new Error(`Session ${sessionId} failed: ${r.body.lastError || 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Session ${sessionId} did not complete within ${timeoutMs}ms`);
}

async function main() {
  if (!fs.existsSync(ENTRY)) {
    console.error(`❌ Sidecar 入口不存在: ${ENTRY}`);
    process.exit(1);
  }
  if (!fs.existsSync(REQUIREMENTS)) {
    console.error(`❌ requirements.txt 不存在: ${REQUIREMENTS}`);
    process.exit(1);
  }

  const python = findPython();
  if (!python) {
    console.error(`❌ 找不到 Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+`);
    process.exit(1);
  }
  log('python', `使用 ${python}`);

  // 隔离 venv（卡点 2 一致：auto-upload 和 Agent-S 各自独立 venv）
  const venvDir = path.join(os.tmpdir(), `kaypal-agent-s-smoke-${process.pid}`);
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  const venvPip = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

  try {
    log('venv', `创建隔离 venv: ${venvDir}`);
    execSync(`${python} -m venv "${venvDir}"`, { stdio: 'inherit' });
    log('venv', '✓ venv 创建成功');

    log('pip', '安装依赖...');
    execSync(`"${venvPip}" install -q -r "${REQUIREMENTS}"`, {
      stdio: 'inherit',
      timeout: 180000,
    });
    log('pip', '✓ 依赖装好');

    log('start', `在 ${PORT} 端口启动 Agent-S (mock mode)`);
    const proc = spawn(
      venvPython,
      ['-u', ENTRY],
      {
        cwd: SIDECAR_DIR,
        env: {
          ...process.env,
          KAYPAL_AGENT_S_HOST: '127.0.0.1',
          KAYPAL_AGENT_S_PORT: String(PORT),
          KAYPAL_AGENT_S_TOKEN: TOKEN,
          KAYPAL_AGENT_S_RUNNER_MODE: 'mock',
          KAYPAL_AGENT_S_ARTIFACT_ROOT: path.join(venvDir, 'artifacts'),
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderrTail = '';
    proc.stdout.on('data', (d) => process.stdout.write(`[sidecar.out] ${d}`));
    proc.stderr.on('data', (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 2000) stderrTail = stderrTail.slice(-2000);
      process.stderr.write(`[sidecar.err] ${d}`);
    });

    let procExited = false;
    proc.on('exit', (code, signal) => {
      procExited = true;
      log('sidecar', `进程退出 code=${code} signal=${signal}`);
    });

    try {
      log('probe', '等 /healthz...');
      const health = await waitForHealth();
      log('probe', `✓ /healthz status=${health.status} service=${health.service}`);

      log('create', 'POST /sessions');
      const create = await request('POST', '/sessions', {
        session_name: 'smoke-test-session',
        task_type: 'desktop.gui.visual.mock',
        metadata: { source: 'smoke' },
      });
      if (create.status !== 201) {
        throw new Error(`Create session failed: HTTP ${create.status} body=${JSON.stringify(create.body)}`);
      }
      const sessionId = create.body.session && create.body.session.session_id;
      if (!sessionId) {
        throw new Error(`Create session: cannot find session_id in ${JSON.stringify(create.body)}`);
      }
      log('create', `✓ sessionId=${sessionId}`);

      log('run', `POST /sessions/${sessionId}/run`);
      const run = await request('POST', `/sessions/${sessionId}/run`, {
        instruction: 'smoke test instruction',
        risk_level: 'low',
        step_count: 2,
        mock_step_delay_ms: 50,
      });
      if (run.status !== 202 && run.status !== 200) {
        throw new Error(`Run session failed: HTTP ${run.status} body=${JSON.stringify(run.body)}`);
      }
      log('run', `✓ run accepted (HTTP ${run.status}) runId=${run.body.run_id}`);

      log('poll', `等 session ${sessionId} 跑到 completed...`);
      const summary = await pollSessionCompleted(sessionId);
      log('poll', `✓ session completed status=${summary.status} artifacts=${summary.artifact_count}`);

      log('artifacts', `GET /sessions/${sessionId}/artifacts`);
      const arts = await request('GET', `/sessions/${sessionId}/artifacts`);
      const artsList = arts.body && arts.body.artifacts;
      if (!Array.isArray(artsList) || artsList.length === 0) {
        throw new Error(`No artifacts produced: ${JSON.stringify(arts.body)}`);
      }
      log('artifacts', `✓ artifacts=${artsList.length} 个`);

      log('stop', 'POST /stop');
      await request('POST', '/stop');
    } finally {
      if (!procExited) {
        log('cleanup', 'kill sidecar process');
        try { proc.kill('SIGTERM'); } catch (_) {}
        await new Promise((r) => setTimeout(r, 1000));
        if (!procExited) {
          try { proc.kill('SIGKILL'); } catch (_) {}
        }
      }
    }
  } finally {
    log('cleanup', `删除隔离 venv: ${venvDir}`);
    try { fs.rmSync(venvDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n✅ Agent-S smoke 全部通过');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Agent-S smoke 失败: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
