# Phase 3 迁移记录：内置 Playwright Chromium / CDP 浏览器

日期：2026-06-09

## 目标

把桌面端浏览器自动化从“依赖用户机器已安装 Google Chrome”迁到“安装包内置 Playwright Chromium”。平台登录、账号状态、互动入口、评论/私信执行继续复用 CDP profile/cookies 体系，但不再要求小白用户单独安装 Chrome。

## 已完成

- 新增统一浏览器运行时解析器：
  - `backend/src/modules/local-engine/playwright-browser-runtime.service.ts`
  - 默认优先级：显式 `LOCAL_BROWSER_CHROME_PATH` 调试覆盖 > 打包内置 `playwright-browsers` > Playwright 本机缓存 > 受控系统 Chrome fallback。
  - 系统 Chrome fallback 必须显式开启 `KAYPAL_ALLOW_SYSTEM_CHROME=1`。
- `LocalBrowserEngine` 改为使用统一解析器：
  - CDP 浏览器启动、profile 复用、状态信息都指向同一个 Chromium executable。
  - 错误信息从“用户 Chrome 缺失”改为“内置 Playwright Chromium 缺失”。
- `PlaywrightMcpService` 改为使用统一解析器：
  - `@playwright/mcp` 的 `--executable-path` 与本地引擎保持一致。
  - 不再各自扫描 `/Applications/Google Chrome.app`。
- 桌面启动时注入内置浏览器路径：
  - `KAYPAL_PLAYWRIGHT_BROWSERS_PATH`
  - `PLAYWRIGHT_BROWSERS_PATH`
  - 来源：`resources/playwright-browsers`
- 新增构建前浏览器资源准备：
  - `desktop/scripts/prepare-playwright-browsers.js`
  - `desktop/package.json` 脚本：`prepare:playwright-browsers`
  - 普通 build、mac build、linux build、win full build 都会先准备浏览器资源。
- 安装包资源加入：
  - `desktop/runtime/playwright-browsers` -> `resources/playwright-browsers`
  - `backend/node_modules/playwright` -> `resources/backend/node_modules/playwright`
  - `backend/node_modules/playwright-core` -> `resources/backend/node_modules/playwright-core`
- SQLite backend bundle 调整：
  - `backend/scripts/build-sqlite-bundle.mjs` 对 `playwright` / `playwright-core` 使用 ncc external。
  - 避免 Playwright 被塞进单文件后在打包态查找 `backend/package.json` 失败。
- 构建检查加入浏览器校验：
  - `desktop/scripts/check-commercial-assets.js`
  - `desktop/scripts/check-full-installer-assets.js`
  - pre/post build 都会校验 Playwright Chromium executable 是否存在。
  - 同时校验 Playwright runtime 包是否被带进安装包。
- 审计脚本修复：
  - `scripts/audit-one-click-runtime-deps.mjs` 排除 `desktop/runtime/playwright-browsers`，避免扫描 Chromium `.app` 内部资源时误报或崩溃。
  - 读取文件失败时跳过，不中断依赖审计。

## 现在的行为

开发机：
- 如果已安装 Playwright Chromium，`prepare:playwright-browsers` 会复制当前平台 Chromium 到 `desktop/runtime/playwright-browsers/chromium`。
- 后端默认可从 Playwright cache 启动，打包态默认从 resources 启动。

安装包：
- 用户不需要安装 Google Chrome。
- 用户不需要配置 Chrome 路径。
- 如果安装包漏带 Chromium，资产检查会在打包前或打包后失败，不会静默发布。

## 验证

已通过：

- `npm run prepare:playwright-browsers`
- `node --check desktop/scripts/prepare-playwright-browsers.js`
- `node --check desktop/scripts/check-commercial-assets.js`
- `node --check desktop/scripts/check-full-installer-assets.js`
- `node --check desktop/main.js`
- `backend ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
- `node desktop/scripts/check-full-installer-assets.js --phase=pre`
- `node desktop/scripts/check-commercial-assets.js`
- `backend npm run build:bundle:sqlite`
- `node scripts/audit-one-click-runtime-deps.mjs`

补充验证：

- SQLite bundle 中 `playwright` 已外置为运行时 require。
- `backend/node_modules/playwright` 和 `backend/node_modules/playwright-core` 已纳入桌面资源检查。
- 当前本机内置 Chromium executable 存在并可被解析。

## 仍需注意

- 当前机器生成的是 macOS Chromium 资源。真正 Windows 安装包需要在 Windows 构建机或 Windows CI 上运行 `npm run build:win`，这样 `prepare-playwright-browsers` 才会复制 Windows Chromium。
- `LOCAL_BROWSER_CHROME_PATH` 仍保留为开发调试覆盖，不作为小白用户安装依赖。
- `KAYPAL_ALLOW_SYSTEM_CHROME=1` 只作为兜底开关，默认不开。
- 本轮检查额外发现 `sharp` native optional dependency 可能影响完整安装包隔离启动；这是 Phase 5 打包完整性问题，不属于 P3 浏览器链路，但后续必须纳入安装包资源检查。
