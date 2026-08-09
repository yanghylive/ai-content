## 当前目标

把桌面端版本推进到 `1.1.32`，优先修复微信通讯录同步稳定性和智能选题授权降级，并把 Windows 安装包上传 OSS。

## 已完成

- 版本已更新到 `1.1.32`：`desktop/package.json`、`desktop/packager.json`、前端左下角版本常量、release notes、`desktop/dist/latest.yml`。
- 已构建 Windows 安装包：`/Users/yanghy/Documents/New project/ai-content/desktop/dist/KaypalAI内容创作平台 Setup 1.1.32.exe`。
- 已上传 OSS：`https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml` 指向 `1.1.32`。
- 微信通讯录 native runtime 升到 `0.3.2`：增加微信置前、通讯录入口自动点击、全量同步前回到顶部、诊断字段回传。
- 后端诊断类型补齐：保存 `uiaContactNavigationAction`、`uiaContactNavigationTarget`、`uiaScrollResetAttempts`。
- 智能选题补齐授权错误识别：服务端 billing/AI proxy/key 未放行时走本地规则降级，不直接报错给用户。

## 当前状态

- 已通过：`backend` 微信通讯录单测、topic mining 单测、`backend npx tsc --noEmit`、`frontend npx tsc --noEmit`、native runtime `node --check`。
- 已通过：`scripts/liandao-wechat-smoke.mjs` 静态冒烟，247 项通过。
- 已通过：本地安装包构建检查、OSS 远端 `latest.yml` 反拉、安装包 HEAD 200 和大小校验。
- 未通过商业发布门禁：缺 Windows 真机随机/全量通讯录同步证据、平台账号二维码绑定证据、增长获客实发/回读证据。
- 当前截图里的 `1.1.31` 是用户还在旧包或旧前端缓存；OSS 现在已经发出 `1.1.32`。

## 下一步

1. 在 Windows 10/11 真机或本机 Windows 模拟器安装 `1.1.32`，跑随机同步和全部好友同步。
2. 若仍只识别 1 个联系人，优先看 `desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js` 的 UIA 导航和滚动诊断。
3. 跑 `node scripts/wechat-windows-contacts-acceptance.mjs` 生成真机证据，再重跑 `node desktop/scripts/windows-commercial-release-gate.js --commercial-release`。

## 不能丢的约束

- 不能再说“已商用验收”除非 Windows 真机证据补齐并过门禁。
- 普通用户页面不能暴露商业 readiness/内部诊断导航。
- OSS 已上传修复包，但这次是修复包发布，不是完整商业门禁通过发布。
