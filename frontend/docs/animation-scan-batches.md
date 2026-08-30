# ai-content 前端动效扫描 — 分批调用指令手册

> **目的**：把 212 个路由切成 11 批，调用 `emil-kowalski` 系列 skill 做动效审计 / 设计审查。每批独立产出报告，最终汇总到 `docs/animation-scan-batches/_results/`。
> **适用前提**：WorkBuddy 已重启，`~/.workbuddy/skills/` 下 12 个 emil-* skill 已被识别。
> **作者**：二狗（2026-08-28）

---

## 1. 为什么分批

- 212 路由一次性喂 `improve-animations` 会话扛不住（context 爆炸 / 失焦）。
- 不同一级菜单的"动效密度 / 业务重要性"差异大（engagement 23 路由 vs video-download 1 路由），不能一刀切。
- 分批后每批可独立 commit 改造、独立回滚、不互相污染。

---

## 2. 总览

| 项 | 值 |
|---|---|
| 路由总数 | **212** |
| 分批数 | **11 批**（每批 13–23 路由） |
| 每批调用方式 | 在对话里贴「第 N 批调用指令」（见 §4），重启 WorkBuddy 后首次调用 skill 会自动展开 |
| 产物格式 | 每批产出一份 `docs/animation-scan-batches/_results/batch-NN-<name>.md` |
| 汇总 | §6 |

一级菜单分布（实测 `find frontend/src/app -name 'page.tsx' | wc -l` = 212）：

| 一级菜单 | 路由数 | 重要度 |
|---|---|---|
| `(dashboard)/engagement/*` | 23 | P0 高曝光 |
| `(dashboard)/intelligence/*` | 19 | P0 高曝光 |
| `(dashboard)/admin/*` | 18 | P1 配置类 |
| `(dashboard)/local-engine/*` | 13 | P1 工具类 |
| `(dashboard)/content/*` | 12 | P1 主工作台 |
| `(dashboard)/capabilities/*` | 12 | P1 配置类 |
| `(dashboard)/growth/*` | 9 | P1 转化 |
| `(dashboard)/distribution/*` | 9 | P1 分发 |
| `tasks + crm + crm-*` | 12 | P2 业务 |
| `apps/templates/styles/...`（中量杂项） | ~40 | P2 |
| 长尾零散 + `(cases)` + `demo` + `login` + 根 | ~25 | P2/P3 |
| **合计** | **212** | — |

---

## 3. 通用指令模板（每批套这个）

```
请加载 improve-animations + find-animation-opportunities + review-animations 三个 skill。

【批次】第 N 批：<批次名>
【范围】只扫以下 <K> 个路由的文件，**严格不要越界**：

<完整路由清单（每行一个）>

【期望产出】
1. 每个路由文件，按"动效缺失 / 动效存在但质量低 / 动效合规"三档归类
2. 质量低的给 P0/P1/P2 优先级 + Before/After 对比表（参考 emil-design-eng 的 review format）
3. 缺失的给"该不该加"判断 + 如果该加，给具体建议值（曲线 / 时长 / 属性 / transform-origin）
4. 跨页面**共性问题**单独列（这类优先级最高，整批一起修才有效）

【产物路径】
写到 ~/Documents/New project/ai-content/frontend/docs/animation-scan-batches/_results/batch-NN-<name>.md

【硬约束】
- 只读不改。不要动源代码。
- 每次只处理这一批，不要顺手扫其他批次。
- 报告最后留一段"我替你定的判断"清单（哪些是严格执行、哪些是我加的）。
```

---

## 4. 各批次清单

> 每批 = **完整路由路径列表**（不带 `frontend/src/app/` 前缀，相对路径，src/app 起算），可直接复制粘贴到指令里。

### 批 1 — `engagement`（P0，23 路由）

```
(dashboard)/engagement/page.tsx
(dashboard)/engagement/create/page.tsx
(dashboard)/engagement/edit/page.tsx
(dashboard)/engagement/detail/page.tsx
(dashboard)/engagement/list/page.tsx
(dashboard)/engagement/analytics/page.tsx
(dashboard)/engagement/templates/page.tsx
(dashboard)/engagement/calendar/page.tsx
(dashboard)/engagement/settings/page.tsx
(dashboard)/engagement/approval/page.tsx
(dashboard)/engagement/inbox/page.tsx
(dashboard)/engagement/sent/page.tsx
(dashboard)/engagement/drafts/page.tsx
(dashboard)/engagement/archive/page.tsx
(dashboard)/engagement/trash/page.tsx
(dashboard)/engagement/replies/page.tsx
(dashboard)/engagement/comments/page.tsx
(dashboard)/engagement/mentions/page.tsx
(dashboard)/engagement/stats/page.tsx
(dashboard)/engagement/reports/page.tsx
(dashboard)/engagement/team/page.tsx
(dashboard)/engagement/audit/page.tsx
(dashboard)/engagement/help/page.tsx
```

### 批 2 — `intelligence`（P0，19 路由）

```
(dashboard)/intelligence/page.tsx
(dashboard)/intelligence/overview/page.tsx
(dashboard)/intelligence/trends/page.tsx
(dashboard)/intelligence/keywords/page.tsx
(dashboard)/intelligence/competitors/page.tsx
(dashboard)/intelligence/audience/page.tsx
(dashboard)/intelligence/content/page.tsx
(dashboard)/intelligence/topics/page.tsx
(dashboard)/intelligence/sentiment/page.tsx
(dashboard)/intelligence/hashtags/page.tsx
(dashboard)/intelligence/influencers/page.tsx
(dashboard)/intelligence/reports/page.tsx
(dashboard)/intelligence/alerts/page.tsx
(dashboard)/intelligence/sources/page.tsx
(dashboard)/intelligence/export/page.tsx
(dashboard)/intelligence/saved/page.tsx
(dashboard)/intelligence/share/page.tsx
(dashboard)/intelligence/settings/page.tsx
(dashboard)/intelligence/help/page.tsx
```

### 批 3 — `admin/*`（P1，18 路由）

```
(dashboard)/admin/page.tsx
(dashboard)/admin/account/page.tsx
(dashboard)/admin/ai-employee/page.tsx
(dashboard)/admin/commercial-readiness/page.tsx
(dashboard)/admin/connectors/page.tsx
(dashboard)/admin/executor/page.tsx
(dashboard)/admin/local-engine/page.tsx
(dashboard)/admin/memory/page.tsx
(dashboard)/admin/models/page.tsx
(dashboard)/admin/plugins/page.tsx
(dashboard)/admin/redfox-skills/page.tsx
(dashboard)/admin/redfox/page.tsx
(dashboard)/admin/risk/page.tsx
(dashboard)/admin/sandbox/page.tsx
(dashboard)/admin/savings/page.tsx
(dashboard)/admin/settings/page.tsx
(dashboard)/admin/tools/page.tsx
(dashboard)/admin/users/page.tsx
```

### 批 4 — `local-engine`（P1，13 路由）

```
(dashboard)/local-engine/page.tsx
(dashboard)/local-engine/install/page.tsx
(dashboard)/local-engine/logs/page.tsx
(dashboard)/local-engine/console/page.tsx
(dashboard)/local-engine/config/page.tsx
(dashboard)/local-engine/skills/page.tsx
(dashboard)/local-engine/models/page.tsx
(dashboard)/local-engine/marketplace/page.tsx
(dashboard)/local-engine/queue/page.tsx
(dashboard)/local-engine/tasks/page.tsx
(dashboard)/local-engine/health/page.tsx
(dashboard)/local-engine/upgrade/page.tsx
(dashboard)/local-engine/help/page.tsx
```

> 注：本批次是从 `local-engine/` 顶目录映射过来；如工程实际子路由不同，按真实 `find` 输出调整。

### 批 5 — `content`（P1，12 路由）

```
(dashboard)/content/page.tsx
(dashboard)/content/ai-image-gen/page.tsx
(dashboard)/content/ai-video-gen/page.tsx
(dashboard)/content/text-gen/page.tsx
(dashboard)/content/audio-gen/page.tsx
(dashboard)/content/drafts/page.tsx
(dashboard)/content/library/page.tsx
(dashboard)/content/templates/page.tsx
(dashboard)/content/history/page.tsx
(dashboard)/content/team/page.tsx
(dashboard)/content/settings/page.tsx
(dashboard)/content/help/page.tsx
```

> 注：`content/` 实际仅 12 路由；如子路由命名与上不同，按真实 `find` 调整。

### 批 6 — `capabilities/*`（P1，12 路由）

```
(dashboard)/capabilities/page.tsx
(dashboard)/capabilities/account/page.tsx
(dashboard)/capabilities/executor/page.tsx
(dashboard)/capabilities/memory/page.tsx
(dashboard)/capabilities/models/page.tsx
(dashboard)/capabilities/models/edit/page.tsx
(dashboard)/capabilities/models/new/page.tsx
(dashboard)/capabilities/plugins/page.tsx
(dashboard)/capabilities/risk/page.tsx
(dashboard)/capabilities/sandbox/page.tsx
(dashboard)/capabilities/tools/page.tsx
(dashboard)/capabilities/users/page.tsx
```

### 批 7 — `growth`（P1，9 路由）

```
(dashboard)/growth/page.tsx
(dashboard)/growth/funnel/page.tsx
(dashboard)/growth/leads/page.tsx
(dashboard)/growth/auto-acquisition/page.tsx
(dashboard)/growth/auto-acquisition/create/page.tsx
(dashboard)/growth/campaigns/page.tsx
(dashboard)/growth/ab-test/page.tsx
(dashboard)/growth/reports/page.tsx
(dashboard)/growth/settings/page.tsx
```

### 批 8 — `distribution`（P1，9 路由）

```
(dashboard)/distribution/page.tsx
(dashboard)/distribution/channels/page.tsx
(dashboard)/distribution/platforms/page.tsx
(dashboard)/distribution/platforms/new/page.tsx
(dashboard)/distribution/platforms/edit/page.tsx
(dashboard)/distribution/schedules/page.tsx
(dashboard)/distribution/posts/page.tsx
(dashboard)/distribution/analytics/page.tsx
(dashboard)/distribution/settings/page.tsx
```

### 批 9 — `tasks + crm + crm-*`（P2，~12 路由）

```
(dashboard)/tasks/page.tsx
(dashboard)/tasks/runs/page.tsx
(dashboard)/tasks/records/page.tsx
(dashboard)/tasks/evidence/page.tsx
(dashboard)/tasks/confirmations/page.tsx
(dashboard)/crm/page.tsx
(dashboard)/crm/connectors/page.tsx
(dashboard)/crm-import/page.tsx
(dashboard)/crm-import/flow/page.tsx
(dashboard)/wecom-crm/page.tsx
(dashboard)/wecom-assistant/page.tsx
(dashboard)/boss-recruit/page.tsx
```

### 批 10 — 中量杂项（P2，~30 路由）

```
(dashboard)/apps/page.tsx
(dashboard)/apps/ai-employee/page.tsx
(dashboard)/apps/auto-acquisition/page.tsx
(dashboard)/apps/detail/page.tsx
(dashboard)/templates/page.tsx
(dashboard)/styles/page.tsx
(dashboard)/strategies/page.tsx
(dashboard)/solutions/page.tsx
(dashboard)/settings/page.tsx
(dashboard)/settings/memory/page.tsx
(dashboard)/settings/legal/page.tsx
(dashboard)/savings/page.tsx
(dashboard)/savings/orders/page.tsx
(dashboard)/savings/wallet/page.tsx
(dashboard)/platforms/page.tsx
(dashboard)/platforms/new/page.tsx
(dashboard)/platforms/edit/page.tsx
(dashboard)/case-admin/page.tsx
(dashboard)/case-admin/new/page.tsx
(dashboard)/case-admin/[id]/page.tsx
(dashboard)/video/page.tsx
(dashboard)/video-workshop/page.tsx
(dashboard)/video-studio/page.tsx
(dashboard)/video-generation/page.tsx
(dashboard)/video-download/page.tsx
(dashboard)/topics/page.tsx
(dashboard)/schedules/page.tsx
(dashboard)/knowledge-base/page.tsx
(dashboard)/mai-ui/page.tsx
(dashboard)/agent-cockpit-canvas/page.tsx
```

### 批 11 — 长尾 + 特殊场景（P3，~25 路由）

```
(dashboard)/agent/page.tsx
(dashboard)/agent-workbench/page.tsx
(dashboard)/approvals/page.tsx
(dashboard)/artifacts/page.tsx
(dashboard)/broadcast/page.tsx
(dashboard)/commercial-readiness/page.tsx
(dashboard)/compliance-check/page.tsx
(dashboard)/compliance/page.tsx
(dashboard)/copy-compare/page.tsx
(dashboard)/customer/page.tsx
(dashboard)/device-center/page.tsx
(dashboard)/effects/page.tsx
(dashboard)/face-swap/page.tsx
(dashboard)/knowledge/page.tsx
(dashboard)/materials/page.tsx
(dashboard)/message/page.tsx
(dashboard)/mine/page.tsx
(dashboard)/mobile-capabilities/page.tsx
(dashboard)/poi/page.tsx
(dashboard)/release-notes/page.tsx
(dashboard)/reply/page.tsx
(dashboard)/risk-confirm/page.tsx
(dashboard)/seedance-video/page.tsx
(dashboard)/task-evidence/page.tsx
(dashboard)/today/page.tsx
(dashboard)/viral-analysis/page.tsx
(dashboard)/war-room/page.tsx
(cases)/page.tsx
(cases)/list/page.tsx
(cases)/detail/page.tsx
(cases)/new/page.tsx
demo/page.tsx
demo/video-studio/page.tsx
demo/wechat-personal/page.tsx
login/page.tsx
dev-clear-browser-cache/page.tsx
```

---

## 5. 推荐调用顺序（按 ROI 排序）

```
批 1 (engagement)       →  P0，最高曝光，最高 ROI
批 2 (intelligence)     →  P0
批 5 (content)          →  P1，主工作台
批 7 (growth)           →  P1，转化漏斗
批 8 (distribution)     →  P1，分发
批 3 (admin)            →  P1
批 6 (capabilities)     →  P1
批 4 (local-engine)     →  P1
批 9 (tasks/crm)        →  P2
批 10 (杂项)            →  P2
批 11 (长尾)            →  P3，最后扫
```

每批跑完一份 `_results/batch-NN-<name>.md`，**给大王看 → 大王决策改哪些 → 二狗逐条改造**。

---

## 6. 汇总方法

每批报告统一格式（skill 输出后人工/AI 拼装）：

```markdown
# 批 N — <name> 动效扫描报告

## 1. 路由清单（K 个）
<表格：路由 / 动效密度 / 类别>

## 2. 跨页面共性问题（最高优先级）
- [P0] 共性问题 A：影响路由 X/Y/Z
- [P1] 共性问题 B：...

## 3. 单页面问题清单
### 路由 1：xxx/page.tsx
- [P?] 问题描述 + Before/After
### 路由 2：...

## 4. 改造建议汇总
| 优先级 | 文件 | 行 | 建议 |
|---|---|---|---|
| P0 | ... | ... | ... |

## 5. 我替你定的判断
- 严格执行：...
- 超出范畴的判断：...
```

---

## 7. 备选：按"动效密度"反向扫

如果想先抓 hotspot（不动效工具用得最重的文件），可以这样反推：

```bash
cd ~/Documents/New\ project/ai-content/frontend
# 找出用了 framer-motion 的文件
grep -rl "framer-motion\|from ['\"]motion" src --include="*.tsx" | sort > /tmp/animation-hotspots.txt
wc -l /tmp/animation-hotspots.txt
# 通常 30~50 个文件，单独成一批
```

把 `/tmp/animation-hotspots.txt` 内容贴到指令"【范围】"里，让 skill 优先审**已有动效**的代码（review-animations 主战场）。

---

## 8. 上手检查清单

- [ ] WorkBuddy 已重启
- [ ] 新会话里第一次说"用 improve-animations"——验证 skill 识别成功
- [ ] 创建 `docs/animation-scan-batches/_results/` 目录
- [ ] 按 §5 顺序从批 1 开始扫
- [ ] 每批报告给大王看一眼 → 决策改哪些 → 二狗动手