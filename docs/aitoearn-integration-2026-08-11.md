# AiToEarn 接入说明（2026-08-11）

> 结论：**模型中转 = 零代码接入**（我们的 AI 平台管理原生支持 OpenAI 兼容端点）。
> 发布通道（海外平台）需走它的开放平台 API / relay，见 §2。

## 0. 前置：获取 API Key

1. 打开 https://aitoearn.cn → 左下角头像 → 设置
2. 左侧选 **API key** → 创建 → 复制保存
3. 注意：**中国版 Key 配 `https://aitoearn.cn/api`，国际版 Key 配 `https://aitoearn.ai/api`**，不匹配会 401
4. Key 存服务端，不要进前端代码

## 1. 模型中转接入（零代码，5 分钟）

我们的 `AiClientService.getClient()` 用 OpenAI SDK 对接任意 baseUrl，所以只需加一条 AI 平台记录：

```bash
# 管理员调用（或直接在「AI 模型设置」页面添加）
curl -X POST http://127.0.0.1:3011/api/ai-platforms \
  -H "Content-Type: application/json" \
  -H "Cookie: <管理员会话>" \
  -d '{
    "name": "AiToEarn",
    "baseUrl": "https://aitoearn.cn/api/ai",
    "apiKey": "<你的 AiToEarn key>",
    "enabled": true
  }'
```

然后加模型（模型 ID 从 `GET /api/ai/models/chat` 拉，例如 Gemini/Claude/DeepSeek/GPT 各系）：

```bash
curl -X POST http://127.0.0.1:3011/api/ai-models \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gemini 2.x",
    "modelId": "<aitoearn 返回的模型名>",
    "platformId": "<上一步返回的平台 id>",
    "enabled": true
  }'
```

加完在 AI 设置页「连接测试」，通了即可在 ai-gateway 全链路使用。

**好处**：不用自己对接各家 SDK；AiToEarn 中转统一了 Gemini/Claude/DeepSeek/GPT；
视频生成 Seedance（官方价 70%）、图像 GPT-image-2（官方价 5%）走它开放平台 API（异步 taskId 轮询）。

## 2. 发布通道接入（海外平台，后续做）

我们现状：9 个平台全是国内，海外零；发布是本地浏览器自动化（无资质能发，脆弱）。
AiToEarn 覆盖 8 个海外平台（TikTok/YouTube/IG/FB/X/Pinterest/LinkedIn/Threads），两条路：

- **A. 开放平台 API 直连**：创建 Flow 一次发多平台，需账号授权绑 AiToEarn（账号托管第三方，注意合规）
- **B. 自部署它的开源 + Relay**：Docker 一键部署，发布本地执行；授权借官方 relay 凭据（绕开资质），
  但账号授权、发布内容过官方中转

建议：海外平台先走 A 试水（它开放平台 Demo 可直接跑），国内保持我们本地自动化（账号在自己手里）。

## 3. 待办清单

- [ ] 大王注册 aitoearn.cn 并创建 API key
- [ ] 加 AiToEarn AI 平台 + 模型（§1，零代码）
- [ ] 需要时评估海外发布（§2）
