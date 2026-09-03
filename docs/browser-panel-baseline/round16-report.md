# round16 报告：真实任务全链（3013 dom-agent 循环 × 面板上行桥）

日期：2026-09-03 深夜 ~ 09-04 凌晨
触发：大王指令「用真实任务体验一下内置浏览器」→「你妈的。你去测」

## 结论先行

**真实任务全链已跑通**：登录 → 建 agent-browser 会话 → 发自然语言指令 →
Observe-Act-Verify 循环解析动作 → 面板上行桥 → 用户面板页真实执行 →
extract 拿到真实标题 + screenshot 真实 PNG → 终态 succeeded → 桥凭据清理。
stage16 真机冒烟 **7/7 PASS**（evidence `stage16-evidence-2026-09-03T16-34-21.json`）。

本轮共抓出并修复 **2 个 P1**（下述），外加 1 次构建事故（已回滚恢复，见交底）。

## 修复明细

### P1-A：`syncTenantOrgTables is not a function` → 登录 500（3011 生产在挂）

- **现象**：3011 测试账号登录必 500；同秒日志里既有"组织关系已回补成功"又有
  TypeError，重启无效，静态看 bundle 里定义/调用均在。
- **根因**（堆栈帧 `Proxy.ensureAccountDatabase` 定位）：`PrismaService` 构造返回
  自定义 Proxy，`TARGET_ONLY` 白名单外的属性访问被路由到"当前活跃账号库
  PrismaClient"。`ensureAccountDatabase` 在白名单内（外层能调到），但它内部
  `this.syncTenantOrgTables(...)` 的 `this` 是 proxy——`syncTenantOrgTables`
  **没登记白名单** → 被路由到账号库普通 PrismaClient（无此方法）→ TypeError。
  相邻行的 `healAccountDatabaseIfCorrupt` 在白名单内所以成功——一成一败之谜。
- **修复**：`backend/src/prisma/prisma.service.ts` TARGET_ONLY 补登
  `syncTenantOrgTables`（与 ensureAccountDatabase 同进退）。
- **防回归**：`prisma.service.spec.ts` 新增白名单完整性护栏——静态扫控制面方法
  （ensureAccountDatabase/heal/clear/copy/sync/switch）体内全部 `this.*` 引用，
  断言全部登记 TARGET_ONLY（$ 前缀 PrismaClient 原生方法除外）。以后再加方法
  自动覆盖。负向验证：临时删白名单项 → 护栏红；还原 → 绿。

### P1-B：面板桥 `Page.captureScreenshot` 3s 超时 → 截图必失败（partial_success）

- **现象**：stage16 首跑 extract 成功、screenshot 三连超时（`面板桥请求失败：
  /execute` TIMEOUT），终态 partial_success。
- **根因**：`agent-panel-bridge.service.ts` 全局 `REQUEST_TIMEOUT_MS = 3000`。
  截图要 CDP 执行 + 整页 PNG base64（数百 KB）回传，真机 3s 不够；extract
  快所以通。stage13 直调时给的是 8s，走桥后被 3s 卡死。
- **修复**：差异化超时——`EXECUTE_SLOW_METHODS = {Page.captureScreenshot}`，
  慢动作 10s，其余维持 3s 快速失败不变（`call()` 加可选 timeoutMs 参数）。
- **防回归**：桥 spec stub 加慢截图路由（4s > 旧 3s），用例断言不超时且免单
  直执行。负向验证：临时改回 3s → 红；还原 → 绿。桥 spec 43/43。

## 新增 stage16 真机冒烟（7 项）

`desktop/scripts/browser-panel-stage16-smoke.mjs`（electron 桌面端角色 harness）：
真实 manager/wiring/IPC/bridge-runtime，userData 固定真实目录（backend 可读），
node 侧直接打 3013 REST 全链（登录→建会话→open 面板→run→断言→清理）。
S1 登录链 / S2 dom-agent 建会话 / S3 桥 binding 0600 落盘 / S4 run 同步完成 /
S5 succeeded+真实标题 / S6 截图成功+无 base64 泄漏 / S7 退出凭据清理。

## 构建事故与恢复（如实交底）

00:15 重建 SQLite bundle 后，产物出现两种坏形态（缺 playwright external 解析、
Prisma client 变 postgres 版），sync 到 runtime 后 **3011 生产实例 crash loop**。
处理：发现 `dist-bundle-sqlite.bak-*` 备份链出现 00:19~00:22 三个新时间戳的
并发构建产物（疑与本机其他进程/会话相关，未定论），其中源码树 00:20 产物
经验证**包含全部修复且 client/engine 正确**（whitelist + 10s 超时 + sqlite
dylib），sync 回 runtime 后 3011 恢复（health 200，PID 24589）。
坏产物已留档：`~/.workbuddy/ai-content-backend/dist-bundle-sqlite.bad-20260904T0020`。
⚠️ 教训：**sync:runtime-bundle 前必须先本机冒烟产物**（health + 关键特征 grep），
不能构建完直接推生产 runtime；备份轮换只保 3 份，事故时 .bak-155100 被轮换掉，
靠源码树产物恢复。构建产物验机步骤待固化进 sync 脚本（欠账）。

## 环境事实（本轮探明）

- dom-agent 循环灰度开关 `AGENT_BROWSER_MODE=dom-agent`（3011 生产保持 legacy
  不动，隔离实例 3013 验证）。
- 面板模式开关不是 env：desktop 写 userData `browser-panel-mode.json`
  （0600，pid 探活 fail-closed）；桥凭据 `browser-panel-bridge.json` 由
  bridge-runtime 在面板 opened 时写、hidden/destroy 时删。
- Playwright 引擎（sidecar + CDP 浏览器 port 动态）与面板桥是两条执行通道：
  agent 循环建会话时引擎导航（startUrl），动作执行按 panelMode 路由到面板桥。
- `www.kaypal.cn` 本机证书校验失败（代理劫持），冒烟用本地 fixture。
- `example.com` 引擎导航成功；Playwright 引擎模式下 loop 探活
  `isEngineAlive` 对存活引擎误报死（getOrCreateSession probe 链路，待查，见欠账）。

## 欠账（非阻塞）

1. Playwright 引擎模式 isAlive 探活误报（engine_unavailable 假阳性）——面板
   模式不受影响（探活走桥 health），但 legacy/无面板场景待查。
2. sync:runtime-bundle 前置验机（health + 特征 grep）固化进脚本。
3. 00:19~00:22 并发构建来源未定论（本机可能有其他会话在跑构建）。
4. 累计旧欠账不变：Windows smoke 1~16 补账（发版 gate）、screenshotBase64
   上层落盘、probe/extract 表达式双端两份、windowOpenHandler、tab 拖拽重排等。

## 提交清单（逐文件）

- backend/src/prisma/prisma.service.ts（P1-A 修复）
- backend/src/prisma/prisma.service.spec.ts（护栏用例）
- backend/src/modules/local-engine/agent-panel-bridge.service.ts（P1-B 修复）
- backend/src/modules/local-engine/agent-panel-bridge.service.spec.ts（防回归）
- desktop/scripts/browser-panel-stage16-smoke.mjs（新增）
- docs/browser-panel-baseline/stage16-evidence-*.json（2 份）
- docs/browser-panel-baseline/round16-report.md（本文）
