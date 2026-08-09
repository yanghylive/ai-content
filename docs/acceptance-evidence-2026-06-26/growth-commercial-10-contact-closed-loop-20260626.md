# 自动获客商用闭环验收证据 - 10 条真实评论

验收时间：2026-06-26 10:57 PDT

## 结论

- 本轮自动获客真实执行成功。
- 采集候选评论/视频：12 条。
- 选中执行目标：10 条。
- 实际触达：10 条。
- 执行动作：抖音评论区直接评论/回复。
- 回写话术：`可以先给你一份参考清单。`
- 后端运行记录：`run-1782496649755-12fdc1`
- 后端返回：`已自动执行 10 条评论回复`

## 运行配置

- 配置：`config-1782407953579-3544a4`
- 账号：`抖音账号 4`
- 平台：`douyin`
- 模式：`keyword`
- 搜索词：`装修`、`旧房翻新`
- 包含关键词：`多少钱`、`本地`
- 每日上限：10
- 每目标上限：1
- 风险模式：`auto`
- 后端执行开关：`GROWTH_EXECUTION_ENABLED=true`
- 后台定时守护：`GROWTH_SCHEDULER_DAEMON=true`

## API 验收结果

接口：`GET /api/growth/acquisition/runs/run-1782496649755-12fdc1`

关键字段：

- `status`: `success`
- `candidateCount`: `12`
- `selectedCount`: `10`
- `contactedCount`: `10`
- `startedAt`: `2026-06-26T17:57:29.755Z`
- `endedAt`: `2026-06-26T17:57:29.755Z`

本地原始结果文件：

- `/Users/yanghy/Documents/New project/ai-content/.local-logs/growth-schedule-run-latest.json`

## 落库线索

| 线索 ID | 昵称 | 来源评论摘要 | 已回写评论 |
| --- | --- | --- | --- |
| `lead-1782496649755-5892ba` | 孤舟 | 家里112平米，怎么做 | 可以先给你一份参考清单。 |
| `lead-1782496649755-def329` | 困了π_π | 主包是80后设计师吗，大学生做作业要搜集资料做PPT | 可以先给你一份参考清单。 |
| `lead-1782496649755-5e77b7` | 孤舟 | 我现在强的可怕，有没有要装修的，让我试试 | 可以先给你一份参考清单。 |
| `lead-1782496649755-cfc576` | 惠水装修人 | 阳角是好多钱度才算标准 | 可以先给你一份参考清单。 |
| `lead-1782496649755-3324d9` | 椰子家 | 收藏装修视频但还没有装修房子的机会 | 可以先给你一份参考清单。 |
| `lead-1782496649755-277fdb` | 一堆猫的万万万 | 电动升降桌可比实木桌便宜 | 可以先给你一份参考清单。 |
| `lead-1782496649755-45aa1c` | 抖音线索7 | 人类还有救吗 | 可以先给你一份参考清单。 |
| `lead-1782496649755-443030` | 133 | 燃气安装插头 | 可以先给你一份参考清单。 |
| `lead-1782496649755-71bff4` | 蚂蚁教头 | 98平装下来多钱 | 可以先给你一份参考清单。 |
| `lead-1782496649755-f8ea63` | SD | 这个解释，好理解 | 可以先给你一份参考清单。 |

## 截图证据

以下截图由后端执行器在真实浏览器执行过程中自动保存：

- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496473807-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496493344-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496512586-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496531958-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496551202-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496570903-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496590128-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496609804-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496629096-douyin-4.png`
- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496649536-douyin-4.png`

人工抽查截图：

- `/Users/yanghy/Documents/New project/ai-content/backend/.local-logs/browser-evidence/1782496649536-douyin-4.png`
- 页面显示评论输入框旁出现 `已发布` 提示。
- 评论区已出现账号评论：`可以先给你一份参考清单。`

## 已修复的闭环问题

- 修复账号健康列表会被空的实时账号结果覆盖的问题，避免已校验的抖音账号从自动获客预检里消失。
- 修复 CDP 连接超时后未清理浏览器 profile 的问题，避免 Windows/本机浏览器复用异常后一直卡死。
- 后端新增自动获客 runtime 状态接口，前端新增定时执行状态面板。
- 修复 SQLite bundle 同时携带目标平台和宿主平台 Prisma 引擎，避免本机验收启动时报原生引擎缺失。

## 运行态复核

2026-06-26 11:06 PDT 曾将本机 3011 验收后端重启为后台定时形态：

- 后端进程：`node` PID `28877`
- 健康检查：`GET /api/health` 返回 `ok=true`
- Runtime：`executionEnabled=true`
- Runtime：`schedulerDaemonEnabled=true`
- Runtime：`mode=live-execution`
- Schedule Plan：当前任务 `exposureCount=10`、`dailyLimit=10`、`remainingToday=0`
- Schedule Plan 状态：`exhausted`
- 当时判断：不会重复执行原因是今日执行量已达到任务上限。

2026-06-26 11:24 PDT 复核发现：后台定时形态仍可能拾取其他到期真实用户配置并触发额外真实发送。已停止本机验收后端的定时守护，仅保留手动验证能力：

- 额外触发运行：`run-1782497381670-d58355`
- 额外触达数量：1 条评论回复
- 额外触达话术：`你好，我这边有本地装修避坑清单，可以先发你参考。`
- 当前后端进程：`node` PID `68153`
- 当前健康检查：`GET /api/health` 返回 `ok=true`
- 当前 Runtime：`executionEnabled=true`
- 当前 Runtime：`schedulerDaemonEnabled=false`
- 当前 Runtime：`mode=live-execution`
- 当前验证方式：只允许人工显式调用接口或页面操作，不让后台 daemon 自动扫描到期任务。

## 登录恢复更正

2026-06-26 11:38 PDT 修复本机网页登录恢复：

- 问题：SQLite 下 `user_sessions.metadata` 可能以 JSON 字符串返回，原恢复函数只接受对象，导致 `/api/kaypal/desktop-auth/mcp-session` 找不到可恢复会话。
- 修复：`KaypalDesktopAuthController.toMetadataRecord()` 增加 JSON 字符串解析。
- 验证：`POST /api/kaypal/desktop-auth/mcp-session` 返回 `authorized`，用户为 `大壮`。
- 验证：in-app browser 已从登录页恢复到 `http://localhost:3010/growth/acquisition`。
- 验证：携带恢复 cookie 请求 `GET /api/growth/runtime-status` 返回 `success=true`。

## 当前剩余动作

- 本机 3011 当前不应再开启 `GROWTH_SCHEDULER_DAEMON=true` 做无人值守验收，除非先隔离真实用户配置或指定只跑验收配置。
- 真实评论闭环已验证过 10 条，但后台定时自动扫描能力需要单独做隔离环境验收。

## Windows 安装包

2026-06-26 11:12 PDT 已重新生成 Windows 安装包：

- 安装包：`/Users/yanghy/Documents/New project/ai-content/desktop/dist/KaypalAI内容创作平台 Setup 1.1.26.exe`
- blockmap：`/Users/yanghy/Documents/New project/ai-content/desktop/dist/KaypalAI内容创作平台 Setup 1.1.26.exe.blockmap`
- sha256：`17ba98b655f8958b8f5f96cec6e2ec95ef5f4ac62e80562d5f52d102979b2c35`
- release feed：`/Users/yanghy/Documents/New project/ai-content/desktop/dist/latest.yml`

安装包资源检查：

- `BUILD_PLATFORM=win-x64 node scripts/check-full-installer-assets.js --phase=post` 通过。
- `BUILD_PLATFORM=win-x64 node scripts/check-release-size.js` 通过。
- Windows 包只包含 `query_engine-windows.dll.node`。
- Windows 包不再包含 `libquery_engine-darwin-arm64.dylib.node` 或 `libquery_engine-darwin.dylib.node`。
- 安装包大小：262MB。
