const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');

const isDev = !app.isPackaged;
const baseDir = isDev ? __dirname : process.resourcesPath;
const resourceDir = isDev ? path.join(__dirname, 'resources') : path.join(process.resourcesPath, 'resources');
const manifestPath = path.join(resourceDir, 'deps-manifest.json');
const detectorPath = path.join(resourceDir, 'detect-deps.ps1');
const mainInstallerPath = path.join(resourceDir, 'main-installer.exe');
const logDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'KaypalAI', 'logs');
const logPath = path.join(logDir, 'install-assistant.log');
const cacheDir = path.join(os.tmpdir(), 'kaypal-ai-installer-deps');
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const DETECT_TIMEOUT_MS = 20 * 1000;

let mainWindow = null;

function getDepOrder(manifest) {
  return Object.keys(manifest.deps || {});
}

function getDepLabel(name, manifest) {
  return manifest.deps?.[name]?.label || manifest.deps?.[name]?.name || name;
}

function ensureDirs() {
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
}

function writeLog(message) {
  ensureDirs();
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  if (mainWindow) {
    mainWindow.webContents.send('installer-event', { type: 'log', message: line });
  }
}

function sendProgress(percent) {
  if (mainWindow) {
    mainWindow.webContents.send('installer-event', { type: 'progress', percent });
  }
}

function sendStatus(message) {
  if (mainWindow) {
    mainWindow.webContents.send('installer-event', { type: 'status', message });
  }
}

function runProcess(file, args, options = {}) {
  return new Promise((resolve) => {
    writeLog(`RUN ${file} ${args.join(' ')}`);
    const child = spawn(file, args, {
      windowsHide: false,
      shell: false,
      ...options,
    });
    const timeoutMs = options.timeoutMs || INSTALL_TIMEOUT_MS;
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      writeLog(`TIMEOUT ${file} after ${Math.round(timeoutMs / 1000)}s`);
      try {
        child.kill('SIGKILL');
      } catch {}
      finish({ code: -2, stdout, stderr: `timeout after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      writeLog(`ERROR ${file}: ${error.message}`);
      finish({ code: -1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      if (stdout.trim()) writeLog(stdout.trim());
      if (stderr.trim()) writeLog(stderr.trim());
      writeLog(`EXIT ${file}: ${code}`);
      finish({ code, stdout, stderr });
    });
  });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function compareVersion(a, b) {
  if (!a || !b) return -1;
  const pa = String(a).match(/\d+(\.\d+){0,3}/)?.[0]?.split('.').map(Number) || [];
  const pb = String(b).match(/\d+(\.\d+){0,3}/)?.[0]?.split('.').map(Number) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function normalizeDetection(detected, manifest) {
  const deps = {};
  const requiredMissing = [];
  const optionalMissing = [];
  for (const name of getDepOrder(manifest)) {
    const manifestDep = manifest.deps[name] || {};
    const detectedDep = detected[name] || {};
    const installed =
      !!detectedDep.installed &&
      (!manifestDep.minVersion || !detectedDep.version || compareVersion(detectedDep.version, manifestDep.minVersion) >= 0);
    deps[name] = {
      installed,
      version: detectedDep.version || '',
      optional: !!manifestDep.optional,
    };
    if (!installed && manifestDep.optional) optionalMissing.push(name);
    if (!installed && !manifestDep.optional) requiredMissing.push(name);
  }
  return { deps, requiredMissing, optionalMissing };
}

async function detectDeps() {
  const manifest = readManifest();
  if (!fs.existsSync(detectorPath)) {
    throw new Error(`找不到依赖检测脚本：${detectorPath}`);
  }
  const result = await runProcess('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    detectorPath,
  ], { timeoutMs: DETECT_TIMEOUT_MS });
  const raw = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.code === -2) {
    throw new Error('安装包资源检测超时，请打开日志查看。');
  }
  if (result.code !== 0 && !raw) {
    throw new Error('依赖检测脚本执行失败');
  }
  try {
    const json = JSON.parse(raw);
    return normalizeDetection(json, manifest);
  } catch (error) {
    writeLog(`DETECT RAW: ${raw}`);
    throw new Error(`依赖检测结果解析失败：${error.message}`);
  }
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const timer = setTimeout(() => {
      file.close(() => fs.rm(dest, { force: true }, () => {}));
      reject(new Error(`下载超时：${url}`));
    }, DOWNLOAD_TIMEOUT_MS);
    const request = https.get(url, { headers: { 'User-Agent': 'KaypalAI-InstallAssistant/1.0' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        clearTimeout(timer);
        file.close(() => fs.rm(dest, { force: true }, () => {}));
        download(response.headers.location, dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        file.close(() => fs.rm(dest, { force: true }, () => {}));
        reject(new Error(`下载失败 HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const total = Number(response.headers['content-length'] || 0);
      let received = 0;
      let lastLogAt = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (!total) return;
        const percent = Math.floor((received / total) * 100);
        const now = Date.now();
        if (percent >= lastLogAt + 10 || now - lastLogAt > 5000) {
          lastLogAt = percent || now;
          const mb = (received / 1024 / 1024).toFixed(1);
          const totalMb = (total / 1024 / 1024).toFixed(1);
          const message = `正在从 Kaypal OSS 下载 ${label}：${percent}% (${mb}/${totalMb} MB)`;
          writeLog(message);
          sendStatus(message);
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        clearTimeout(timer);
        file.close(resolve);
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      file.close(() => fs.rm(dest, { force: true }, () => {}));
      reject(error);
    });
  });
}

async function ensureInstallerFile(dep, label) {
  const dest = path.join(cacheDir, dep.filename);
  if (fs.existsSync(dest)) {
    const actual = await sha256(dest);
    const stat = fs.statSync(dest);
    if (actual === String(dep.sha256).toLowerCase() && (!dep.size || stat.size === Number(dep.size))) {
      writeLog(`CACHE OK ${dep.filename}`);
      return dest;
    }
    writeLog(`CACHE BAD ${dep.filename}, remove`);
    fs.rmSync(dest, { force: true });
  }

  writeLog(`DOWNLOAD FROM KAYPAL OSS ${dep.url}`);
  sendStatus(`正在从 Kaypal OSS 下载 ${label}`);
  await download(dep.url, dest, label);
  const actual = await sha256(dest);
  const stat = fs.statSync(dest);
  if (actual !== String(dep.sha256).toLowerCase()) {
    throw new Error(`${dep.filename} 校验失败`);
  }
  if (dep.size && stat.size !== Number(dep.size)) {
    throw new Error(`${dep.filename} 文件大小不对`);
  }
  return dest;
}

function splitArgs(value) {
  const args = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = regex.exec(value || ''))) {
    args.push(match[1] ?? match[2]);
  }
  return args;
}

async function installDep(name, dep) {
  const manifest = readManifest();
  const label = getDepLabel(name, manifest);
  const installer = await ensureInstallerFile(dep, label);
  const ext = path.extname(installer).toLowerCase();
  sendStatus(`正在安装 ${label}`);
  if (ext === '.msi') {
    const args = ['/i', installer, ...splitArgs(dep.silentArgs).filter((arg) => arg.toLowerCase() !== '/i')];
    return runProcess('msiexec.exe', args);
  }
  return runProcess(installer, splitArgs(dep.silentArgs));
}

async function installMissing() {
  const manifest = readManifest();
  const before = await detectDeps();
  const targets = [...before.requiredMissing, ...before.optionalMissing];
  if (targets.length === 0) return before;
  throw new Error('安装包不应要求用户单独安装依赖，请重新下载安装包或联系 Kaypal 支持。');

  for (let i = 0; i < targets.length; i += 1) {
    const name = targets[i];
    const dep = manifest.deps[name];
    sendProgress(30 + Math.round((i / Math.max(targets.length, 1)) * 55));
    const label = getDepLabel(name, manifest);
    const stepMessage = `STEP ${i + 1}/${targets.length}: download/install ${label}`;
    writeLog(stepMessage);
    sendStatus(`正在处理 ${label} (${i + 1}/${targets.length})`);
    const result = await installDep(name, dep);
    if (![0, 3010].includes(result.code) && !dep.optional) {
      throw new Error(`${label} 安装失败，退出码 ${result.code}`);
    }
  }

  sendProgress(90);
  const after = await detectDeps();
  if (after.requiredMissing.length > 0) {
    throw new Error(`复检仍缺少：${after.requiredMissing.map((x) => getDepLabel(x, manifest)).join('、')}`);
  }
  sendProgress(100);
  return after;
}

async function runMainInstaller() {
  if (!fs.existsSync(mainInstallerPath)) {
    throw new Error(`找不到主安装包：${mainInstallerPath}`);
  }
  writeLog(`START MAIN INSTALLER ${mainInstallerPath}`);
  await runProcess(mainInstallerPath, []);
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    resizable: false,
    title: 'KaypalAI 安装助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

ipcMain.handle('detect', async () => {
  try {
    ensureDirs();
    writeLog('DETECT START');
    sendProgress(10);
    const result = await detectDeps();
    writeLog(`DETECT RESULT requiredMissing=${result.requiredMissing.join(',') || 'none'}`);
    sendProgress(result.requiredMissing.length ? 25 : 100);
    return result;
  } catch (error) {
    writeLog(`DETECT FAIL ${error.message}`);
    throw error;
  }
});

ipcMain.handle('install-missing', async () => {
  try {
    return await installMissing();
  } catch (error) {
    writeLog(`INSTALL FAIL ${error.message}`);
    throw error;
  }
});

ipcMain.handle('run-main-installer', async () => {
  try {
    return await runMainInstaller();
  } catch (error) {
    writeLog(`MAIN INSTALLER FAIL ${error.message}`);
    throw error;
  }
});

ipcMain.handle('open-log', async () => {
  ensureDirs();
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
  await shell.openPath(logPath);
});

app.whenReady().then(() => {
  ensureDirs();
  writeLog(`=== KaypalAI install assistant start (${baseDir}) ===`);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
