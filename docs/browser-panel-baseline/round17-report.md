# round17 报告：视频号（wechat-channel）登录攻坚——三平台登录全通

日期：2026-09-04（04:00 ~ 14:40）
触发：大王指令「1」（批准 Electron 44 升级方案）→「页面显示不全」→「没有显示。白屏」→「一直加载，登陆不上」→「还是不行」→「好了。但是黑屏」→「好了」

## 结论先行

**视频号登录真机全链路打通，三平台登录全部收口**（小红书 ✅ 抖音 ✅ 视频号 ✅）。

终验证据：面板 `/platform/` 工作台完整渲染（杨宏宇大神 · 视频 137 · 关注者 3956 ·
昨日数据/最近视频等私有数据实锤登录态）；login-state 端点实测
`state=logged_in, url=https://channels.weixin.qq.com/platform/, panelWebContentsId=7`。

本轮共修复 **2 个 P0/P1 + 1 次关键词校准**，跨 **4 笔 commit**，desktop 10 套件全绿、
backend 判定 spec 32 项全过。

## 根因三层剥（每层都有实证）

### P0-A：main.js 全局导航守卫拦面板——登录卡死真凶（commit c48f2141）

- **现象**：大王扫码 + 手机确认全部成功，面板永远卡「登录中...」；点重试无效；
  快捷登录「加载失败」。
- **定位过程**：CDP `Network.loadingFailed` 监听抓到
  `[FAIL net::ERR_ABORTED] type=Document`——确认后的跳转导航被中止。
- **根因**：`main.js:2798` 全局 `will-navigate` 守卫（安全白名单仅
  localhost:3010 / kaypal.cn / file:）对**面板视图同样生效**。微信 oauth 链路必须
  从 `open.weixin.qq.com` 跳回 `channels.weixin.qq.com/platform/oauth-callback.html`，
  每次都被 `preventDefault`。抖音能过纯属侥幸——其登录全程在 douyin.com 域内完成，
  无跨域导航。面板内点任何平台外链同样被拦（面板功能缺陷，不止微信）。
- **修复**：`BrowserPanelManager.ownsWebContents(id)`（`_knownWebContents` 归属判断，
  兼容 `getId()`/`.id` 双形态与销毁态）+ 全局守卫对面板体系（面板/控制条/审批浮层）
  豁免；主窗/3010 内容仍受白名单保护。
- **防回归**：spec ⑰ 归属判断用例（面板/控制条/审批命中，外部 webContents 与异常
  输入不命中），desktop 面板套件 35 项全过。

### P1-B：微信 oauth callback 的宿主机制——独立打开二维码页 code 必丢（认知修正）

- **现象**：守卫修复后跳转通了（`oauth-callback.html?code=...` 落地），但 partition
  cookie 始终为 0（`Storage.getCookies` 实证），/platform 被 302 弹回 login.html。
- **根因**：抓 callback.html 源码实锤——它**只做 postMessage**（`wx-oauth-code`）
  把 code 发给 window.parent/top，自己不发任何换票请求。独立导航到 qrconnect 页时
  宿主不存在 → code 丢弃。且 login.html 换票还校验 state（手动构造的
  `state=undefined` 会被拒）。
- **结论**：正规链路必须 `login.html 宿主 + 页面自己发起`（iframe 内 self_redirect
  → callback → postMessage 宿主 → 宿主换票写 cookie）。任何「帮用户直接打开二维码
  页」的捷径在微信这套机制下都是死路。

### P1-C：本机微信桥是快捷登录前置（运维认知）

- `localhost.weixin.qq.com:13013-14015` 全部 `ERR_CONNECTION_CLOSED` = 本机微信客户端
  未开 → 快捷登录探测必失败（「加载失败/一直加载」）。
- 大王打开微信后 14013 返回 200 → 快捷登录一键直通 → /platform 工作台渲染。
- 快捷登录链路不走 oauth-callback（本地桥直接换票），无 code 丢失问题。

### Electron 32.3.3 → 44.2.0（Chrome 128 → 152）（commit 4b3ca2b9）

- 白屏深层背景：2026 年微信前端不伺候 Chrome 128（UA 清洗后仍空壳）。
- desktop 仅 7 依赖零原生模块，升级低风险；10 套件全绿 + 真实启动冒烟通过。
- 安装坑：GitHub 直下慢 → `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- **启动坑（新发现）**：WorkBuddy Bash 会话注入 `ELECTRON_RUN_AS_NODE=1`，electron
  主进程以纯 Node 模式跑 → electron-updater `app undefined` 崩溃。启动必须
  `env -u ELECTRON_RUN_AS_NODE`。

### login-state 判定词表真机校准（commit 778d7006）

- **现象**：登录成功（工作台渲染）但 login-state 仍 login_prompt。
- **根因**：工作台首页左侧导航折叠，observe 的 innerText（前 2000 字符）只有顶栏+
  首页卡片（194 字符），旧词表（内容管理/数据中心等菜单词）全 miss。
- **修复**：补首页特异词 `视频号ID:|昨日数据|净增关注|作品优化建议|申请认证`
  （登录页 login.html 绝无这些字样；isLoginLikeUrl 先行判 login_prompt 双重隔离）。
- **防回归**：spec 新增首页真实 innerText 用例（取证文本进 spec），32 项全过。

## 验收证据

| 项 | 结果 |
|---|---|
| 面板工作台渲染 | ✅ /platform/ 完整（私有数据可见） |
| login-state 端点 | ✅ logged_in（真实桥调用，非 mock） |
| desktop 10 套件 | ✅ ALL GREEN（面板套件 35 项） |
| backend 判定 spec | ✅ 32 项全过 |
| 真实启动冒烟 | ✅ 守卫修复后桌面端重启多轮（ELECTRON_RUN_AS_NODE 修正） |

## commits（4 笔，已 push origin/main）

- `c48f2141` fix(desktop): 面板体系豁免全局导航守卫
- `4b3ca2b9` chore(desktop): Electron 32.3.3 → 44.2.0
- `12300a65` test(desktop): 视频号登录真机 harness 两件
- `778d7006` fix(backend): 视频号 login-state 关键词真机校准

## 新增 harness

- `desktop/scripts/verify-wechat-channel-login-poll.mjs`：精简轮询（不 open 面板，
  建 wechat-channel 会话 + 轮询 login-state 3s×5min）。
- `desktop/scripts/verify-wechat-channel-scan-login.mjs`：扫码全流程版
  （登录→建会话→CDP open 三参→轮询收口）。

## 诊断方法论沉淀（本轮新利器）

1. **ERR_ABORTED type=Document 抓导航拦截**：CDP Network 事件监听是定位
   will-navigate 拦截的决定性证据。
2. **`Storage.getCookies` 查 partition 真实登录态**：document.cookie 不含 httpOnly，
   cookie=0 实锤「登录态没建立」。
3. **oauth callback 逆向**：curl 拉 callback.html 源码直接看清机制（postMessage-only）。
4. **双 token 分层**：凭据文件 `browser-panel-bridge.json` 的 token 是 **transport 层**
   （x-kaypal-bridge-token）；capability token 在 broker 内存（wiring reconcile 管理，
   不出主进程）。backend 请求只带 transport token + actor。TOKEN_INVALID ≠ transport
   问题。桥鉴权三件套：transport token + nonce + ts（时钟偏差 ≤60s），缺一
   STALE_REQUEST/UNAUTHORIZED。

## 构建与部署事故交底（如实）

- **3011 部署真相（本轮最大教训）**：本机 3011 跑的是
  `~/.workbuddy/ai-content-backend/dist-bundle-sqlite/index.js`（守护进程托管，
  kill 后自动拉起）。我先 nest build + 手起 dist/main.js——**看似 LISTEN 成功，
  实则几秒内被守护顶掉**（lsof 假象），判定修复迟迟不生效浪费数轮排查。
  正确流程：`npm run build:bundle:sqlite` → `npm run sync:runtime-bundle`
  （自带产物验机双闸）→ kill 3011 等守护拉起。已固化进记忆与 skill。
- 误判教训 1：一度把 TOKEN_INVALID 归因「/platform/ 尾斜杠判定特征」——实际是
  3011 跑旧代码 + 判定词表缺失两层叠加。
- 误判教训 2：监听「URL 落地 /platform」实为 302 过境（cookie 无效弹回），
  不是登录成功——监听判定需以 login-state/cookie 实证为准，不能只看 URL。
- 误判教训 3：诊断中复用带 `Page.reload` 的 trace 脚本，把大王「登录中」现场
  冲掉过一次，二维码被作废重扫（操作类脚本必须只读化后再复用）。

## ⚠️ 遗留与下一步

1. **面板视口 785px** 装不下平台页（显示不全/黑块观感来源）——正经修法
   （平台化预设/zoom 记忆）待大王批。
2. 快捷登录依赖本机微信开着——文档需向用户说明（或后续提供纯扫码降级路径，
   需绕 iframe 转圈问题，待查）。
3. 按阶段 5 路线：**抖音/视频号只读动作序列真机校准 → 草稿/真实发布写链路
   （方案待批）→ Windows smoke 1~15 补账 → Mac 打包验收**。
4. 历史欠账不变：Playwright isAlive 假阳性、screenshotBase64 多模态消费。
