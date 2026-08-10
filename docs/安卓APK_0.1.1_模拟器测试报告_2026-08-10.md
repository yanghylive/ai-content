# 安卓 APK 0.1.1 模拟器完整测试报告

> 日期：2026-08-10 · 执行：吴八哥（高级开发工程师）
> 提交：`b5f469c` · 分支：codex/content-workspace-20260721

---

## 1. 测试环境

| 项目 | 值 |
|---|---|
| APK | `mobile/app/build/outputs/apk/debug/app-debug.apk`（v0.1.1，versionCode 2） |
| 构建方式 | Gradle 8.14.3（本机缓存）+ JDK 17 + Android SDK 35 |
| 模拟器 | `jztest34`（emulator-5554，android-34 / arm64 / 1.5G） |
| 应用包名 | `com.aicontent.desktop.mobile` |
| WebView 入口 | debug 版 → `http://10.0.2.2:3421/today`（本机最新前端 + /api 反代 3011 后端） |
| 测试方式 | WebView CDP 远程调试（debug 构建开启 `setWebContentsDebuggingEnabled`） |
| 测试账号 | 测试运营账号（operator，__REDACTED_TEST_USER__ 会话） |

**说明**：debug 包指向本机联调（10.0.2.2 = 模拟器访问宿主机），release 包仍指向线上 `aicontent.vip.kaypal.cn`。本次测的是**本机最新前端**（含聚推客生活服务、移动端主题切换、默认浅色），线上尚未部署这些功能。

## 2. 测试结果：12/12 全部通过 ✅

| # | 测试项 | 结果 | 详情 |
|---|---|---|---|
| 1 | 登录态访问 /today | ✅ | 注入会话 cookie 后无重定向，直达 dashboard |
| 2 | today 页渲染 | ✅ | 「JIUZHANG AI 凌晨好，测试运营账号 / 8月10日 周一 / 今日待办 / 开始创作」 |
| 3 | Tab 导航 → 内容 | ✅ | URL 跳转 `/content` |
| 4 | Tab 导航 → 消息 | ✅ | URL 跳转 `/message` |
| 5 | Tab 导航 → 我的 | ✅ | URL 跳转 `/mine` |
| 6 | mine 页外观开关 | ✅ | 「外观」行 + 深色徽标可见 |
| 7 | 主题切换 | ✅ | 点击后 html class `light → dark`（浅色/深色双向） |
| 8 | savings 页渲染 | ✅ | 「省钱返利」页面正常 |
| 9 | 生活服务分类 | ✅ | 分类导航「🎫 生活服务」可点击 |
| 10 | 生活服务场景渲染 | ✅ | 外卖 / 连锁餐饮 / 出行 / 生活充值 全渲染 |
| 11 | 生活服务活动可见 | ✅ | 饿了么天天领红包、瑞幸咖啡等卡片在列 |
| 12 | 生活服务转链 | ✅ | 点卡片触发转链，toast「正在打开」 |

## 3. 关键截图

| 截图 | 内容 |
|---|---|
| `/tmp/mt-1-today.png` | today 首页（登录态） |
| `/tmp/mt-2-content.png` | 内容页 |
| `/tmp/mt-3-message.png` | 消息页 |
| `/tmp/mt-4-mine.png` | 我的页（含外观开关） |
| `/tmp/mt-5-theme-light.png` | 浅色主题（切换后） |
| `/tmp/mt-6-life-services.png` | 聚推客生活服务场景网格 |
| `/tmp/mt-today-final.png` | today 页最终确认 |

## 4. 验证的功能链路

- **登录**：WebView 会话 cookie 注入 → 鉴权通过（桌面/移动共用后端会话机制）
- **导航**：底部 5 Tab（今天/内容/发布/消息/我的）URL 驱动正常
- **主题**：移动端外观开关 → next-themes 切换 class + data-theme 联动 → 浅/深色环境光、卡片、TabBar 全切换
- **聚推客生活服务**：分类入口 → 场景分组（外卖/连锁餐饮/出行/到店周边/娱乐/生活充值）→ 活动卡片（icon + 卖点 badge）→ 转链调用成功
- **后端反代**：模拟器 WebView 经 3421 静态服务 → /api 反代 → 3011 后端，全链路同源无 CORS

## 5. 遗留事项

1. **线上未部署最新前端**：aicontent.vip.kaypal.cn 仍是旧版（无生活服务/主题功能）。需要部署最新前端后，正式 release APK（指向线上）才能展示新功能。
2. **正式包构建**：release 构建无签名配置，出正式包需补 keystore + signingConfig。
3. **多账号矩阵「8 失败」未修**（既有已知问题）：`/auto-upload/accounts?validate=1` 强制 validate 导致 sessionStatus 全 error，与 /health 矛盾。

## 6. 复现/继续方法

```bash
# 构建 debug 包（本机联调版）
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:/Users/yanghy/Library/Android/sdk/platform-tools:$PATH"
cd mobile && ~/.gradle/wrapper/dists/gradle-8.14.3-all/*/gradle-8.14.3/bin/gradle assembleDebug --no-daemon

# 安装并启动
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.aicontent.desktop.mobile/com.aicontent.mobile.MainActivity

# CDP 联调（debug 包已开远程调试）
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.aicontent.desktop.mobile)
# 然后访问 http://127.0.0.1:9222/json 或脚本连 CDP
```
