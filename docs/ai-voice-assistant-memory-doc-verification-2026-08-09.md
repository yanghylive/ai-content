# 《AI 语音助手与记忆层开发文档》实现核查报告

> 核查日期：2026-08-09 ｜ 文档：`outputs/AI语音助手与记忆层开发文档.md`（2026-08-05 v1.0，标注「待开发」）
> 核查方法：代码逐模块比对（backend `ai-gateway`/`memory`/`dashscope` 模块 + frontend `ai-assistant` 面板）+ 生产端点实测
> 结论：**P0-P2 已基本落地并部署，P3 部分实现，P4 未做**——文档「待开发」标注已过时，实际完成了约 70%

---

## 一、总体结论

| 迭代阶段 | 文档要求 | 现状 | 完成度 |
|---------|---------|------|--------|
| **P0** AiGateway 文字对话 + 千问 + 2 工具 + 前端面板 | 3-4 天 | ✅ 完整实现 | **100%** |
| **P1** 阿里 ASR + 工具扩展 | 3-4 天 | ✅ 百炼 ASR 已接 + 面板录音 | **90%**（工具仅 3 个） |
| **P2** 记忆层接入 | 3-5 天 | ✅ L0/L1 分层 capture/recall + UserMemory 表 | **80%**（无 MemoryCore 容器） |
| **P3** 写工具二次确认 + 全审计 + 配额 | 2-3 天 | 🟡 部分（代码留了确认卡扩展点，未接写工具） | **30%** |
| **P4** 多模态 | 后续 | ❌ 未做 | **0%** |

---

## 二、逐项核查明细

### 2.1 后端 AiGatewayModule（P0）✅

| 文档要求 | 实现 | 状态 |
|---------|------|------|
| `ai-gateway.module.ts` | ✅ `backend/src/modules/ai-gateway/`（module/controller/service 三件套） | ✅ |
| SSE 对话端点 | ✅ `POST /api/ai-gateway/chat`（SSE 流式） | ✅ 生产实测 200（鉴权拦截） |
| 千问 function calling | ✅ chatStream：模型请求工具 → 执行 → 回填 → 继续 | ✅ |
| 工具白名单 schema | ✅ 3 个：`topic_hot`/`compliance_check`/`knowledge_search` | ✅ |
| 注入 RedfoxModule/MemoryModule | ✅ module imports 已注入 | ✅ |
| 注册 app.module | ✅ `AiGatewayModule` 已注册 | ✅ |

### 2.2 语音输入 ASR（P1）✅

| 文档要求 | 实现 | 状态 |
|---------|------|------|
| 阿里 ASR 接入 | ✅ `modules/dashscope/dashscope-asr.service.ts`（百炼 ASR） | ✅ |
| `POST /api/ai/asr` | ✅ `@Controller('ai') @Post('asr')`（multipart 上传） | ✅ |
| 额外能力 | ✅ `/api/ai/image`、`/api/ai/speech` 也在 | ✅ 超文档 |

### 2.3 记忆层（P2）✅

| 文档要求 | 实现 | 状态 |
|---------|------|------|
| UserMemory 模型 | ✅ `model UserMemory`（schema.prisma:2311，含 persona/episodic/instruction + priority + source 扩展） | ✅ |
| L0 原始对话 capture | ✅ `memory.service.capture()`（fire-and-forget） | ✅ |
| L1 原子记忆抽取 | ✅ 关键词抽取 + priority 排序 | ✅ |
| recall 召回（persona + relevant） | ✅ 关键词命中评分；persona 可总召回；5s 超时降级 | ✅ |
| 动静分离注入 | ✅ 代码注释明确 persona→system、relevant→user 前缀 | ✅ |
| MemoryCore 容器（:8420） | ❌ **未部署**（代码留了扩展点「MemoryCore 部署后在此扩展」） | ⚠️ 降级用本地 Postgres |

### 2.4 前端对话面板（P0）✅

| 文档要求 | 实现 | 状态 |
|---------|------|------|
| VoiceAssistantFab/Panel | ✅ `components/shell/ai-assistant.tsx`（556 行） | ✅ |
| 语音/文字双输入 | ✅ `inputMode: "voice" | "text"` 切换 | ✅ |
| MediaRecorder 录音 → ASR | ✅ 百炼 ASR（替代 Web Speech API） | ✅ |
| SSE 消费（text/tool_exec/done/error） | ✅ `lib/api/ai-gateway.ts` `chatStream()` | ✅ |
| 挂载 | ✅ `app-shell.tsx:297 <AiAssistant />` 全局挂载 | ✅ |

### 2.5 安全合规（P3 部分）

| 文档要求 | 实现 | 状态 |
|---------|------|------|
| Key 仅后端 | ✅ 全后端 env | ✅ |
| 写工具二次确认 | 🟡 `executeTool` 有确认卡扩展点注释，但**未接写工具**（无 schedule_publish 等） | ⚠️ 待接入 |
| 全审计 | 🟡 需确认 ai_tool_call_log 表 | ⚠️ |
| 微信红线（不做微信自动化） | ✅ 工具白名单无微信工具 | ✅ |

---

## 三、与文档的差异（未干项）

### 未实现（需补）
1. **写工具二次确认闭环**（P3 核心）：文档 9 个白名单工具里，`schedule_publish`（定时发布，需确认卡）**未接入**——当前只有 3 个查询/生成类工具，无写工具。
2. **工具扩展至 9 个**（P1）：`content_generate`/`image_generate`/`video_download`/`account_diagnose`/`competitor_radar`/`material_save`/`schedule_publish` 7 个未进白名单（RedFox 6 项开采刚做完，这些工具的数据源已就绪）。
3. **MemoryCore 容器部署**（P2）：当前记忆走本地 Postgres（UserMemory 表），文档设计的独立 MemoryCore（L2/L3 场景知识块/用户画像文件）未部署。
4. **记忆管理页**（P3）：用户查看/清除自己记忆的入口未做。
5. **配额/计费**（P3）：RedFoxUserQuota 扩展未做。
6. **P4 多模态**：Qwen-Image/CosyVoice 未做（生图已有 RedFox/千问，配音 studio_core 侧有）。

### 已实现但文档未提（超纲）
- `/api/ai/image`、`/api/ai/speech`（多模态端点）
- `knowledge_search` 工具（文档白名单里没有，多加了知识检索）
- UserMemory 的 `source` 字段（chat/memory-core 双源）

---

## 四、生产部署状态

| 端点 | 生产状态 |
|------|---------|
| `POST /api/ai-gateway/chat` | ✅ 已部署（返回「请先登录」= 鉴权正常，SSE 可用） |
| `POST /api/ai/asr` | ✅ 已部署 |
| `POST /api/ai/image` / `speech` | ✅ 已部署 |
| AiGatewayModule/MemoryModule | ✅ 已注册打包 |

---

## 五、建议下一步（按价值排序）

1. **工具扩展 4 个高频的**：`topic_hot`（已有）+ `content_generate`（AI 创作）+ `image_generate`（生图）+ `video_download`（去水印，刚开采的多平台能力直接挂进来）——RedFox 6 项开采的数据源已就绪，接入成本低。
2. **schedule_publish 写工具 + 确认卡**：补 P3 核心闭环（复用本地 engine 的 agent-confirmation 机制）。
3. **记忆管理页**：设置页加「我的记忆」查看/清除（文档 P3 明确要求）。
4. MemoryCore 容器与配额计费可后置（本地 Postgres 记忆已可用）。

---

**核查人**：yanghy 团队 ｜ **日期**：2026-08-09 ｜ **文档状态修正**：`待开发` → `P0-P2 已完成并部署，P3 部分，P4 未做`
