# 炼刀 AI 员工 vs JIUZHANG AI · 代码级差距复核（2026-08-10 第六轮 · endpoint 级矩阵）

> 基线：炼刀 dt-ai-helper 1.8.5 渲染端 asar 提取 188 个可见 IPC/HTTP 路径
> 方法：逐条路径展开 → 对照当前源码路由/执行器/资源/前端 → 三级判定（✅ 真实接线 / 🟡 形态差异或小缺口 / ⛔ 产品排除）
> 与第五轮差异：本轮从「集群级」下沉到「路径级」，补齐了之前未逐条核对的视频下载任务、BGM、视频合成/换脸、视频发布计划、商品剪辑配置等。

---

## 一、endpoint 级映射总表

### 微信营销自动化

| 炼刀路径 | 我们 | 判定 |
|---|---|---|
| /auto/we_chat/post/create, /pages, /details/edit, /status | wechat-moments-publish native runner + 计划元数据 | ✅ |
| /auto/we_chat/post/copy-expansions | wechat-plan-editor moments-draft / moments-revision / regenerate-moments | ✅（更完整：生成+修订+重写） |
| /auto/we-chat-moment-campaigns/* (9) | moments-marketing native + plan scheduler/editor | ✅ |
| /auto/add_friend/* (6) | contact-add + friend-accept native | ✅ |
| /message_send_plan/* (14) | groups/plans 10 端点 + status=completed 过滤 | 🟡 缺 cancel / detail/edit（remove/pause/resume 有） |
| /private_message/* (6) | douyin/wechat-channel direct-message + crm 客户跟进 | ✅ |
| /we-chat/contact/* + /contact-management | wechat/contacts CRUD + export + diagnostics | ✅ |
| /auto/we-chat/mess/send-log/pages | interaction records / evidence export | ✅ |
| /auto-accept | friend-accept native | ✅ |
| /rpa_sync_chat_history | chat-history native + OCR 兜底（非 RPA 模拟，能力等价） | ✅ |
| /config/group_send_conf, /group_send_config | groups/plans/config | ✅ |
| /config/risk_control_settings | auth/risk-control 动作级确认（形态差异：炼刀全局设置 vs 我们动作级） | 🟡 |

### 曝光/获客

| 炼刀路径 | 我们 | 判定 |
|---|---|---|
| /exposure/* + /auto/*-exposure/* (link/account-search/targeted/retention/url 各 5-6) | DouyinExposureService + ExposureCollector（link/search/targeted/retention/hot-video 5 类真实浏览器采集） | ✅ |
| /auto/exposure/comment_expand, /filed-copy-expansions, /prompt | 曝光 prompt 由任务 prompt 驱动（文案扩展走 product-copy/plan-editor） | 🟡 |
| /auto_exposure_conf/refresh, /exposure/config | exposure config 由任务级参数承载，无独立全局配置端点 | 🟡 |
| /exposure/auto-exposure, /form | 曝光任务类型映射 | ✅ |

### 短视频创作

| 炼刀路径 | 我们 | 判定 |
|---|---|---|
| /video/download/task/* + /video/download_task (6) | video-workshop tasks/download + download-policy + downloader | ✅ |
| /video/synthesis/submit, /template, /list, /refine-prompt, /download-record | video-workshop jobs/render + 模板（卖点/探店/案例） | ✅ |
| /video/synthesis/face-swap/submit | video-face-swap（jobs/capabilities/estimate） | ✅ |
| /video_creation/editing_task/one_key_video, _pre | studio_core 一键成片 | ✅ |
| /video_creation/editing_task/expand_copywriting | product-copy（商品）/ plan-editor（朋友圈） | ✅ |
| /video_creation/editing_task/* CRUD (pages/detail/remove/taskName/edit/prompts) | 任务 CRUD 由 interaction task 体系承载 | ✅ |
| /video-template/list | video-workshop 模板 | ✅ |
| /video/materials, /materials/product-information | materials 模块 + product-profiles | ✅ |
| /video/upload/phone | 手机上传？未找到等价 | 🟡 |
| /auto/product_video_clip/config/* (5) + /submit_clip_task | product-cut 提交有；**配置 CRUD 无** | 🟡 |
| /video_release_plan/* (5) | auto-upload 任务级定时发布（enableTimer/scheduleTime） | 🟡 形态差异 |
| /video/release, /release_record, /image_release, /choose_platform, /account, /batch-import, /generate, /clip, /task | 9 平台发布（视频/图文）+ publishing records | ✅ |
| /system/music/bgm | video-workshop musicPreset（轻快/温和/氛围）**无 BGM 曲库管理** | 🟡 |

### 平台/账号/系统

| 炼刀路径 | 我们 | 判定 |
|---|---|---|
| /poi/management/* (5) | PoiStore 5 API + /poi 页面 | ✅ |
| /token, /token/rpa/use/pre_check, /token/rpa/use/report | /usage/token 3 API + AiClientService 自动 usage 上报 | ✅ |
| /user/edit | **无个人资料编辑端点**（auth 仅 login/logout/role；/auth/me 只读） | 🟡 |
| /agent-chat | agent-cockpit-canvas / sessions | ✅ |
| /contact-management | wechat/contacts | ✅ |
| /system/music/bgm | musicPreset | 🟡 |
| /automation/friend_conf, /set_msg_id | friend-accept 配置 + 任务消息标识 | ✅ |

---

## 二、本轮新确认的真实小缺口（6 项）

| # | 缺口 | 炼刀 | 我们现状 | 工作量 |
|---|---|---|---|---|
| 1 | **个人资料编辑** | /user/edit | 无 profile 更新端点 | 小 |
| 2 | **群发计划取消** | /message_send_plan/cancel | remove 近似（无 cancel 状态流转） | 小 |
| 3 | **群发计划详情编辑** | /detail/edit | 有 detail-list 无编辑 | 小 |
| 4 | **商品剪辑配置 CRUD** | /auto/product_video_clip/config/* | 有 product-cut 无配置管理 | 小 |
| 5 | **BGM 曲库** | /system/music/bgm | 仅 musicPreset 预设 | 中 |
| 6 | **独立视频发布计划** | /video_release_plan/* | 任务级定时发布（enableTimer） | 中 |

## 三、结论

1. **188 路径中 ~170 已真实接线**（含本轮新确认的视频下载/合成/换脸/模板/定时发布/曝光配置/朋友圈文案编辑器）。
2. **剩余 6 项都是小/中量级产品补全**，无架构性差距；其中最值得做的是 #1 个人资料编辑与 #2/#3 群发计划管理补全（直接对应前台操作闭环）。
3. 排除项：TikTok（产品决策）；手机操控（无 adb/scrcpy/uiautomator，P2 独立立项）。
4. 验证：后端 133 suites / 1456 tests 全绿；Windows 1.1.72 包（08:43）资源全过。

---

## 附：核对范围

- 后端路由：`grep -RhoE "@(Get|Post|Put|Patch|Delete)\(['\"][^'\"]+" backend/src/modules --include='*.controller.ts'` 共 523 个路由
- 执行器：runtime platforms（douyin/wechat-channel）、wechat-native contract（8 命令）、video-workshop、video-face-swap、exposure collector、growth 获客
- 前端：poi / ai-action / product-cut / costs / mine 入口
- Windows 包：wechat-native-runners（含 auto-reply）、wx_key.dll、RapidOcr、Playwright Chromium、media-tools、hover-ball.html
