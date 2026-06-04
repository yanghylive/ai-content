#!/usr/bin/env node
/**
 * 准备 Python wheelhouse（离线包）
 *
 * 目的：把 auto-upload 和 agent-s-executor 的 Python 依赖
 *       打包成本地 wheel 仓库，让 Windows 安装器可以离线 pip install，
 *       用户双击装包时无需现场 pip install（卡点 4）。
 *
 * 用法：
 *   node scripts/prepare-wheelhouse.js
 *   KAYPAL_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple node scripts/prepare-wheelhouse.js
 *
 * 产物：
 *   desktop/installer/wheelhouse/auto-upload/*.whl
 *   desktop/installer/wheelhouse/agent-s-executor/*.whl
 *
 * 离线安装（Windows 装器 / installer 脚本会用）：
 *   pip install --no-index --find-links resources/wheelhouse/auto-upload -r requirements.txt
 *   pip install --no-index --find-links resources/wheelhouse/agent-s-executor -r requirements.txt
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const WHEELHOUSE_ROOT = path.join(DESKTOP_DIR, 'installer', 'wheelhouse');

const TARGETS = [
  {
    name: 'auto-upload',
    sidecar: path.join(DESKTOP_DIR, 'sidecars/auto-upload'),
    requirements: path.join(DESKTOP_DIR, 'sidecars/auto-upload/requirements.txt'),
  },
  {
    name: 'agent-s-executor',
    sidecar: path.join(DESKTOP_DIR, 'sidecars/agent-s-executor'),
    requirements: path.join(DESKTOP_DIR, 'sidecars/agent-s-executor/requirements.txt'),
  },
];

function findPip() {
  // pip 必须跟 target python 同版本（用 3.12+ 的 Python，否则 wheel 不匹配）
  const python = findTargetPython();
  if (!python) return null;
  const pipCmd = `${python} -m pip`;
  try {
    execSync(`${pipCmd} --version`, { stdio: 'pipe' });
    return pipCmd;
  } catch (_) {
    return null;
  }
}

function findTargetPython() {
  // 找 3.12+ 的 Python（与 main.js 的要求一致）
  const candidates = process.platform === 'win32'
    ? ['py -3.12', 'python3.12', 'python3', 'python']
    : ['python3.12', 'python3', 'python'];
  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString().trim();
      const m = out.match(/Python\s+(\d+)\.(\d+)/);
      if (m && Number(m[1]) >= 3 && Number(m[2]) >= 12) {
        return cmd;
      }
    } catch (_) {
      // try next
    }
  }
  return null;
}

function prepareTarget(pip, target) {
  if (!fs.existsSync(target.requirements)) {
    console.error(`❌ 跳过 ${target.name}: requirements.txt 不存在 (${target.requirements})`);
    return false;
  }
  const outDir = path.join(WHEELHOUSE_ROOT, target.name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n--- ${target.name} ---`);
  console.log(`  requirements: ${target.requirements}`);
  console.log(`  output:       ${outDir}`);

  const env = { ...process.env };
  if (process.env.KAYPAL_PIP_INDEX_URL) {
    env.PIP_INDEX_URL = process.env.KAYPAL_PIP_INDEX_URL;
    console.log(`  index:        ${env.PIP_INDEX_URL}`);
  }

  // pip download: 拉 wheel 包到本地，不安装
  const args = [
    'download',
    '-r', target.requirements,
    '-d', outDir,
    '--disable-pip-version-check',
    '--no-cache-dir',
  ];

  // auto-upload 含 playwright（42MB）+ biliup（11MB）+ streamlink 等大包，
  // 全量依赖树 ~100 wheels + 几百 MB 依赖元数据，按网络情况可能 10-25 分钟
  const timeoutMs = Number(process.env.WHEELHOUSE_TIMEOUT_MS || '1800000'); // 默认 30 分钟

  try {
    execSync(`${pip} ${args.map((a) => `"${a}"`).join(' ')}`, {
      cwd: target.sidecar,
      env,
      stdio: 'inherit',
      timeout: timeoutMs,
    });
  } catch (err) {
    console.error(`❌ ${target.name} pip download 失败: ${err.message}`);
    return false;
  }

  // 验证产出
  const wheels = fs.readdirSync(outDir).filter((f) => f.endsWith('.whl'));
  if (wheels.length === 0) {
    console.error(`❌ ${target.name} 没产出任何 .whl`);
    return false;
  }
  console.log(`✓ ${target.name}: ${wheels.length} 个 wheel`);
  return true;
}

function main() {
  console.log(`=== KaypalAI Python wheelhouse 准备 ===`);
  console.log(`输出根: ${WHEELHOUSE_ROOT}`);

  const python = findTargetPython();
  if (!python) {
    console.error('❌ 找不到 Python 3.12+，无法准备 wheelhouse');
    process.exit(1);
  }
  console.log(`Python: ${python}`);

  const pip = findPip();
  if (!pip) {
    console.error(`❌ 找不到与 ${python} 匹配的 pip`);
    process.exit(1);
  }
  console.log(`pip:    ${pip}`);

  fs.mkdirSync(WHEELHOUSE_ROOT, { recursive: true });

  let allOk = true;
  for (const target of TARGETS) {
    const ok = prepareTarget(pip, target);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error('\n❌ wheelhouse 准备失败');
    process.exit(1);
  }
  console.log('\n✅ wheelhouse 准备完成');
  console.log(`   ${WHEELHOUSE_ROOT}`);
  console.log('\n下一步：把 wheelhouse/ 加到 electron-builder extraResources 一起打包。');
}

main();
