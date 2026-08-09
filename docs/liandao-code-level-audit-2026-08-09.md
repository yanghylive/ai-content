# 炼刀微信能力矩阵 · 代码级核对报告

日期：2026-08-09
范围：`docs/liandao-wechat-acceptance-matrix.md` 全部能力，对照 JIUZHANG 代码实现（后端 API + 执行器 + 打包资源）
方法：静态 smoke（251项全过）+ 代码级 grep 执行链路 + 双平台打包产物核对

## 结论总览

**矩阵 8 大能力已全部双平台覆盖**（本轮修复前 7/8，auto-reply 曾只有 macOS；修复后 Windows native runner 已补）。

| 能力 | macOS | Windows | 证据 |
|------|-------|---------|------|
| 联系人同步 | ✅ | ✅ | mac: wechat-contact-sync.py + Vision OCR；win: native `contacts` + helper + wx_key.dll |
| 会话/聊天历史 | ✅ | ✅ | mac: wechat-chat-history；win: native `chat-history` |
| 群发计划 | ✅ | ✅ | mac: skillhub group-broadcast；win: native `group-broadcast` |
| 加好友 | ✅ | ✅ | mac: wechat-contact-add + friend-accept；win: native `contact-add` + `friend-accept` |
| 朋友圈发布 | ✅ | ✅ | mac: wechat-moments-publish；win: native `moments-publish` |
| 朋友圈营销 | ✅ | ✅ | mac: wechat-moments-marketing；win: native `moments-marketing` |
| 会话回复（auto-reply） | ✅ | ✅（本轮补） | mac: wechat-auto-reply/live-auto-reply → skillhub 脚本；win: native `auto-reply`（read-latest/draft/send） |
| 直播自动回复（live-auto-reply） | ✅ | ✅（复用 auto-reply runner） | mac: wechat-live-auto-reply；win: `auto-reply` runner 的 read-latest 读原文能力 |

## 一、Windows 自动回复断链的 3 个实锤

### 1. Windows native 命令集没有 auto-reply
`backend/src/modules/local-engine/wechat-native-command.contract.ts:1412`
```ts
WECHAT_NATIVE_LEGACY_TASK_TYPE_TO_COMMAND = {
  'wechat-contacts-sync': 'contacts',
  'wechat-group-broadcast': 'group-broadcast',
  'wechat-contact-add': 'contact-add',
  'wechat-friend-accept': 'friend-accept',
  'wechat-moments-publish': 'moments-publish',
  'wechat-moments-marketing': 'moments-marketing',
  'wechat-chat-history-sync': 'chat-history',
}
```
7 个命令，**无 auto-reply**。`desktop/runtime/wechat-native-runners/kaypal-wechat-native-runner-core.js` 同样只有这 7 个。

### 2. reply-draft 任务在 Windows 上走 mac 命令路径
`backend/src/modules/local-engine/local-engine.wechat-native.mixin.ts:1163`：reply-draft 无 AI 回复文本时调用
```ts
this.runWechatDesktopCommand('wechat-live-auto-reply', [target, 'read-only'], target)
```
`runWechatDesktopCommand`（local-engine.wechat-command.mixin.ts:78）用 `getMacWechatCommandRoot()` 解析——macOS 专用目录。Windows 上返回空 → 回退 `~/.local/bin`、homebrew → 找不到 → spawn 字面量 `wechat-live-auto-reply` → **必然失败**。

### 3. 发送链路（sendWechatReply）在 Windows 上双路径都断
`backend/src/modules/auto-upload/auto-upload.client.ts:3789`：
- 高级路径：`canRunAdvancedWechatScript()` 需要 `vendor/open-cowork-upstream/scripts/` 下的 4 个 mjs + pyautogui —— **Windows 包内没有 open-cowork-upstream**（mac 包有，是手工放的，不在 extraResources）
- 回退路径：`executeWechatDesktopCommand('wechat-auto-reply')` → `resolveWechatCommandPaths`（:963）只查 `KAYPAL_WECHAT_COMMAND_ROOT`（main.js 只 darwin 注入）+ mac 目录 + homebrew —— **Windows 无任何候选**

## 二、macOS 侧核实（对照矩阵）

macOS 命令全集（runtime/wechat-macos/bin/ 9 个）：
cliclick / kaypal-pointer.jxa / wechat-auto-reply / wechat-chat-history / wechat-contact-add / wechat-contact-sync / wechat-live-auto-reply / wechat-moments-marketing / wechat-moments-publish

vendor/skillhub 脚本全集（7 个技能）：
wechat-auto-reply / wechat-chat-sync / wechat-contact-add / wechat-contact-sync / wechat-live-auto-reply / wechat-moments-marketing / wechat-moments-publish

**macOS 侧 8 大能力全覆盖**。auto-reply 脚本是真实 shell（260/296字节），正确转发到 skillhub 脚本。

## 三、打包资源现状（双平台）

| 资源 | macOS 包 | Windows 包 | extraResources 固化 |
|------|---------|-----------|---------------------|
| wechat-macos/bin（9工具） | ✅ | - | ✅ 已加（af079359） |
| wechat-macos/skillhub | ✅ | - | ✅ 已加 |
| wechat-native-runners（7 runner） | ✅ | ✅ | ✅ 已加 |
| wechat-db-helper（6 exe/dll） | ✅ | ✅ | ✅ |
| wechat-engine | ✅ | ✅ | ✅ |
| wechat-ocr | ✅ | ✅ | ✅ |
| **open-cowork-upstream/scripts（4 mjs）** | ✅（手工放） | ❌ | ❌ **未加** |

## 四、修复清单

**已完成（本轮）**：

1. ✅ **Windows auto-reply native runner 已实现**
   - contract：`auto-reply` 命令加入 WECHAT_NATIVE_COMMANDS + 输入/输出类型（WechatNativeAutoReplyInput/Output）+ legacy 映射（wechat-reply-draft → auto-reply）
   - runner-core：COMMANDS 加入 auto-reply + buildPlan/validatePlan/dryRunOutput 分支 + `Invoke-AutoReply` PowerShell（read-latest 读原文 / draft 写草稿 / send 发送+读回）
   - 新入口：`kaypal-wechat-auto-reply-runner.js`
   - native-runtime：SUPPORTED_COMMANDS 加 auto-reply + `validateAutoReply`
   - 验证：dry-run send/read-latest 通过，native-runtime 调度通过，tsc 通过
2. ✅ **open-cowork-upstream 打包固化**：extraResources 加条目（scripts/**/*）
3. ✅ **main.js 注入 KAYPAL_DESKTOP_SCRIPT_ROOT**（open-cowork-upstream/scripts 根，mac/win 共用）
4. ✅ **resolveWechatCommandPaths 补 Windows 候选**（resources/wechat-macos/bin + resources/open-cowork-upstream/scripts）

**验证结果**：炼刀 smoke 251 项全过，verify-oss-release local 通过，tsc 通过。

## 五、证据等级

- 本文档为 **C/D 级**（源码 + 静态合同）核对结论
- Windows auto-reply 断链为**确定性结论**（代码路径无任何 Windows 分支）
- 真机执行验证仍待 Windows 10/11 实测（A 级证据）
