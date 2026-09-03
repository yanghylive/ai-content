'use strict';
/**
 * user-data-path.spec.js — 稳定 userData 目录解析单测（纯 node）
 *
 * 背景（round14 stage14 实锤）：打包版 userData 默认落 productName 目录
 * （macOS = 中文目录），backend 跨进程推导硬编码 ai-content-desktop →
 * 面板链断。本模块把 win（既有）+ mac（新增）打包版统一固定到
 * ai-content-desktop，macOS 老数据一次性 rename 迁移。
 */
const { resolveStableUserDataDir, STABLE_DIR_NAME } = require('./user-data-path');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`ok ${pass} - ${name}`); }
  else { fail += 1; console.log(`not ok ${pass + fail} - ${name}`); if (detail) console.log(`  detail: ${JSON.stringify(detail)}`); }
}

const MAC_APPDATA = '/Users/u1/Library/Application Support';

// ---- Windows：既有语义平移（回归保护，不得改变原行为）----
check('win dev → null（不固定）', resolveStableUserDataDir({ platform: 'win32', isPackaged: false, appName: STABLE_DIR_NAME, execPath: 'C:\\x\\exe' }) === null);
check('win 打包但 execPath 不含 Programs 标记 → null', resolveStableUserDataDir({ platform: 'win32', isPackaged: true, appName: STABLE_DIR_NAME, execPath: 'C:\\Program Files\\app\\exe.exe' }) === null);
check('win 打包 profile 形状不符 → null（原正则保留）', resolveStableUserDataDir({ platform: 'win32', isPackaged: true, appName: STABLE_DIR_NAME, execPath: 'D:\\AppData\\Local\\Programs\\app\\exe.exe' }) === null);
const win = resolveStableUserDataDir({
  platform: 'win32', isPackaged: true, appName: STABLE_DIR_NAME,
  execPath: 'C:\\Users\\zhang3\\AppData\\Local\\Programs\\ai-content-desktop\\AI 内容创作平台.exe',
});
// path.join 分隔符随运行平台变化（spec 在 mac 上跑）——win 语义用归一化比对
const toWin = (s) => String(s).replace(/\//g, '\\');
check('win 打包（NSIS per-user）→ %USERPROFILE%\\AppData\\Roaming\\ai-content-desktop', !!win &&
  toWin(win.dir) === 'C:\\Users\\zhang3\\AppData\\Roaming\\ai-content-desktop' && win.migrateFrom === null, win);
check('win execPath 正斜杠归一（原 replace 保留）', toWin(resolveStableUserDataDir({
  platform: 'win32', isPackaged: true, appName: STABLE_DIR_NAME,
  execPath: 'C:/Users/zhang3/AppData/Local/Programs/app/exe.exe',
})?.dir) === 'C:\\Users\\zhang3\\AppData\\Roaming\\ai-content-desktop');

// ---- macOS：本轮新增（打包版固定 + 迁移决策）----
check('mac dev → null（name 本就是 ai-content-desktop）', resolveStableUserDataDir({ platform: 'darwin', isPackaged: false, appName: STABLE_DIR_NAME, appData: MAC_APPDATA }) === null);
const mac = resolveStableUserDataDir({ platform: 'darwin', isPackaged: true, appName: 'JIUZHANG AI 内容创作平台', appData: MAC_APPDATA });
check('mac 打包 → 固定到 ai-content-desktop，迁移源 = productName 目录', !!mac &&
  mac.dir === `${MAC_APPDATA}/ai-content-desktop` &&
  mac.migrateFrom === `${MAC_APPDATA}/JIUZHANG AI 内容创作平台`, mac);
check('mac 打包且 appName 恰好一致 → 不迁移', resolveStableUserDataDir({ platform: 'darwin', isPackaged: true, appName: STABLE_DIR_NAME, appData: MAC_APPDATA })?.migrateFrom === null);
check('mac 打包但 appData 缺失 → null（fail-closed 不猜）', resolveStableUserDataDir({ platform: 'darwin', isPackaged: true, appName: 'x', appData: '' }) === null);

// ---- 其他平台 ----
check('linux → null（无固定逻辑，按平台默认）', resolveStableUserDataDir({ platform: 'linux', isPackaged: true, appName: 'x', appData: '/tmp' }) === null);
check('导出 STABLE_DIR_NAME 契约', STABLE_DIR_NAME === 'ai-content-desktop');

console.log(`\n${fail === 0 ? 'USER-DATA-PATH SPEC PASSED' : 'USER-DATA-PATH SPEC FAILED'} (${pass})`);
process.exit(fail === 0 ? 0 : 1);
