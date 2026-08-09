# kaypal.cn 语音网关自检与部署

语音助手（ASR 识别 / TTS 合成）已改为**全走 kaypal.cn 云端 AI 网关**（OpenAI 兼容接口，云端已接入阿里百炼）。本地不持有任何云厂商 Key，识别/合成成本由云端按用户归属统一计费。

## 架构

```
浏览器录音 → 3011 后端 → kaypal.cn 网关（KAYPAL_AI_PROXY_BASE_URL，默认 {KAYPAL_AUTH_BASE_URL}/api/ai）
                              ├─ POST /v1/audio/transcriptions  → 识别文本（ASR）
                              ├─ POST /v1/audio/speech          → 音频流（TTS）
                              ├─ 请求头：x-kaypal-api-key（服务商 Key）
                              └─ 请求头：x-kaypal-user-id（用户归属，云端计费）
```

## 部署配置（env）

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `KAYPAL_AUTH_BASE_URL` | `https://test.kaypal.cn` | kaypal 云基址 |
| `KAYPAL_AI_PROXY_BASE_URL` | `{KAYPAL_AUTH_BASE_URL}/api/ai` | 语音/模型网关地址 |
| `KAYPAL_AI_PROXY_API_KEY` / `KAYPAL_API_KEY` | 无 | 服务商 Key（网关鉴权） |
| `KAYPAL_VOICE_ASR_MODEL` | `qwen-audio-3.0-asr-flash` | 识别模型（百炼，已实测可用） |
| `KAYPAL_VOICE_TTS_MODEL` | `qwen3-tts-instruct-flash` | 合成模型（百炼，已实测可用） |
| `KAYPAL_VOICE_TTS_VOICE` | `Cherry` | 音色 ID |
| `KAYPAL_VOICE_ASR_TIMEOUT_MS` | `30000` | 识别超时 |
| `KAYPAL_VOICE_TTS_TIMEOUT_MS` | `30000` | 合成超时 |

## 连通性自检

```bash
# 在项目根目录（会读 backend/.env 或当前 shell 环境）
node scripts/verify-kaypal-voice-gateway.mjs

# JSON 输出（供脚本/流水线解析）
node scripts/verify-kaypal-voice-gateway.mjs --json
```

检查项与退出码：

| 退出码 | 含义 |
|-------|------|
| 0 | 全部通过（网关可达 + 鉴权通过 + 检测到语音模型） |
| 1 | 配置缺失 / 鉴权失败（Key 失效、无权访问） |
| 2 | 网关不可达 / TTS 端点 404（网关未实现 /v1/audio/*） |
| 3 | 通过但未检测到语音相关模型（网关未暴露语音模型，需确认映射） |

模型名不对时，用 env 覆盖后重跑：

```bash
KAYPAL_VOICE_ASR_MODEL=<云端模型名> KAYPAL_VOICE_TTS_MODEL=<云端模型名> \
  node scripts/verify-kaypal-voice-gateway.mjs
```

## 常见问题

- **HTTP 401**：`KAYPAL_AI_PROXY_API_KEY` 失效或该 Key 无语音服务权限 → 换有效 Key 后重跑。
- **HTTP 404**：网关未实现 `/v1/audio/speech` 或 `/v1/audio/transcriptions` → 需云端侧开通/升级。
- **模型未检测到**（exit=3）：`/v1/models` 列表里没有语音关键词 → 向云端确认实际暴露的模型名，用 env 覆盖。
- **前端语音控制台显示"未配置"**：`GET /api/voice/asr/capabilities` 返回 `configured:false` → 服务端 Key 未配，检查上述 env。

## 完整闭环验证（真机）

1. 自检脚本全绿（exit=0）
2. 3011 后端运行（带上述 env）
3. 打开侧边栏「语音助手」→ 语音设置显示"已配置"
4. 点麦克风说一句话 → 自动识别并执行 → 开启"朗读"后回复语音播报
5. 到 kaypal.cn 后台核对：该用户的 voice_recognition / voice_tts 计费流水

## 2026-08-09 实测验证结论（已完成云端部署）

**kaypal.cn 网关 audio 端点已在 test 环境部署并通过真实闭环验证：**

| 端点 | 实测结果 |
|------|---------|
| `POST /api/ai/v1/audio/speech`（TTS） | ✅ HTTP 200 → 122KB WAV（qwen3-tts-instruct-flash） |
| `POST /api/ai/v1/audio/transcriptions`（ASR） | ✅ 识别出"你好，这是语音合成测试。"（qwen-audio-3.0-asr-flash） |

**关键技术结论（踩坑记录）：**
- 百炼 **compatible-mode 不暴露 /v1/audio/\***（404）——必须用**原生 multimodal-generation**：
  - TTS：`POST /api/v1/services/aigc/multimodal-generation/generation`，`{model, input:{text}, parameters:{voice}}` → `output.audio.url`
  - ASR：同端点，`{model, input.messages[].content:[{audio:"data:<fmt>;base64,..."},{text:"请转写"}], parameters:{format}}` → `output.text`
- 云端网关鉴权：`x-kaypal-api-key`（比对 KAYPAL_API_KEY）+ `x-kaypal-user-id`（计费归属，必填）
- **路由必须在 routes-config.ts 注册**（`auth:'optional'`）——否则被 defaultRoute `auth:'required'` 拦成 401
- 云端部署：git archive → SSH → /tmp/build → docker compose build/up（需补 8 个非部署服务占位 env）

**本地联调 Key**：backend/.env 的 `KAYPAL_API_KEY` 需用云端 test 环境的有效 key（旧 geo_ 开头 key 已失效）。
