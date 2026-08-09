# 微信通讯录同步 v1.1.64 验证指引

> 目的：验证微信 4.x 通讯录同步修复是否生效。本版本修复了 helper 通道契约缺失（`--contract`）、打包后微信原生资源路径注入、OCR 兜底链路断裂三处问题。

## 一、安装

1. 卸载旧版本（如有）
2. 安装 `JIUZHANG AI 内容创作平台 Setup 1.1.64.exe`
3. 启动应用，确认版本号显示 **v1.1.64**

## 二、前置条件

- Windows x64（微信 4.x 需 x64 环境）
- 电脑微信 4.x **已登录**，且**主窗口可见**（不要最小化到托盘）
- 微信主窗口切换到 **通讯录** 页（方便 OCR 兜底识别）

## 三、测试步骤

1. 打开「本地引擎 / 微信」→ 微信通讯录
2. 点击「同步通讯录」（或重新同步）
3. 等待执行完成（全量同步可能较慢，等 30~60 秒）

## 四、预期结果

| 场景 | 预期 |
|------|------|
| DB 可解密（微信正常登录） | 读到联系人，列表显示昵称/备注 |
| DB 加密/锁库 | 自动截图微信窗口 → OCR 识别 → 读到联系人（source 标记 `wechat-ocr-fallback`） |
| 全部通道失败 | 明确错误提示 + 可导出排查资料 |

## 五、如果仍失败：导出排查资料

页面点「导出排查资料」→ 生成文件发回。**关键看这几个字段**：

```
dbHelper          → 应为实际路径（如 C:\...\resources\wechat-db-helper\wechat-db-helper.js）
                   若为空 / "helper not configured" → helper 通道没起来，需反馈
screenshotPath    → 失败时应有截图路径（OCR 兜底素材）
dbStatus          → encrypted-or-locked / db-not-found / ok
blockedReasons    → 具体阻塞原因列表
ocrContactCount   → OCR 识别到的联系人数量（>0 说明 OCR 兜底生效）
ocrPreview        → OCR 识别出的文本预览（判断截图内容是否为通讯录）
```

## 六、反馈格式

请按以下格式反馈（从排查资料里抄字段即可）：

```
版本：v1.1.64
dbHelper：<值>
screenshotPath：<值>
dbStatus：<值>
blockedReasons：<值>
错误提示原文：<值>
```

> 排查资料包含完整诊断信息，导出后直接发回即可，无需手工整理。
