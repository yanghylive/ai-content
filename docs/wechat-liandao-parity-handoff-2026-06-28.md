## 当前目标

把微信任务做到接近/打平炼刀：Windows 10/11 微信联系人随机/全部同步稳定，群发、加好友、朋友圈发布、朋友圈营销、会话历史、诊断证据和发布门禁形成商用闭环。

## 已完成

- 版本已升到 `1.1.31`：`desktop/package.json`、`desktop/package-lock.json`、`desktop/packager.json`。
- 已打 Windows 安装包：`/Users/yanghy/Documents/New project/ai-content/desktop/dist/KaypalAI内容创作平台 Setup 1.1.31.exe`。
- 已上传 OSS：`https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml` 已指向 `version: 1.1.31`，安装包远端 `HTTP 200`。
- 已补 Windows WeChat 任务合同、诊断、UI 提示、发布门禁、失败证据导出、`local-engine` 运行检查项。
- 已对比炼刀：炼刀核心是 Windows native + `wx_key.dll`/内存取 key + SQLCipher 解密 + OCR/UIA/pywin32 自动化；本系统目前只做到合同、诊断、门禁和部分 UIA/缓存路径。
- 已写开发文档：`/Users/yanghy/Documents/New project/ai-content/docs/wechat-liandao-parity-development-plan-2026-06-28.md`。

## 当前状态

- 已验证：`npm run build:win` 通过，前端静态导出、后端 SQLite bundle、Windows runtime/Chromium 资源、安装包资源检查、体积检查均通过。
- 已验证：OSS `latest.yml` 返回 `1.1.31`，安装包 `KaypalAI内容创作平台 Setup 1.1.31.exe` 可访问。
- 未完成：没有真正打平炼刀；还缺真实微信加密 DB 解密、可靠 wx_key 获取、Windows native 执行器、全流程真机验收。
- 当前阻塞：macOS 环境只能做构建和静态/模拟验证，不能证明 Win10/Win11 真实微信全流程可用。
- 风险：不要再把“诊断能跑”说成“功能已修好”；联系人同步、群发、加好友、朋友圈、会话历史必须用 Windows 真机证据说话。

## 下一步

1. 先做真正的 Windows WeChat DB/helper：自研或接入合法 helper，完成 key 获取、SQLCipher 解密、联系人表解析，不复制炼刀代码。
2. 实现 `wechat-native-runtime` 里的真实执行器：`contacts`、`group-broadcast`、`contact-add`、`moments-publish`、`moments-marketing`、`chat-history`。
3. 在 Windows 10/11 真机或本机 Windows 模拟器跑：随机同步、全部同步、重复同步、微信窗口遮挡/非通讯录页、DB 被占用、权限不足。
4. 补发布门禁证据：联系人同步证据、平台账号绑定证据、增长获客发送/回读证据，再允许正式发布。
5. 验证命令优先看：`npm run build:win`、`node desktop/scripts/windows-commercial-release-gate.js --commercial-release`、`node scripts/wechat-windows-contacts-acceptance.mjs --real`。

## 不能丢的约束

- 用户要求：别只做诊断，要修到商用级；新包必须版本号更新、测试后再上传 OSS。
- OSS 密钥不能写进仓库或文档，只能临时环境变量注入。
- 当前 git worktree 很脏，很多改动不是本轮版本号产生的，不能随手 revert。
- Windows 真机没过之前，不能承诺“已经打平炼刀”。

## 2026-06-29 续补

本轮已经补上内置 Windows 命令 runner 的骨架和门禁，不再只是“诊断提示”：

- 新增 `desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`。
  - 使用 Windows PowerShell `-STA` + UIAutomation。
  - 支持 `group-broadcast`、`contact-add`、`moments-publish`、`moments-marketing`、`chat-history`。
  - 非 Windows 直接返回 `unsupported_platform`，避免 macOS 模拟假成功。
  - 写入类命令必须有 `raw.realWechatActionAttempted:true` 和读回证据，否则 runtime 会拒绝成功。
- 新增 5 个安装包可发现的 runner 入口：
  - `kaypal-wechat-group-broadcast-runner.js`
  - `kaypal-wechat-contact-add-runner.js`
  - `kaypal-wechat-moments-publish-runner.js`
  - `kaypal-wechat-moments-marketing-runner.js`
  - `kaypal-wechat-chat-history-runner.js`
- 更新 `.gitignore`：
  - 放开 `desktop/runtime/wechat-native-runners/**`，否则 runner 只在本机存在，后续提交/交接会丢。
- 更新 `desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`：
  - 内置 runner 在 Windows 才算 runnable。
  - smoke 测试可用 `AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER=1` 强制探测。
- 更新 `desktop/scripts/check-full-installer-assets.js`：
  - 不能再只检查 `wechat-native-runners/README.md`。
  - Windows 打包 pre/post 都必须检查 core + 5 个 runner 文件存在。
  - Windows DB helper 资源必须检查 `wechat-db-helper.js`、`sqlite3.exe`、`README.md`，防止安装包里 helper 丢失。
- 新增 `scripts/wechat-native-bundled-runners-smoke.mjs`：
  - 验证内置 runner 文件齐全。
  - 验证 runtime diagnose 暴露 runner readiness。
  - macOS 上逐个验证 5 个 runner 都拒绝真实执行。
- 更新 `scripts/wechat-native-external-runner-smoke.mjs`：
  - 兼容内置 runner 存在后的 `unsupported_platform` 分支。
  - 继续验证可信外部 runner 可通过、假成功会被 readback guard 拦截。

本轮已验证：

- `node --check desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`
- `node --check desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`
- `node scripts/wechat-native-bundled-runners-smoke.mjs`
- `node scripts/wechat-native-external-runner-smoke.mjs`
- `npm test -- local-engine.wechat-contacts.spec.ts --runInBand`
- `npx tsc --noEmit`
- `node scripts/liandao-wechat-smoke.mjs --no-write`
- `BUILD_PLATFORM=win-x64 node desktop/scripts/check-full-installer-assets.js --phase=pre`

仍未打平炼刀的硬缺口：

- Windows 真机未验：当前 macOS 只能证明发现、合同、拒绝假成功和打包资源门禁，不能证明真实微信点击/发布/发送成功。
- 联系人 DB 解密仍缺可靠 helper：需要补 `wx_key`/内存 key 获取、SQLCipher 解密和联系人表解析的真实 Windows 通道。
- 群发附件还没开放：runner 当前只开放文本群发，附件发送必须先做 Windows 文件剪贴板投递和发送后读回验收。
- 朋友圈入口、按钮名、微信版本差异仍要真机录证：UIA 名称和控件层级可能随微信版本变化。

## 2026-06-29 继续补齐

本轮继续补“炼刀打平”里不依赖 Windows 真机现场的硬缺口，重点不是 UI 提示，而是合同、证据和门禁：

- `desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`
  - runner 版本升到 `0.2.0`。
  - 所有 PowerShell 输出统一补 `contractVersion`、`runner`、`runnerVersion`、`completedAt`。
  - 外层失败不再默认标记 `realWechatActionAttempted:true`；只有真实触碰微信动作后才标记。
  - 群发附件从“直接不支持”改为通过 Windows 文件剪贴板投递，但必须读回文件名；读不回来直接失败，不允许假成功。
  - 群发、加好友、朋友圈营销失败结果写入截图证据；批量任务诊断写入 `batch` 统计。
- `desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`
  - 修复受控预检调用 `controlledRunnerBlockedReason` 少传 command 的问题。
- `scripts/wechat-native-command-contract-smoke.mjs`
  - 新增 5 类微信命令合同 smoke：群发、加好友、朋友圈发布、朋友圈营销、会话历史。
  - 覆盖 bundled runner dry-run、非 Windows 禁跑、外部 runner 合格成功、缺 readback/evidence 拒绝、假成功拒绝。
- `scripts/liandao-wechat-smoke.mjs`
  - 总 smoke 纳入 5 类 native command runner 合同脚本检查。
- `desktop/scripts/check-full-installer-assets.js`
  - Windows 打包资源检查增加 runner 证据能力标记：附件 readback、batch 统计、真实动作 attempted 标记。
- `backend/src/modules/local-engine/local-engine.service.ts`
  - 联系人同步失败诊断写入 `failureRecord` 和 `evidencePackage`。
- `scripts/wechat-diagnostics-evidence-pack.mjs`
  - 新增诊断证据包生成/校验脚本，能从 diagnostics/export JSON 或验收证据目录校验失败记录。
- `frontend/src/app/(dashboard)/workbench/wechat/wechat-workbench-client.tsx`
  - 前端空目标拦截、同步失败保留诊断卡、随机/全部同步区域自适应、按钮禁用态按数据可用性收紧，减少“点了才报 runtime error”和布局重叠。

本轮已验证：

- `node --check desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`
- `node --check desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`
- `node --check scripts/wechat-native-command-contract-smoke.mjs`
- `node --check scripts/liandao-wechat-smoke.mjs`
- `node --check scripts/wechat-diagnostics-evidence-pack.mjs`
- `node scripts/wechat-native-command-contract-smoke.mjs`
- `node scripts/wechat-native-bundled-runners-smoke.mjs`
- `node scripts/wechat-native-external-runner-smoke.mjs`
- `node scripts/liandao-wechat-smoke.mjs --no-write`：249 passed / 0 failed / 0 blocked / 1 skipped。
- `node scripts/wechat-diagnostics-evidence-pack.mjs --input docs/acceptance-evidence-2026-06-29/windows-wechat-contacts-simulator --validate-only`
- `BUILD_PLATFORM=win-x64 node desktop/scripts/check-full-installer-assets.js --phase=pre`
- `cd backend && npm test -- --runInBand local-engine.wechat-contacts.spec.ts`：48/48 passed。
- `cd backend && npx tsc --noEmit --pretty false`
- `cd frontend && npx tsc --noEmit --pretty false`

仍然不能说“已经打平炼刀”的部分：

- Windows 真机还没跑 5 类命令的真实 UIA 发送、发布、点赞、评论、会话读取。
- Windows 真机还没跑联系人 DB 解密 + UIA fallback 的 Win10/Win11 双系统证据。
- 这轮没有重新打安装包上传 OSS；原因是当前验证仍是 macOS 合同/静态/模拟器层，按发布红线不能把它说成 Win10/Win11 商用验收通过包。

## 2026-06-30 Windows 模拟器验证与门禁补齐

按“真机实测去本机模拟器测试，其他先干完”的要求，本轮把 Windows 模拟器验证和非真微信依赖的门禁继续补齐：

- Windows 模拟器：
  - UTM VM `Windows` 已启动，IP `192.168.64.2`。
  - 系统版本：`Microsoft Windows [Version 10.0.26200.8655]`。
  - Node：`v20.18.0`。
  - 已发现微信安装目录：`C:\Program Files\Tencent\Weixin`。
  - 已能看到 `Weixin.exe` / `WeChatAppEx.exe` 进程。
- 新增 `scripts/wechat-windows-native-commands-acceptance.mjs`：
  - 一条命令生成 Windows native runner 验收证据目录。
  - 覆盖 `wechat-native-command-contract-smoke`、`wechat-native-bundled-runners-smoke`、`wechat-native-external-runner-smoke`。
  - 在 Windows 下额外跑真实 `contacts` native runtime，并把结果写入 `04-contacts-native-runtime-real.json`。
  - 默认不要求真实联系人成功；传 `--require-real-wechat` 后才把真实联系人失败作为阻断发布的硬失败。
- 更新 `desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`：
  - 当 Windows 里存在 `Weixin.exe` 进程、但 UIA 拿不到窗口标题/节点时，错误码改为 `permission_missing`，不再误报 `wechat_not_running`。
  - `nextAction` 改成白话：微信进程存在，但当前执行器拿不到可控窗口；需要在同一个已登录的用户桌面会话打开微信通讯录，避免服务会话或管理员/非管理员混合会话。
- 更新 `scripts/wechat-native-command-contract-smoke.mjs`：
  - Windows 平台输出不再写“reject non-Windows”，改为 `bundled runners are discoverable on Windows and dry-run safe`。
- 更新 `scripts/liandao-wechat-smoke.mjs`：
  - 总 smoke 纳入新的 Windows native commands acceptance 脚本检查。

本轮 Windows 模拟器实测证据：

- 证据目录：`docs/acceptance-evidence-2026-06-30/windows-wechat-native-commands-simulator/utm-windows/`
- Windows 模拟器执行结果：
  - `wechat-native-command-contract-smoke`：passed。
  - `wechat-native-bundled-runners-smoke`：passed。
  - `wechat-native-external-runner-smoke`：passed。
  - `contacts-native-runtime-real`：blocked。
- blocked 原因：
  - `errorCode: permission_missing`
  - `windowStatus: not-found`
  - `processName: Weixin.exe`
  - `processId: 740`
  - `uiaStatus: not-wechat-contacts-page`
  - `failureReason: UIA 状态 not-wechat-contacts-page，只识别到 0 个联系人，拒绝作为通讯录结果`
- 解释：
  - 这证明当前 Windows 模拟器里 runner 合同和 Windows 执行链能跑。
  - 也证明当前模拟器微信不是可控通讯录窗口状态，真实联系人同步没有通过，不能包装成“已打平炼刀”。
- 进一步定位：
  - `utmctl exec` 默认是 `nt authority\system`，会把微信拉到服务会话；这种状态 UIA 看不到用户桌面窗口。
  - 活跃桌面用户是 `WIN-LF040VM3F47\signer`，已通过 Windows 任务计划 `/IT` 把 `Weixin.exe` 拉到 Console session 1。
- 最终 signer 交互会话证据目录：`docs/acceptance-evidence-2026-06-30/windows-wechat-native-commands-simulator/utm-windows-signer-v3/`
  - `wechat-native-command-contract-smoke`：passed。
  - `wechat-native-bundled-runners-smoke`：passed。
  - `wechat-native-external-runner-smoke`：passed。
  - `contacts-native-runtime-real`：blocked，不再是 failed。
- 最终 blocked 原因：
  - `errorCode: target_not_found`
  - `status: blocked`
  - `windowStatus: ready`
  - `processName: Weixin.exe`
  - `uiaStatus: not-wechat-contacts-page`
  - `nextAction: 微信窗口已打开，但当前不是通讯录页；请先扫码登录并切到左侧“通讯录”，再重新同步。`
- 结论：
  - Windows 模拟器的 runner/合同/证据链已经跑通。
  - 模拟器微信当前停在登录/非通讯录页，未完成真实联系人 random/all 成功验收。
  - 下一次要继续真机验收，必须先让模拟器里的微信扫码登录并进入通讯录页，再运行 `node scripts/wechat-windows-native-commands-acceptance.mjs --simulator --contacts --require-real-wechat`。

本轮本机验证：

- `node --check scripts/wechat-windows-native-commands-acceptance.mjs`
- `node --check scripts/wechat-native-command-contract-smoke.mjs`
- `node --check scripts/liandao-wechat-smoke.mjs`
- `node --check desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`
- `node scripts/wechat-native-command-contract-smoke.mjs`
- `node scripts/wechat-native-bundled-runners-smoke.mjs`
- `node scripts/wechat-native-external-runner-smoke.mjs`
- `node scripts/wechat-windows-native-commands-acceptance.mjs --simulator --skip-contacts`：passed 3 / skipped 1。
- `node scripts/wechat-windows-contacts-acceptance.mjs --simulator`：passed 7 / failed 0。
- `node scripts/liandao-wechat-smoke.mjs --no-write`：251 passed / 0 failed / 0 blocked / 1 skipped。
- `cd backend && npm test -- --runInBand local-engine.wechat-contacts.spec.ts wechat-native-command.contract.spec.ts`：52/52 passed。
- `cd backend && npx tsc --noEmit --pretty false`
- `cd frontend && npx tsc --noEmit --pretty false`

仍未与炼刀打平的部分：

- 当前 UTM Windows 微信进程在不可控窗口状态，未完成真实联系人 random/all 成功证据。
- 5 类真实动作仍缺 Windows 可控微信窗口下的成功证据：群发、加好友、朋友圈发布、朋友圈营销、会话历史。
- DB 解密 helper 仍需在真实微信数据目录下验证：`wx_key`/内存 key、SQLCipher 解密、联系人表解析。
- 当前可以做安装包工程门禁，但不能把这轮称为“真机全流程通过包”。

## 2026-06-30 商用审批合同与五类命令门禁续补

本轮继续补“不依赖真实 Windows 微信现场”的商用级缺口，重点是防假成功、防绕审批、防无证据发布：

- `desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`
  - 新增统一失败分类：`wechat_not_logged_in`、`wechat_not_running`、`permission_missing`、`risk_prompt_detected`、`target_not_found`、`readback_failed`、`timeout`、`send_failed`、`runtime_unavailable`。
  - 写入类命令不再只返回笼统失败；群发、加好友、朋友圈发布、朋友圈营销、会话历史都会带阶段、截图、回读和对象级 evidence。
  - 会话历史补 `readback` 和截图证据，群发/加好友/朋友圈营销补 blocked 统计。
- `scripts/wechat-windows-native-commands-acceptance.mjs`
  - 增加 `--commands`、`--skip-commands`、`--require-real-wechat-commands`。
  - 五类真实命令分别落证据：`group-broadcast`、`contact-add`、`moments-publish`、`moments-marketing`、`chat-history`。
  - 成功必须有真实动作、readback 和 screenshot evidence；缺一项不能作为商用通过。
- `desktop/scripts/windows-commercial-release-gate.js`
  - 商业发布门禁新增五类 native command 真机证据检查。
  - 新增 DB/helper 真机证据检查：`wx_key`/helper/SQLCipher/联系人解密结果。
  - 新增 Win10/Win11 矩阵检查：联系人和五类命令都必须在真实 Windows 证据中出现。
  - 静态 smoke、模拟器 smoke 只作为合同层证据，不再能替代商用放行。
- 后端商用风险审批：
  - `approveTask` 对所有微信/抖音真实执行任务强制完整 risk confirmation。
  - 恢复 paused 的真实执行任务不允许直接 `resumeTask`，必须重新走审批。
  - 群发重发 `resendGroupBroadcastPlan` 也强制后端风险确认。
  - `confirmations/clear-pending` 移除公开访问，不能未登录清空待审批。
- 前端调用合同：
  - `/local-engine` 审批、微信群发重发、Agent 工作台确认都补齐 `riskConfirmation`。
  - 前端不能再只传 UI 勾选字段绕过后端风险门禁。

本轮验证结果：

- `cd backend && npm test -- --runInBand local-engine.wechat-contacts.spec.ts wechat-native-command.contract.spec.ts local-engine.business-task-type.spec.ts`：3 suites / 124 tests passed。
- `cd backend && npx tsc --noEmit --pretty false`：passed。
- `cd frontend && npx tsc --noEmit --pretty false`：passed。
- `node --check desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`：passed。
- `node --check scripts/wechat-windows-native-commands-acceptance.mjs`：passed。
- `node --check desktop/scripts/windows-commercial-release-gate.js`：passed。
- `node scripts/wechat-native-command-contract-smoke.mjs`：passed。
- `node scripts/wechat-native-bundled-runners-smoke.mjs`：passed。
- `node scripts/wechat-native-external-runner-smoke.mjs`：passed。
- `node scripts/wechat-windows-native-commands-acceptance.mjs --simulator --skip-contacts --skip-commands`：passed 3 / skipped 6。
- `node scripts/liandao-wechat-smoke.mjs --no-write`：251 passed / 0 failed / 0 blocked / 1 skipped。
- `node frontend/scripts/local-engine-run-check-guard.mjs`：passed。
- `cd frontend && node scripts/local-engine-run-check-guard.mjs`：passed。
- `cd backend && npm test -- --runInBand local-engine.browser-status.spec.ts`：4 tests passed。

当前本地包状态：

- 当前本地 desktop package version：`1.1.33`。
- 本地安装包 artifact 存在：`desktop/dist/KaypalAI内容创作平台 Setup 1.1.33.exe`。
- `latest.yml` 和 `app.asar` 版本一致，静态安装包资源检查通过。
- 商业发布门禁仍正确阻断，不能上传正式 OSS：
  - `node desktop/scripts/windows-commercial-release-gate.js --commercial-release`
  - 结果：`PASS=19`、`BLOCKER=11`。

当前剩余 blocker：

- 缺 realWechat live smoke，无真实微信 live 证据。
- 缺 `growth-acquisition` / `growth-commercial-live-gate` 证据。
- 缺 Windows real-machine 联系人 random/all 成功证据。
- 缺 Windows real-machine DB/helper/SQLCipher 联系人解密证据。
- 缺五类微信 native command 在真实 Windows 微信里的成功证据。
- 缺 Win10/Win11 双系统矩阵证据。
- 缺平台账号 QR 绑定持久化证据。
- 缺 Windows 增长获客发送/回读证据。

结论：

- 当前比 1.1.31 明显补齐了合同、后端审批、五类命令证据结构和商业发布门禁。
- 当前仍不能宣称已经打平炼刀；差距只剩真实 Windows 微信能力和真实证据，不是页面或静态合同问题。
- 后续继续时，优先在 Windows 模拟器或真机完成：微信登录到通讯录页、联系人 random/all、五类命令测试对象闭环、DB/helper 解密证据、Win10/Win11 矩阵。

## 2026-06-30 本机 UTM Windows VM 实测续补

本轮按“去本电脑的虚拟机测试”执行，环境为本机 UTM `Windows` VM：

- VM 状态：`utmctl status Windows` = `started`。
- VM IP：`192.168.64.2`。
- VM Windows：`Microsoft Windows [Version 10.0.26200.8655]`。
- VM Node：`v20.18.0`。
- VM 测试目录：`C:\KaypalWinTest\ai-content`。
- VM 微信进程：存在 `Weixin.exe`，但 `utmctl exec` 通过 guest agent 运行在 `nt authority\system`，不能控制用户桌面的微信主窗口。

发现并修复的问题：

- 真实 Windows VM 中五类 native runner 原先全部卡在 `*-powershell-no-json`。
- 根因不是业务参数，而是 Windows PowerShell 5.1 读取无 BOM UTF-8 `runner.ps1` 时会按本地 ANSI 代码页解析，脚本里的中文风控词和诊断文本被破坏，引发 `ParserError`。
- 已修复 `desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`：
  - 写入 `runner.ps1` 时改为 UTF-16LE + BOM，并统一转 CRLF。
  - `Add-Type` C# 片段改为稳定的 `-TypeDefinition` 编译方式。
  - 新增“进程存在但拿不到可控主窗口”的检测分支，不再误报 `wechat_not_running`。
  - 五类命令现在能返回结构化 `permission_missing`，而不是 PowerShell 语法错误。

本轮 VM 严格验收：

- 命令：`node scripts\wechat-windows-native-commands-acceptance.mjs --simulator --contacts --commands --require-real-wechat --require-real-wechat-commands ...`
- 证据目录：`docs/acceptance-evidence-2026-06-30/windows-wechat-native-commands-simulator/utm-strict-vm-20260630-permission-classified/wechat-native-commands-acceptance-vm-permission-classified`
- 结果：`passed=3 blocked=6 failed=0 skipped=0`。
- 已通过：
  - `wechat-native-command-contract-smoke`
  - `wechat-native-bundled-runners-smoke`
  - `wechat-native-external-runner-smoke`
- 阻断项：
  - `contacts-native-runtime-real`：`native-no-contacts`，VM 里微信进程存在但当前执行器拿不到可控窗口。
  - `group-broadcast`：`permission_missing` / `group-broadcast-uia-failed`。
  - `contact-add`：`permission_missing` / `contact-add-uia-failed`。
  - `moments-publish`：`permission_missing` / `moments-publish-uia-failed`。
  - `moments-marketing`：`permission_missing` / `moments-marketing-uia-failed`。
  - `chat-history`：`permission_missing` / `chat-history-uia-failed`。

本轮本地验证：

- `node --check desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js`：passed。
- `node --check scripts/wechat-windows-native-commands-acceptance.mjs`：passed。
- `node scripts/wechat-native-command-contract-smoke.mjs`：passed。
- `node scripts/wechat-native-bundled-runners-smoke.mjs`：passed。
- `node scripts/wechat-native-external-runner-smoke.mjs`：passed。

当前判断：

- 已修掉真实 Windows VM 暴露出来的 PowerShell 编码/解析硬 bug。
- 当前 VM 测试仍不能作为“真实微信成功证据”，因为 `utmctl exec` 的 SYSTEM 会话无法操作用户桌面微信窗口。
- 下一步要继续打平炼刀，必须让 Kaypal/runner 在同一个已登录 Windows 用户桌面会话内执行，或补一个用户态 agent/计划任务/开机托盘 helper，把命令转发到交互桌面会话执行。

## 2026-06-30 UTM 用户会话执行补测

继续验证“不是代码只能跑 SYSTEM”的问题，已在 VM 内用 Windows 交互计划任务转到登录用户 `WIN-LF040VM3F47\signer` 执行：

- `utmctl exec` 默认身份：`nt authority\system`。
- 微信进程身份：`WIN-LF040VM3F47\signer`，Session `Console 1`。
- 交互计划任务创建方式：`schtasks /create ... /it /ru WIN-LF040VM3F47\signer`。
- 探测输出确认任务实际身份：`win-lf040vm3f47\signer`。
- 该方式可作为 VM 自动验收的用户态执行入口，避免 SYSTEM 会话拿不到微信窗口。

用户会话严格验收：

- 证据目录：`docs/acceptance-evidence-2026-06-30/windows-wechat-native-commands-simulator/utm-user-session-vm-20260630/wechat-native-commands-acceptance-vm-user-session`
- 结果：`passed=3 blocked=6 failed=0 skipped=0`。
- 已通过：
  - `wechat-native-command-contract-smoke`
  - `wechat-native-bundled-runners-smoke`
  - `wechat-native-external-runner-smoke`
- 阻断项：
  - 联系人同步：`native-no-contacts`，微信窗口已打开，但当前不是通讯录页。
  - 五类 native command：均返回 `wechat_not_logged_in`，阶段分别为 `group-broadcast-wechat-not-logged-in`、`contact-add-wechat-not-logged-in`、`moments-publish-wechat-not-logged-in`、`moments-marketing-wechat-not-logged-in`、`chat-history-wechat-not-logged-in`。

最新结论：

- VM 自动执行通道已从 SYSTEM 会话推进到用户会话，执行器可以在正确用户身份下启动。
- 当前没有继续推进到成功闭环，是因为 VM 内桌面微信没有处于已登录通讯录/聊天/朋友圈可操作状态。
- 真实打平炼刀的下一道门槛不是脚本合同，而是：在 VM 或真机里保持微信已登录、打开通讯录页，再跑联系人 random/all 和五类命令成功证据。

## 2026-06-30 VM 联系人 only 复测

用户指出“之前测试结果没有用”后，本轮重新设计测试方式：

- 不混跑五类发送命令，只跑联系人同步。
- 先在 `WIN-LF040VM3F47\signer` 用户会话内抓微信窗口截图和 UIA 文本。
- 再分别跑联系人 `random` 和 `all`。
- 阻断时必须保留窗口截图、UIA 文本、random/all summary。

同时修复一个验收脚本问题：

- `scripts/wechat-windows-native-commands-acceptance.mjs` 原来没有解析 `--commands` / `--skip-commands` / `--require-real-wechat-commands`。
- 导致传了 `--skip-commands` 后，脚本仍然跑五类 native 命令，测试结果被污染。
- 已补解析逻辑。
- 本地验证：`node scripts/wechat-windows-native-commands-acceptance.mjs --simulator --skip-contacts --skip-commands` 输出 `passed=3 blocked=0 failed=0 skipped=6`。

本轮 VM 联系人 only 证据：

- 本地证据目录：`docs/acceptance-evidence-2026-06-30/windows-wechat-native-commands-simulator/utm-contacts-only-login-page-proof-20260630/kaypal-wechat-contacts-only-proof-20260630`
- 快照：`snapshot-before/wechat-window-snapshot.png`
- 快照 UIA 文本：
  - `微信`
  - `仅传输文件`
  - `二维码`
  - `扫码登录`
  - `网络代理设置`
- `contacts-random`：`passed=3 blocked=1 failed=0 skipped=5`
- `contacts-all`：`passed=3 blocked=1 failed=0 skipped=5`
- 两个模式阻断原因一致：微信窗口已打开，但当前不是通讯录页；当前窗口是二维码扫码登录页。

本轮结论：

- 这次测试是有效测试：已证明当前 VM 不能同步联系人不是 random/all 逻辑问题，而是 VM 微信处于未登录扫码页。
- 当前无法产出联系人成功证据；需要 VM 微信先完成扫码登录并进入通讯录页，再重跑同一套联系人 only random/all 验收。

## 2026-07-03 版本 1.1.42 联系人同步收口

本轮针对用户反馈“大壮 90 多个联系人、杨宏宇 6000 多联系人，但系统仍显示旧的 450 个”继续修复。

已完成：

- 修复 `desktop/runtime/wechat-db-helper/wechat-db-helper.js`：
  - DB helper 优先使用后端随包的 decryptor，不再先吃 `helper-fallback`。
  - 当前登录账号 DB 解不开时，允许使用当前账号对应的已解密快照缓存。
  - 当前账号已经同步成功后立即停止，不再继续扫描旧账号 DB，避免把旧号的 450/455 个联系人覆盖回来。
- 增加单测：`backend/src/modules/local-engine/local-engine.wechat-contacts.spec.ts`。
- 版本更新到 `1.1.42`：
  - `desktop/package.json`
  - `desktop/package-lock.json`
  - `frontend/src/app/(dashboard)/layout.tsx`
  - `frontend/src/app/(dashboard)/release-notes/page.tsx`
- 已打 Windows 安装包：
  - `desktop/dist/KaypalAI内容创作平台 Setup 1.1.42.exe`
  - `desktop/dist/KaypalAI内容创作平台 Setup 1.1.42.exe.blockmap`
  - `desktop/dist/latest.yml`
- 已上传 OSS：
  - `updates/KaypalAI内容创作平台 Setup 1.1.42.exe`，远端大小 `285168845`
  - `updates/KaypalAI内容创作平台 Setup 1.1.42.exe.blockmap`，远端大小 `284521`
  - `updates/latest.yml`，远端版本 `1.1.42`

VM 验收结果：

- 证据目录：`docs/acceptance-evidence-2026-07-03/vm-runtime-direct-contacts-1.1.41-current-result-break`
- Windows 用户：`signer`
- 当前微信账号：`yanghylive_ddd3`
- 当前账号 DB：`C:\Users\signer\Documents\xwechat_files\yanghylive_ddd3\db_storage\contact\contact.db`
- `random`：成功，`count=500`
- `all`：成功，`count=6217`
- 成功来源：`windows-wechat-native-helper`
- helper 来源：`windows-wechat-db-decrypted-cache`
- 耗时：`random` 约 3 秒，`all` 约 3 秒。

仍未和炼刀完全打平的地方：

- 这次 VM 成功依赖当前账号的已解密联系人快照缓存，能解决“旧账号 450/455 覆盖新账号”的问题，但还不是炼刀那种稳定的鲜活 DB key/native 解密链路。
- 如果一台新电脑从未生成过可用解密快照，而微信 DB 又处于加密/占用状态，当前系统仍可能需要等待 helper/native key provider 进一步补齐。
- 商业发布总门禁没有全绿。联系人本项 VM 已过，但门禁还要求真实 Windows 机器证据、五类微信 native command 真实读回、增长模块浏览器证据等；本次按用户要求先上传 1.1.42 安装包到 OSS。
