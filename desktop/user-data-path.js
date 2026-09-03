'use strict';
/**
 * user-data-path.js — desktop「稳定 userData 目录」解析（纯函数，可单测）
 *
 * 为什么需要它（round14 stage14 实锤的跨进程断链 bug）：
 *  - Electron 打包版的默认 userData = productName（`JIUZHANG AI 内容创作平台`，
 *    Info.plist CFBundleName 实锤）→ `~/Library/Application Support/JIUZHANG AI 内容创作平台/`；
 *  - 而 3011 backend 跨进程读面板桥凭据/面板模式开关文件时，
 *    `resolveDesktopUserDataDir()`（backend/src/common/project-paths.ts）darwin
 *    硬编码推导 `~/Library/Application Support/ai-content-desktop`；
 *  - dev 版 package.json name 恰好是 ai-content-desktop，两边碰巧一致，
 *    测试从未暴露；Windows 打包版已被 configureStableUserDataPath 兜住，
 *    **macOS 打包版漏了** → 生产 macOS 上面板模式/面板桥两条跨进程链全断。
 *
 * 修复策略：desktop 打包版（win + mac）统一把 userData 固定到
 * `ai-content-desktop`，backend 零改动；macOS 老用户数据一次性 rename 迁移
 * （同分区原子；stable 已存在则不动——dev/打包共存场景以 stable 为准）。
 */
const path = require('path');

const STABLE_DIR_NAME = 'ai-content-desktop';
/** Windows 打包版安装根标记（NSIS per-user 安装到 %LOCALAPPDATA%\Programs\） */
const WIN_PROGRAMS_MARKER = '\\AppData\\Local\\Programs\\';

/**
 * @param {{platform:string, isPackaged:boolean, appName:string,
 *          execPath?:string, appData?:string}} input
 *   - platform/isPackaged/appName/execPath：来自 process/app；
 *   - appData：darwin 用 app.getPath('appData')（~/Library/Application Support）。
 * @returns {{dir:string, migrateFrom:string|null}|null}
 *   null = 该平台/场景不需要固定（dev 版名本就是 ai-content-desktop）。
 */
function resolveStableUserDataDir(input) {
  const { platform, isPackaged, appName, execPath, appData } = input || {};

  if (platform === 'win32') {
    if (!isPackaged) return null;
    const normalized = String(execPath || '').replace(/\//g, '\\');
    const markerIndex = normalized
      .toLowerCase()
      .indexOf(WIN_PROGRAMS_MARKER.toLowerCase());
    if (markerIndex <= 0) return null;
    const userProfile = normalized.slice(0, markerIndex);
    if (!/^[a-z]:\\users\\[^\\]+$/i.test(userProfile)) return null;
    return {
      dir: path.join(userProfile, 'AppData', 'Roaming', STABLE_DIR_NAME),
      migrateFrom: null,
    };
  }

  if (platform === 'darwin') {
    if (!isPackaged) return null;
    const base = String(appData || '').trim();
    if (!base) return null;
    const dir = path.join(base, STABLE_DIR_NAME);
    // 打包版 appName = productName（中文，≠ ai-content-desktop）→ 老数据目录。
    // dev 共存或目录名恰好一致时无需迁移。
    const migrateFrom =
      appName && appName !== STABLE_DIR_NAME ? path.join(base, appName) : null;
    return { dir, migrateFrom };
  }

  return null;
}

module.exports = { resolveStableUserDataDir, STABLE_DIR_NAME };
