# 移动端全路由 UX 审计报告（255 页面无遗漏）

> 测试环境：生产 PWA/APK 壳 WebView（https://aicontent.vip.kaypal.cn），大壮账号登录态
> 测试方式：CDP 批量导航全部 255 个前端路由，逐页检查渲染状态（白屏 / 错误提示 / 跳转 / 内容区）
> 测试日期：2026-08-09

---

## 一、总览

| 分类 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 正常渲染 | 231 | 90.6% | 内容区正常显示 |
| 🔀 合理跳转 | 2 | 0.8% | `/`→`/today`、`/content/knowledge`→`/knowledge-base`（正常重定向） |
| 🔀 无提示弹回 | 6 | 2.4% | face-swap-v2 系列 / video-workshop / content 子路由 → 静默跳 `/content` |
| ⚪ 白屏/空内容 | 15 | 5.9% | 其中 9 个为编辑/详情页无参数白屏（真问题） |
| ⚠️ 错误提示 | 1 | 0.4% | accounts-matrix-v2 单账号状态标签（非页面错误） |

**结论：无 P0 阻断级问题（无崩溃、无 500、核心流程可走通）；存在 3 类 P2 体验问题需修复。**

---

## 二、问题清单（按严重度分级）

### 🔴 P0 阻断 —— 无

### 🟠 P1 严重 —— 无

### 🟡 P2 一般（影响体验，建议尽快修）

#### P2-1：9 个编辑/详情页「无参数直接访问」白屏，无任何提示
**现象**：直接访问以下路由（或分享/收藏后进入、刷新丢参数），内容区完全空白，只剩底部导航栏（body 文本仅 25 字符），**无「请选择要编辑的项目」等任何引导**：
- `/styles/edit`、`/templates/edit`、`/strategies/edit`、`/schedules/edit`
- `/solutions/configure`、`/solutions/run`
- `/crm/detail`、`/apps/detail`、`/capabilities/models/edit`

**验证**：`/schedules/edit` 无参数 → 白屏（25 字符）；带 `?taskType=collect_materials` → 正常渲染（264 字符）。`/styles/edit` 无参数 → 白屏；带 `?id=` → 表单正常。

**影响**：用户从列表正常点入无碍；但直接访问/刷新/分享进入会看到刺眼白屏，误以为页面坏了（可能误报 bug）。

**建议**：无参数时渲染空态提示（如「请从列表选择要编辑/查看的项目」+ 返回按钮），替代空白。

#### P2-2：6 个路由「静默弹回 /content」，无功能说明
**现象**：以下路由代码为**无条件 `redirect("/content")` 占位页**，访问后直接跳回内容中心，用户**看不到任何「功能建设中/未开放」说明**：
- `/face-swap-v2`、`/face-swap-v2/create`、`/face-swap-v2/works`
- `/video-workshop`
- `/content/face-swap`、`/content/video`

**影响**：用户从入口（或旧书签/链接）进入时，页面一闪就回到内容中心，无解释、无反馈，体验像「点错/出 bug」。

**建议**：占位路由改为渲染「功能建设中」提示页（说明 + 返回按钮），或入口处去掉/置灰，避免静默弹回。

#### P2-3：accounts-matrix-v2 失效账号引导「请在电脑端打开重新扫码」（手机端逻辑错位）
**现象**：账号状态标签显示「登录已过期，需要重新扫码」，引导文案为「**请在电脑端打开 JIUZHANG AI 重新扫码**」。

**影响**：与平台账号页同病——手机端用户被引导去电脑端操作，违背手机端逻辑（此前已确认手机端应「调起 App 登录」）。账号矩阵页是手机端高频页面，此引导会卡住手机用户。

**建议**：复用 mobile-bridge 的 `openApp`（调起对应平台 App 登录），文案改为「调起 App 重新登录」。

### 🟢 P3 轻微 / 观察项

| 路由 | 现象 | 判定 |
|------|------|------|
| `/intelligence/search`、`/intelligence/search-v2` | 初始态仅搜索框+筛选（内容区为空） | 正常初始态，观察 |
| `/content/xiaohongshu` | 笔记列表空（有「新建」入口） | 正常空态（测试数据已清） |
| `/local-engine-v2/files` | 「没有需要检查的文件」 | 正常空态 |
| `/workbench/wechat-v2/friend-accept` | 「没有待处理的好友申请」 | 正常空态 |
| `/growth/strategies` | 首次访问 7 秒后渲染（冒烟误判白屏） | **加载偏慢**，建议优化首屏 |

---

## 三、分类汇总（按模块）

| 模块 | 页面数 | 问题 |
|------|--------|------|
| 编辑/详情类（styles/templates/strategies/schedules/solutions/crm/apps/capabilities） | 9 | P2-1 无参数白屏 |
| face-swap-v2 / video-workshop / content 子路由 | 6 | P2-2 静默弹回 |
| 平台账号（accounts-matrix-v2） | 1 | P2-3 电脑端引导 |
| intelligence / local-engine / workbench / growth | 5 | P3 观察项 |

---

## 四、附：与已知问题的关系

- 多账号矩阵「账号状态异常/8 账号全失效」为**后端 validate 副作用已知问题**（`GET /auto-upload/accounts?validate=1` 强制 validate），本次审计再次印证，**非本次新发现**；但其引发的「失效引导去电脑端」文案问题（P2-3）值得一并修。
- 本次审计未发现新的 P0/P1 级问题；231/255 页面渲染正常，整体可用。

---

**审计人**：UX 研究（移动端全路由扫描）
**日期**：2026-08-09
**建议优先级**：P2-1（白屏引导）> P2-3（手机端登录引导）> P2-2（占位页提示）
