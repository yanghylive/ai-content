# AI内容创作桌面应用

基于 Electron 的桌面应用，自动回复抖音、视频号评论和私信。

## 安装

### macOS

1. 下载 `AI内容创作-1.0.0.dmg`
2. 双击打开 DMG 文件
3. 将「AI内容创作」拖到「应用程序」文件夹
4. 首次打开时，右键点击应用 → 打开（绕过 Gatekeeper）
5. 应用会自动安装 Python 依赖并启动

### Windows

1. 下载 `AI内容创作 Setup 1.0.0.exe`
2. 双击运行安装程序
3. 选择安装目录（默认 `C:\Users\你的用户名\AppData\Local\AI内容创作`）
4. 勾选「创建桌面快捷方式」和「创建开始菜单快捷方式」
5. 点击「安装」，等待完成
6. 勾选「立即运行」，点击「完成」

### Linux

**AppImage（推荐）：**
```bash
chmod +x AI内容创作-1.0.0.AppImage
./AI内容创作-1.0.0.AppImage
```

**Debian/Ubuntu：**
```bash
sudo dpkg -i ai-content-desktop_1.0.0_amd64.deb
sudo apt-get install -f  # 修复依赖
```

## 卸载

### macOS

1. 打开「应用程序」文件夹
2. 右键点击「AI内容创作」→ 移到废纸篓
3. 清空废纸篓
4. （可选）删除用户数据：
```bash
rm -rf ~/Library/Application\ Support/AI内容创作
rm -rf ~/Library/Caches/AI内容创作
rm -rf ~/Library/Preferences/com.aicontent.desktop.plist
```

### Windows

**方法 1：通过控制面板**
1. 打开「设置」→「应用」→「已安装的应用」
2. 找到「AI内容创作」，点击「卸载」
3. 选择是否删除用户数据：
   - **是**：删除所有本地数据（账号、配置、浏览器 profile）
   - **否**：保留数据，重新安装后可恢复

**方法 2：通过卸载程序**
1. 打开安装目录（默认 `C:\Users\你的用户名\AppData\Local\AI内容创作`）
2. 双击 `Uninstall AI内容创作.exe`
3. 按提示操作

### Linux

**AppImage：**
```bash
rm AI内容创作-1.0.0.AppImage
rm -rf ~/.config/AI内容创作
rm -rf ~/.local/share/AI内容创作
```

**Debian/Ubuntu：**
```bash
sudo apt-get remove ai-content-desktop
# 删除用户数据（可选）
rm -rf ~/.config/AI内容创作
rm -rf ~/.local/share/AI内容创作
```

## 更新

当前仓库默认不内置自动更新地址。未配置真实 HTTPS 更新 feed 时，应用会禁用自动检查；用户手动检查更新时会看到“自动更新未配置”，不会访问占位服务器。

### 自动更新（推荐）

只有配置真实可用的更新地址后，应用启动才会自动检查更新（每 2 小时一次）：

1. 发现新版本时，弹窗提示「发现新版本 vX.X.X」
2. 点击「立即下载」开始下载
3. 下载完成后，弹窗提示「更新已就绪」
4. 点击「立即重启」安装更新

**更新选项：**
- **立即下载**：开始下载更新
- **稍后提醒**：下次启动时再提醒
- **跳过此版本**：不再提醒此版本（下个版本仍会提醒）

### 手动检查更新

1. 点击应用右上角「设置」图标
2. 点击「检查更新」
3. 如果有新版本，按提示操作

### 手动下载安装

如果自动更新失败，可以手动下载：

1. 访问官网下载页
2. 下载对应平台的安装包
3. 运行安装包，会自动覆盖旧版本
4. 用户数据会保留（除非选择删除）

## 更新服务器配置

以下内容是服务端部署示例，请把域名替换成自己的真实 HTTPS 域名。不要把示例占位地址写入商用包。

### 服务器要求

- HTTPS 支持（必须）
- 静态文件托管
- 带宽：建议 10Mbps+

### 目录结构

```
https://updates.example.com/updates/
├── latest.yml              # Windows 更新信息
├── latest-mac.yml          # macOS 更新信息
├── latest-linux.yml        # Linux 更新信息
├── AI内容创作 Setup 1.0.1.exe
├── AI内容创作 Setup 1.0.1.exe.blockmap
├── AI内容创作-1.0.1.dmg
├── AI内容创作-1.0.1.dmg.blockmap
├── AI内容创作-1.0.1.zip
├── AI内容创作-1.0.1-mac.zip
├── AI内容创作-1.0.1.AppImage
└── ai-content-desktop_1.0.1_amd64.deb
```

### 发布流程

1. 修改 `package.json` 中的 `version`
2. 运行构建命令：
```bash
AI_CONTENT_UPDATE_URL=https://updates.example.com/updates/ npm run release
```

这会自动：
- 构建所有平台的安装包
- 生成 `.yml` 更新信息文件
- 使用 `AI_CONTENT_UPDATE_URL` 写入真实更新 feed

### Nginx 配置示例

```nginx
server {
    listen 443 ssl;
    server_name updates.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /updates/ {
        alias /var/www/updates/;
        autoindex on;
        
        # 缓存策略
        location ~* \.(exe|dmg|zip|AppImage|deb)$ {
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
        
        location ~* \.yml$ {
            expires 5m;
            add_header Cache-Control "public, must-revalidate";
        }
    }
}
```

### 版本管理

**语义化版本（SemVer）：**
- `1.0.0` → `1.0.1`：修复 bug
- `1.0.0` → `1.1.0`：新增功能
- `1.0.0` → `2.0.0`：破坏性更新

**更新策略：**
- 小版本更新（1.0.0 → 1.0.1）：自动下载，用户选择安装时间
- 大版本更新（1.0.0 → 2.0.0）：弹窗提示，用户手动确认

### 回滚

如果新版本有严重问题：

1. 从更新服务器删除新版本文件
2. 修改 `latest.yml` 指向旧版本
3. 用户重启应用后会自动回退

或者：

1. 发布修复版本（如 1.0.2）
2. 正常发布流程

## 架构

```
┌─────────────────────────────────────┐
│  Electron 桌面应用（用户电脑）        │
│  ┌───────────────────────────────┐  │
│  │  前端 UI (Next.js)            │  │
│  │  - 用户界面                    │  │
│  │  - 调用云端 API               │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Python 服务 (auto-upload)    │  │
│  │  - 浏览器控制 (CDP)           │  │
│  │  - 账号登录                   │  │
│  │  - 截图、DOM 读取             │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              │
              │ HTTPS API
              ▼
┌─────────────────────────────────────┐
│  云端服务器（你的服务器）             │
│  - AI 回复生成                      │
│  - 内容过滤                         │
│  - 去重逻辑                         │
│  - 用户管理                         │
│  - 使用统计                         │
└─────────────────────────────────────┘
```

## 开发环境

### 1. 安装依赖

```bash
cd desktop
npm install
```

### 2. 准备前端

```bash
cd ../frontend
npm install
npm run build
# 生成 out/ 目录（静态导出）
```

### 3. 准备 Python 服务

```bash
cd ../auto-upload
python3.12 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

桌面打包只允许使用仓库内的 `auto-upload/` 目录。当前仓库没有该目录时，`npm run build` 会明确失败；不能再从开发者机器外部路径打包，避免商用包在新机器上假成功。

### 4. 启动开发环境

```bash
cd desktop
npm run dev
```

这会：
- 启动 Electron 窗口
- 加载前端（http://localhost:3010）
- 启动 Python 服务（端口 5409）

## 构建应用

### macOS

```bash
npm run build:mac
```

生成：
- `dist/AI内容创作-1.0.0.dmg` - 安装包
- `dist/AI内容创作-1.0.0.zip` - 便携版

### Windows

```bash
npm run build:win
```

生成：
- `dist/AI内容创作 Setup 1.0.0.exe` - 安装程序
- `dist/AI内容创作 1.0.0.exe` - 便携版

### Linux

```bash
npm run build:linux
```

生成：
- `dist/AI内容创作-1.0.0.AppImage` - 通用包
- `dist/ai-content-desktop_1.0.0_amd64.deb` - Debian 包

## 云端服务器

你需要部署一个云端服务器提供以下 API：

### API 接口

#### 1. 用户认证

```
POST /api/v1/auth/login
Body: { username, password }
Response: { token, user }

POST /api/v1/auth/register
Body: { username, password, email }
Response: { token, user }

GET /api/v1/auth/me
Headers: Authorization: Bearer <token>
Response: { user }
```

#### 2. AI 生成回复

```
POST /api/v1/generate-reply
Headers: Authorization: Bearer <token>
Body: {
  platform: "douyin" | "wechat-channel",
  scene: "comment" | "direct_message",
  customerMessage: "客户消息内容",
  recentContext: ["历史消息1", "历史消息2"],
  businessProfile: "商家简介"
}
Response: {
  reply: "AI生成的回复",
  shouldSend: true,
  confidence: 0.95,
  reason: "回复质量高，可以发送"
}
```

#### 3. 内容检查

```
POST /api/v1/check-content
Headers: Authorization: Bearer <token>
Body: {
  replyText: "回复内容",
  platform: "douyin"
}
Response: {
  canSend: true,
  blockedReason: null
}
```

#### 4. 去重检查

```
POST /api/v1/check-dedup
Headers: Authorization: Bearer <token>
Body: {
  accountId: "账号ID",
  targetText: "目标评论/消息",
  kind: "comment" | "message"
}
Response: {
  isDuplicate: false
}
```

#### 5. 标记已发送

```
POST /api/v1/mark-sent
Headers: Authorization: Bearer <token>
Body: {
  accountId: "账号ID",
  targetText: "目标评论/消息",
  replyText: "回复内容",
  kind: "comment" | "message"
}
Response: {
  ok: true
}
```

#### 6. 使用统计

```
GET /api/v1/usage/stats
Headers: Authorization: Bearer <token>
Response: {
  totalReplies: 1234,
  todayReplies: 56,
  successRate: 0.95
}
```

#### 7. 订阅信息

```
GET /api/v1/subscription
Headers: Authorization: Bearer <token>
Response: {
  plan: "pro",
  expiresAt: "2025-12-31T23:59:59Z",
  features: ["unlimited_replies", "priority_support"]
}
```

### 云端技术栈建议

- **框架**: Node.js (Express/Fastify) 或 Python (FastAPI)
- **数据库**: 桌面本地默认 SQLite；服务端部署可选 PostgreSQL
- **缓存**: Redis 可选，需要记忆/缓存能力时启用
- **AI 模型**: 通义千问 API / OpenAI API
- **部署**: 阿里云/腾讯云 2核4G 服务器

## 分发

### 1. 代码签名（推荐）

**macOS:**
```bash
# 申请 Apple Developer 证书
# 在 package.json 中配置
"mac": {
  "identity": "Developer ID Application: Your Name (TEAM_ID)"
}
```

**Windows:**
```bash
# 购买代码签名证书
# 配置环境变量
CSC_LINK=path/to/certificate.pfx
CSC_KEY_PASSWORD=your_password
```

### 2. 自动更新

发布商用包前必须设置真实 HTTPS 更新 feed：

```bash
AI_CONTENT_UPDATE_URL=https://updates.example.com/updates/ npm run release
```

普通 `npm run build` 不写入更新 feed；没有 `AI_CONTENT_UPDATE_URL` 或 `app-update.yml` 时，应用会禁用自动更新并提示未配置。

### 3. 分发渠道

- 官网下载页
- 微信公众号
- 技术社区
- 付费用户邮件推送

## 商业模式

### 订阅制

| 套餐 | 价格 | 功能 |
|------|------|------|
| 免费版 | 0 | 每天 10 条回复 |
| 专业版 | 99元/月 | 无限回复 + 优先支持 |
| 企业版 | 299元/月 | 多账号 + API 接入 |

### 成本估算

- 云服务器：100元/月
- AI API：0.01元/条回复
- 假设 100 个付费用户，每人每月 1000 条回复
- 收入：100 × 99 = 9900元/月
- 成本：100 + 100×1000×0.01 = 1100元/月
- 利润：8800元/月

## 安全

### 代码保护

1. **代码混淆**: 前端和 Python 代码都已混淆
2. **核心上云**: AI 逻辑在云端，本地只是壳
3. **HTTPS**: 所有 API 调用都加密
4. **Token 认证**: 每个用户有独立 token

### 防破解

- 破解者拿到本地代码也无法使用，必须连云端
- 云端可以检测异常使用并封禁账号
- 可以随时停止某个用户的服务

## 故障排查

### Python 服务启动失败

```bash
# 检查 Python 版本
python3.12 --version

# 检查虚拟环境
ls auto-upload/.venv/bin/python

# 手动启动测试
cd auto-upload
.venv/bin/python main.py
```

### 前端加载失败

```bash
# 检查前端是否构建
ls frontend/out/index.html

# 重新构建
cd frontend
npm run build
```

### 云端 API 连接失败

```bash
# 检查网络
curl https://api.example.com/health

# 检查 token
# 在应用中重新登录获取新 token
```

### 自动更新失败

**检查更新服务器：**
```bash
curl https://updates.example.com/updates/latest.yml
```

**检查本地缓存：**
```bash
# macOS
ls ~/Library/Caches/AI内容创作/updater

# Windows
ls %LOCALAPPDATA%\AI内容创作\updater

# Linux
ls ~/.cache/AI内容创作/updater
```

**手动清理缓存：**
```bash
# macOS
rm -rf ~/Library/Caches/AI内容创作/updater

# Windows
rmdir /s %LOCALAPPDATA%\AI内容创作\updater

# Linux
rm -rf ~/.cache/AI内容创作/updater
```

## 更新日志

### v1.0.0 (2025-01-01)

- 初始版本
- 支持抖音评论/私信自动回复
- 支持视频号评论/私信自动回复
- 云端 AI 生成回复
- 自动更新

## 许可证

当前仓库不附带开源许可证。商业使用、对外分发和客户交付的授权条款由版权所有者另行确定。
