# JIUZHANG AI Mobile（WebView 壳，P5 C 组 S1）

Android 壳 App：WebView 加载 H5 前端（aicontent.vip.kaypal.cn）+ 内嵌发布执行器（agent）。

## 状态（2026-08-07，S1 骨架）

- ✅ MainActivity：WebView 壳（H5 全功能：选题/创作/体检/日历/素材/对话/多模态）
- ✅ AgentService 骨架：前台服务 + 设备注册 + 心跳循环（对接 C3 `/api/mobile-executor/*`）
- ✅ RpaAccessibilityService 注册（无障碍 RPA，S3 激活）
- ✅ JsBridge（H5 ↔ 壳：语音上传 ASR 占位，S5 实现）
- ⏳ S2：任务轮询/回传（登录态注入后接）
- ⏳ S3-S4：RpaEngine + 平台发布流程
- ⏳ S5：确认卡 + 失败截图回传 + 频率限制

## 环境要求（本机无 Android 开发环境，需安装）

1. **Android Studio**（或 JDK 17 + Android SDK 35）
2. Android SDK：`compileSdk 35`（`sdkmanager "platforms;android-35" "build-tools;35.0.0"`）

## 构建（安装 Android Studio 后）

```bash
cd mobile
# Android Studio 打开本目录 → Build APK
# 或命令行（Android Studio 自带 JDK）：
./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

## 说明

- 登录态：H5 自带会话管理（WebView cookie），壳不干预
- agent 鉴权：S5 从 WebView cookie 提取会话注入 agent HTTP（C3 API 同源）
- 无障碍权限：用户设置中手动开启（仅本人已登录账号发布，不做截流/获客）
- 微信红线：不做微信生态自动化
