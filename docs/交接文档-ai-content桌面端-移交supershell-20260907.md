# ai-content 桌面端交接文档（移交 jiuzhang-supershell）

> 交接日期：2026-09-07 ｜ 交接人：二狗（AI 助理）｜ 接收方：jiuzhang-supershell 团队
> 基线：`main @ 64438831` ｜ 桌面端版本：**v1.1.116（已发版）** ｜ 工作目录：`~/Documents/New project/ai-content/`

---

## 一、一页纸概要

ai-content（九章AI）是 Electron 桌面应用 + NestJS 本地后端 + Next.js 前端的三层结构，部署形态是「桌面安装包内置全部运行时（node/prisma/chromium/octop sidecar）+ OSS 自动更新」。截至交接日：

| 项 | 状态 |
|---|---|
| 版本 | v1.1.116（2026-09-06 发版） |
| 发版通道 | OSS（`updates/latest.yml` + `latest-mac.yml`）+ GitHub Release v1.1.116，双通道均验证可读 |
| 包 | Mac zip 659MB（ad-hoc 签名）+ Win NSIS exe 556MB |
| Windows 真机验收 | ✅ 已过（jz-win11 云电脑：安装→启动→登录→bundle 7/7 修复特征确认） |
| 代码质量门禁 | 后端 lint 0 / tsc 0 / jest 2944 passed；前端 lint error 0 / tsc 0；四层发版门禁 17 项 |
| 未了事项 | ① 假旧版升级 E2E（自动更新链路）② Mac 正式签名 ③ 多租户歧义管理 UI ④ MAYNOR key 轮换 |

**五轮复核（2026-09-06）修了 20+ 项 P0/P1/P2**，commit 链见附录 A。发版过程中门禁又拦出 6 个真 bug（含一个登录 500 的 P0），全部修复。

---

## 二、项目架构

### 2.1 三层结构

```
ai-content/
├── desktop/          # Electron 主进程（main.js + 一组本地 js 模块）
│   ├── main.js               # 主进程入口：起内置 backend/frontend、托盘、悬浮球、自动更新
│   ├── browser-panel-*.js    # 浏览器面板体系（manager/broker/bridge/IPC）
│   ├── cloud-api.js          # kaypal.cn 云端 API 客户端
│   ├── auto-updater.js       # electron-updater 封装（OSS feed）
│   ├── credential-key-store.js # 凭据 master key（safeStorage/device-store）
│   └── package.json          # 版本号 + electron-builder 配置（build.files 白名单！）
├── backend/          # NestJS 本地后端（监听 3011）
│   ├── src/                  # 源码（comment-acquisition / local-engine / interaction / prisma ...）
│   ├── prisma/schema.prisma  # 168 张表（SQLite 账号库）
│   ├── dist-bundle-sqlite/   # ncc 打包产物（安装包内置的就是它）
│   └── scripts/build-sqlite-bundle.mjs  # bundle 构建（BUILD_PLATFORM 选 prisma engine）
├── frontend/         # Next.js 15.5 静态导出（构建后由 desktop 内置静态服务器服务 3010）
│   └── src/lib/release-notes.ts  # 版本号 + 更新说明数据源
├── scripts/pre-release-full.mjs  # ⭐ 发版前四层门禁（一键 17 项）
├── scripts/ci/mobile-regression-guard.mjs  # R1-R4 防复发守卫（R1 建表/R2 权限/R3 BigInt/R4 路由）
└── mac-app-test.mjs  # Mac 包全功能 18 项测试
```

### 2.2 运行形态

- **开发机**：3011 后端 + 3010 前端由 **launchd 托管**（`com.jiuzhang.ai-content-{backend,frontend}`，KeepAlive）。重启用 `launchctl kickstart -k gui/501/<label>`。
- **运行时 bundle**：开发机跑的是 `~/.workbuddy/ai-content-backend/dist-bundle-sqlite/`（运行副本）。改源码后必须 `npm run build:bundle:sqlite && npm run sync:runtime-bundle` 再重启 3011。
- **安装包**：内置 `resources/backend`（bundle）+ `resources/frontend`（静态导出）+ `resources/runtime/node`（内置 node v20.20.2）+ `resources/playwright-browsers`（chromium）+ `resources/octop`（sidecar venv）。

### 2.3 必须知道的内部机制（不看会踩雷）

1. **PrismaService 的 TARGET_ONLY 白名单**（`backend/src/prisma/prisma.service.ts:80-93`）：PrismaService 被 Proxy 包了一层按需路由账号库，**字段/方法白名单外的属性访问一律返回 undefined**。⚠️ 给这个 service 加私有字段时，**字段名必须同步加进白名单**，否则运行时静默 undefined——v1.1.116 的登录 500 P0 就是这个（`nullTenantLeadsClaimed` 漏加，commit cd0cae27）。
2. **业务表「模块懒建表」**：`ensureSqliteCoreTables` 只建核心表（users/tenants 等），schema.prisma 里其他 model 靠各自模块 `onModuleInit` 懒建。**新增 model 必须在对应 service 写 CREATE TABLE IF NOT EXISTS**，否则 R1 建表完整性门禁红（v1.1.116 的 account_touch_quotas 教训，commit c859f28e）。
3. **desktop 层新增本地 js/html 必须同步 `desktop/package.json` 的 `build.files` 白名单**，否则 asar 缺文件（main.js require 的直接双击崩；html/preload 的功能静默失效）。排查法：`npx asar list` 对照 `main.js` 的 require 列表。
4. **私信发送链**：`comment-acquisition.service.ts` 的 `dispatchReply` → `interaction-adapter`（`InteractionSendInput`）→ `platform-interaction-executor`（`PlatformDispatchInput`）。私信有 `messageId/senderId/conversationId` 三个稳定 ID，执行器**精确匹配目标、匹配不到 fail-closed**（commit 68eb5694）。改这条链时不要把 ID 透传断掉。
5. **账号触达配额**：`account-touch-quota.service.ts`，账号维度日计数器（growth 与 comment-acquisition 共用），原子扣减靠 `UPDATE ... WHERE touch_count < daily_limit` 的 affectedRows。

---

## 三、v1.1.116 发版详情

### 3.1 发版内容（五轮复核修复 + 发版门禁新修）

| # | 修复 | commit | 级别 |
|---|---|---|---|
| 1 | 私信稳定 ID 全链透传 + 执行器精确匹配 fail-closed（防同文发错人） | 68eb5694 | P0 |
| 2 | 登录 500（nullTenantLeadsClaimed 白名单） | cd0cae27 | P0 |
| 3 | SQLite 自愈回滚事务（防 WAL 数据丢失） | 6948ea7a | P1 |
| 4 | 历史 NULL 租户线索原子认领 + 严格过滤 | 33fa3f55 / 9edd2e50 | P1 |
| 5 | 回复生成 409（复用查询稳定化 + 失败回写） | 00c423d7 | P1 |
| 6 | desktop-panel 登录态持久化（Electron persist partition） | 8045220e | P1 |
| 7 | 悬浮胶囊点击穿透 | 72412555 | P1 |
| 8 | 强制重载忽略缓存 | 034c3b6b | P2 |
| 9 | 多租户歧义计数审计 + 管理端 API（list/claim） | cfe042c5 / b73081ce | P2 |
| 10 | Electron 启动环境白名单（sanitizeInheritedEnv，main.js） | b73081ce | P2 |
| 11 | account_touch_quotas 懒建表 / pill 白名单 / Mac 签名 / LucideIcon | c859f28e / 2d60d18b / 6b14135e / 4ff2c53d | 发版门禁 |

### 3.2 发版验证结论

- 本地双包解包：Mac zip 与 Win exe 内 backend bundle **均为 22.1MB 最新版**，7 个修复特征 grep 全命中。
- Windows 真机（云电脑 jz-win11-test）：安装→启动→登录→agent-s 200→**bundle 特征 7/7**，全链路通过。
- Mac 包签名：**ad-hoc**（`build.mac.identity: null`）。原因：Hermes Local Signing 本地自签证书 + 新版 Chrome for Testing（revision 1237）自带 Google 签名无 timestamp，distribution 签名报 `A timestamp was expected but was not found`（详见 skill 坑 0d）。

---

## 四、遗留问题清单（按优先级）

### P1（建议尽快）

1. **假旧版升级 E2E 未做**。本次只验了「全新安装」链路；「旧版自动更新→升到 1.1.116」未验证。发版铁律第 4 条要求：sed 降版本部署 → 走完整 检查→下载→SHA512→验签→替换→重启 链路。参考 skill `wuying-clouddesktop-test` 坑 20 的 fake manifest 方案（需 ed25519 私钥 `~/.workbuddy/` 下 0600 文件）。
2. **Mac 包 ad-hoc 签名**。用户首开需右键「打开」绕 Gatekeeper。若要正式分发，需提供 Apple Developer 证书并切回 distribution 签名（届时注意坑 0d 的 Chrome timestamp 问题——可能需要 signIgnore 保持，identity 换正式证书）。
3. **多租户歧义管理入口只有后端 API**（`GET /api/comment-acquisition/leads/ambiguous-tenant` + `POST /leads/:id/claim-tenant`），无前端页面。歧义线索目前对所有租户不可见，需要管理员定期手动调 API 或补 UI。

### P2（排期即可）

4. **MAYNOR1024_API_KEY 轮换**：key 曾通过 launchctl setenv 泄露给本地进程（源头 `~/.codex/.env`，已 unsetenv + Electron 白名单根治），但历史暴露过，建议轮换该第三方网关 key。
5. **local-bridge 控制器测试 flaky**：`local-bridge.controller.spec.ts` 的 Phase 3A 用例在门禁并行跑时偶发 401（单跑 3 次全绿）。疑 nonce/端口竞态，值得专项排查。
6. **B 类获客真机硬门槛**：快手/小红书新路径选择器 + 小红书搜索页→详情页流程需 jz-win11 真机跑通（详见 `docs/3010-自动获客发现层切换方案-B类-20260905.md`）。
7. **配额统一改造未动代码**：dailyLimit 账号维度统一计数器方向已定（见项目备忘 TD 区），尚未实施。

---

## 五、发版 SOP（每版必走）

完整流程在 skill `ai-content-desktop-release`，此处只列骨架：

1. **升版本号 + 五处同步**：`desktop/package.json`、`desktop/package-lock.json`、`desktop/packager.json`、`frontend/src/lib/release-notes.ts`（RELEASE_NOTES 顶部条目 + DESKTOP_APP_VERSION）、`frontend/src/app/(dashboard)/release-notes/page.tsx`（currentVersion）。⚠️ 后两个 lock/packager 最易漏（version-sync 门禁会拦）。
2. **四层门禁**：`env -u ... node scripts/pre-release-full.mjs`（L1 静态+单测 / L2 构建+守卫 / L3 真实功能+全路由扫描 / L4 解包验证）。前置：3010/3011 launchd 在跑、`/tmp/electron-test-token.txt` 有效登录 token（登录 3011 后从 cookie `ai_content_session` 提取）、7z、asar。
3. **前端构建必须同源**：`NEXT_PUBLIC_API_BASE=/api` 写进 `.env.local` 再 next build，构建产物要 rsync 到 `~/.workbuddy/ai-content-frontend/out/` 并 kickstart frontend（否则 L3 扫描测的是旧页面）。
4. **打 Mac 包**：`PATH=venv/bin:$PATH npm run build:mac`（venv = `~/.workbuddy/binaries/python/envs/default`，为 regenerate-icons 的 Pillow）。产物 + `latest-mac.yml` 自动生成。
5. **打 Win 包**：`KAYPAL_CROSS_BUILD_WIN=1 BUILD_PLATFORM=win-x64 PLAYWRIGHT_WIN_BROWSERS=desktop/pw-win npm run build:win`（详见 skill `ai-content-win-crossbuild`）。**先 Mac 后 Win**；Win 打完必须恢复本地环境三件套（prepare-playwright-browsers mac 分支 → build:bundle:sqlite 不带 BUILD_PLATFORM → sync-runtime-bundle → 重启 3011 → 验 agent-s health ok:true）。
6. **上传**：`npm run upload:oss`（现在脚本已含双平台 6 文件）+ `npm run release:verify:remote` 验证三通道。GitHub Release 用 gh CLI 补（tag 格式 `v1.1.116`）。
7. **Windows 真机验收**：skill `wuying-clouddesktop-test`（云电脑 ecd-5gk1odk27jnz1pdol，Win11）。⚠️ 遵守其坑 34-37（ps1 纯 ASCII / 无 -C - / 不杀安装器 / 一体化脚本+字节数校验）。
8. **测完释放**：`stop-desktops`。

---

## 六、关键坑速查（血泪史浓缩）

| 坑 | 一句话 | 出处 |
|---|---|---|
| PrismaService Proxy 白名单 | 加私有字段必须同步白名单，否则运行时静默 undefined | prisma.service.ts:80 |
| 业务表懒建表 | schema 新增 model 必须在 service 里 onModuleInit 建表，否则 R1 红 | skill 0e |
| build.files 白名单 | desktop 新增本地文件必须同步，asar 缺文件轻则功能失效重则双击崩 | skill 0c/0e |
| Mac 签名 timestamp | identity:null + signIgnore(playwright-browsers 正则)；signIgnore 是正则不是 glob | skill 0d |
| 前端构建同源 | NEXT_PUBLIC_API_BASE=/api，否则跨域丢 cookie 全跳登录 | skill 坑 1 |
| 打包顺序 | 先 Mac 后 Win；Win 后恢复 darwin engine + mac chromium | skill 坑 0 |
| sharp 完整性 | 安装包 backend/node_modules/sharp 必须带 dist/@img/detect-libc/semver | skill 0b |
| NSIS 中文路径 | 安装器路径含非 ASCII 静默 exit=2；测试先复制到 C:\ProgramData\ | 云电脑坑 18 |
| 云电脑 ps1 | 必须**纯 ASCII**（中文注释都会炸） | 云电脑坑 34 |
| 安装器不可中途杀 | 杀了 → V8 snapshot 缺失 → FATAL 秒退 | 云电脑坑 36 |

---

## 七、测试环境与工具

- **测试账号**：18230326666 / sn198456（kaypal FLAGSHIP，本机 3011 与云电脑均可用）。
- **云电脑**：阿里云无影 `ecd-5gk1odk27jnz1pdol`（Win11，杭州，按量付费）。CLI：`~/.local/bin/aliyun ecd ...`，命令一律 `env -u` 清 4 个代理 + kebab-case 参数。
- **登录 token 生成**：`curl -X POST http://127.0.0.1:3011/api/auth/login -d '{"username":"...","password":"..."}' -c /tmp/login-cookie.txt` → `awk '$6=="ai_content_session"{print $7}' /tmp/login-cookie.txt > /tmp/electron-test-token.txt`。
- **错误排查**：`error-reports/`（OSS，v1.1.89+ 自动上报 500）优先于用户日志；本地日志 `~/Library/Application Support/ai-content-desktop/logs/backend-launch.log`。
- **skill 清单**（`~/.workbuddy/skills/`）：`ai-content-desktop-release`（发版全流程）、`ai-content-win-crossbuild`（Win 交叉构建）、`wuying-clouddesktop-test`（云电脑真机）、`ai-content-scan-env`（测试环境搭建）、`ai-content-ui-unify`（UI 统一）、`ai-content-page-legacy-migration`（旧页下线）。

---

## 附录 A：关键 commit 链（2026-09-06 五轮复核 + 发版）

```
33fa3f55  P1-1 租户隔离：历史 NULL 线索原子认领
8045220e  P1-2 desktop-panel 登录态持久化
00c423d7  P1-3 回复生成 409 修复
72412555  P1-4 悬浮胶囊点击穿透
bcecc3ae  P1-5 lint 基线清理（281 error → 0）
9edd2e50  第二轮：租户迁移/私信失败回写/去重正确性
034c3b6b  第二轮：桥契约 + 强制重载忽略缓存
6fdbf389  第三轮：测试契约/平台归一化/去重/回滚（5P1+2P2）
6948ea7a  第四轮：私信稳定身份 + SQLite 回滚事务（P0+P1）
cfe042c5  第四轮：多租户歧义计数审计
68eb5694  第五轮：私信 ID 全链透传 + 精确匹配 fail-closed（P0）
36627889  第五轮：前端 lint any 类型
b73081ce  第五轮：租户歧义管理入口 + Electron 环境白名单
f7b5583d  version: 1.1.115 → 1.1.116
c859f28e  发版门禁：account_touch_quotas 懒建表
cd0cae27  发版门禁：登录 500（白名单 P0）
6b14135e  Mac 签名 identity:null + signIgnore
2d60d18b  build.files 补 pill 白名单
```

## 附录 B：交接后第一周建议动作

1. 跑一遍 `npm run pre-release-full`（不动版本，验证门禁基线在你环境全绿）。
2. 用云电脑补**假旧版升级 E2E**（遗留 P1-1）。
3. 定一个 MAYNOR key 轮换 + Apple 证书的决策（找大王）。
4. 读 `desktop/main.js` 的 sanitizeInheritedEnv（环境白名单）与 PrismaService 白名单机制——这两处是最容易无意识改坏的。
5. 把本仓库的 `.workbuddy/memory/`（尤其 `2026-09-05.md`）当作变更日志读一遍，里面是五轮复核的完整交底。
