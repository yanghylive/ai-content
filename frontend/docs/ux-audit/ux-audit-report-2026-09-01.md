# 3010 全站用户体验（UX）审计报告

> 日期:2026-09-01 | 审计对象:全站 212 个页面路由 + 导航体系（桌面 rail / 移动 Tab / 互动中心 / 「我的」入口 / 命令面板）
> 视角:营销用户操作流畅度、页面友好度、功能重复、逻辑合理性、分类合理性、上下级关系
> 方法:页面路由全量清单 × 导航注册表 × 各 hub 页入口交叉比对 + 重复功能源码级确认

---

## 1. 总体结论

- **重复功能页 5 组**（其中 2 组为同组件双路由,属明确冗余）
- **真孤儿页面 8 个**（无任何导航/入口可达,用户无法从界面进入）
- **分类矛盾 2 处**（同一功能在不同入口归属不同场景）
- **路径与归属不一致 4 处**（功能挂错域）
- **命名不统一 3 组**（同性质页面命名风格不齐）
- 视频/图片生成类功能**严重散落**（视频 8 个页面分散在 6 个路径域下）

---

## 2. 重复功能页

### 2.1 修正说明（原误判撤回）

`/intelligence/rules` 与 `/intelligence/risks` 并非冗余——二者是同一派发记录组件 `intelligence-dispatch-records-page.tsx` 的**不同 kind 配置**（risks=风险审核 / rules=规则种子 / leads=线索洞察 / accounts=对标账号）,各 kind 有独立标题、描述、空状态与语义,属合理并列结构。原审计误判已撤回。

### 2.2 功能重叠（建议收敛主入口）

| 功能 | 页面 | 入口 | 判定 |
|------|------|------|------|
| 爆款拆解 | `/viral-analysis`（爆款拆解） | 内容运营页 | 单视频链接拆解工具,保留 |
| 爆款拆解 | `/intelligence/viral`（拆解台） | 情报/获客域 | 爆款样本工作台(承接派发样本),与单链拆解互补,保留 |

**修正**:两者是不同层次(单链工具 vs 样本工作台),非简单重复,保留双入口。

| 功能 | 页面 | 入口 |
|------|------|------|
| 知识管理 | `/knowledge-base`（知识库） | 内容运营页 ✅ |
| 知识管理 | `/knowledge`（品牌知识） | **已合并** → `/knowledge-base`（2026-09-01 P0 完成） |

`/knowledge` 是"品牌知识"管理,与 `/knowledge-base` 高度重叠且不可达。

| 功能 | 页面 | 入口 |
|------|------|------|
| 获客策略 | `/growth/strategies`（获客策略） | 获客中心 + 命令面板 ✅ |
| 获客策略 | `/strategies`（策略中心） | **已合并** → `/growth/strategies`（2026-09-01 P0 完成） |

新旧两套策略中心并存,旧版 `/strategies` 已无入口。

---

## 3. 视频/图片生成能力散落（操作流畅度最大问题）

### 3.1 视频生成 8 个页面分布在 6 个路径域

| 路径域 | 页面 | 功能 | 入口 |
|--------|------|------|------|
| `/video-studio` | AI 视频 | 视频一键成片 | 内容运营 ✅ |
| `/video-generation` | AI 图生视频 | 图生视频 | 内容运营 ✅ |
| `/content/ai-video-gen` | AI 生视频 | 文生视频 | 内容运营 ✅ |
| `/seedance-video` | Seedance 快速生成 | AI 视频 | **已合并** → `/content/ai-video-gen`（P1） |
| `/video-workshop` | 视频生产 | 流水线成片（studio_core） | **已补入口** → 内容运营「视频生产」卡片（P1） |
| `/video/product-cut` | 商品视频 | 带货视频 | 内容运营 ✅ |
| `/video/release-plans` | 发布计划 | 定时发布视频 | 内容运营 ✅ |
| `/content/face-swap` | 换脸 | 视频换脸 | 内容运营 ✅ |

用户有 4 个"视频生成"主入口（video-studio / video-generation / ai-video-gen / seedance-video）且名称相似,无法区分。

### 3.2 图片生成 2 个

| 页面 | 功能 | 备注 |
|------|------|------|
| `/content/ai-image-gen` | AI 生图 | 文生图,内容运营入口 |
| `/content/image-gen` | 大纲+逐页配图（PPT 式） | 非纯生图,无独立导航入口（business-tool 上下文引用） |

---

## 4. 真孤儿页面（无任何界面入口,共 8 个）

以下页面有完整路由,但全站无任何导航/hub/命令面板引用,用户只能手动输入 URL:

| 路由 | 功能 | 建议 |
|------|------|------|
| `/strategies` | 策略中心（旧版） | **已合并** → `/growth/strategies`（P0） |
| `/knowledge` | 品牌知识 | **已合并** → `/knowledge-base`（P0） |
| `/reply` | AI 回复建议 | **已挂入口** → 互动中心渠道（P1） |
| `/seedance-video` | Seedance 快速生成 | **已合并** → `/content/ai-video-gen`（P1,与 AI 生视频同 API 重复） |
| `/video-workshop` | 视频生产 | **已补入口** → 内容运营「视频生产」卡片（P1） |
| `/case-admin` | 案例管理（含 `[id]`/`new`） | 待确认:管理端/展示端配对,无入口(建议挂 mine 或废弃) |
| `/commercial-readiness` | 商业就绪自检 | **已补桌面入口** → 「我的→系统与服务」(P1) |
| `/solutions` | 组合方案（含 configure/run） | **非孤儿**:layout「继续组合方案」+ intelligence 工具结果引用,审计脚本漏判 |

> 说明:`/admin/*`（18 个）虽是旧路径,但 layout.tsx 有全局别名重定向（routeAliases → capabilities/apps 等）,不属于孤儿。

---

## 5. 分类不合理

### 5.1 同一功能在入口归属矛盾

| 功能 | 互动中心入口 | 命令面板/执行中心 |
|------|-------------|------------------|
| 执行态势（`/war-room`） | ✅ 在 `INTERACTION_CHANNELS`（互动中心卡片） | ✅ 归为「执行中心」 |

同一页面在两个导航体系里归属不同场景,用户从不同入口进入时对"这属于哪"认知不一致。

### 5.2 一级导航名实不符

| 一级导航 | 实际内容 | 问题 |
|---------|---------|------|
| 移动设备（`/device-center`） | 任务/发布任务/移动设备混合 | 名称是"移动设备",内容是任务执行,职责不清 |

---

## 6. 上下级关系/路径归属不合理

| 功能 | 实际路径 | 归属场景 | 问题 |
|------|---------|---------|------|
| 用量与费用 | `/intelligence/costs` | 「我的→账号与设置」 | 账单挂"情报"域,路径与归属不一致 |
| 数据服务管理 | `/intelligence/redfox` | 「我的→系统与服务」（adminOnly） | 管理功能挂"情报"域 |
| 情报规则/风险审核 | `/intelligence/rules`、`/intelligence/risks` | 同一组件双路由 | 应二选一 |
| 获客策略 | `/growth/strategies` | 获客中心 | 与旧 `/strategies` 并存,新旧不分 |
| 爆款拆解 | `/viral-analysis` vs `/intelligence/viral` | 内容运营 vs 获客 | 一功能两实现,跨域分家 |

---

## 7. 命名不统一

| 组 | 页面 | 规范建议 |
|----|------|---------|
| 新建/列表 | `/intelligence/monitor-new` vs `/intelligence/monitors` | 统一为 `monitors` + `monitors/new` |
| 新建/列表 | `/intelligence/report-new` vs `/intelligence/reports` | 统一为 `reports` + `reports/new` |
| 历史重定向 | `/crm-closer`→`/crm/closer`、`/crm-connectors`→`/crm/connectors`、`/crm-import`→`/crm/import`、`/face-swap`→`/content/face-swap`、`/task-evidence`→`/tasks/evidence`、`/wecom-assistant`→`/engagement/wecom-assistant` | 重定向保留是好的（兼容旧链接）,但说明命名中途变更过多,建议新功能一次定名 |

---

## 8. 操作流畅度问题

1. **视频生成入口**:**已优化**（2026-09-01）——确认三个入口为三种生成模式（文生/成片/图生）,非重复,不合并。改为:AI 生视频移入「视频与发布」组集中展示;三入口描述差异化（"文字描述生成短视频"/"选题→脚本→成片,多流水线"/"上传图片+提示词"）;移动端补 AI 生视频入口,命名与桌面对齐
2. **孤儿页面死胡同**:**验证不成立**——`/video-workshop` 外层有 `DesktopOnlyGate backHref="/content"` 返回链,`/seedance-video` 已并入 ai-video-gen
3. **同组件双路由（rules/risks）**:用户在某处看到"情报规则",某处看到"风险审核",点进去是同一个东西,降低信任感。
4. **爆款拆解两套界面**:内容运营入口和获客入口各一套,数据不互通（两组件独立实现）,用户会怀疑功能不一致。

---

## 9. 页面友好度亮点（确认无问题的部分）

- 重定向兼容做得好:所有旧路径都有 query-preserving 重定向,老书签不失效
- 「互动中心」渠道入口统一由 `nav-registry.ts` 派生,桌面/移动不漂移
- `/capabilities` 顶层合理重定向到模型管理,避免空页面
- 覆盖核查确认 212 页全部消费共享样式,视觉一致
- 命令面板（command-palette）覆盖全站搜索,是良好的高级入口

---

## 10. 建议优先级

### P0（明确冗余,低风险高收益）
1. ~~合并 `/intelligence/rules` 与 `/intelligence/risks`~~ **撤回**:4 个 kind 是合理并列结构,非冗余
2. ~~删除/重定向孤儿旧页~~ **已完成**(2026-09-01):`/strategies`、`/strategies/new`、`/strategies/edit` → `/growth/strategies`;`/knowledge` → `/knowledge-base`;旧组件死代码已删

### P1（用户可见困惑,中等工作量）
3. **已完成**:`/seedance-video` 并入 `/content/ai-video-gen`(同 API 重复);`/video-workshop` 补内容运营入口
4. **已修正**:爆款拆解双入口(单链工具 + 样本工作台)为互补结构,保留
5. **已完成**:`/reply` → 互动中心渠道;`/commercial-readiness` → 「我的→系统与服务」(桌面)+「系统与情报」(移动)

### P2（结构性优化,需产品决策）
6. **已完成**:一级导航「移动设备」→「设备任务」(名实相符)
7. **已完成**:`war-room` 从互动中心渠道移除,归属执行中心(命令面板/场景归属不变)
8. **已完成(修正方案)**:原建议迁移到 `/settings/costs` 不成立——`/intelligence/costs` 实为 **Redfox 数据服务用量**(非账号账单,情报域 10 处引用才是自然归属)。改为:「我的→账号与设置」的入口移到「系统与服务」并改名「数据用量」,语义对齐
9. **建议跳过**:`monitor-new`/`report-new` 为内部新建页(无直接 URL 曝光),改名收益低于风险,维持现状
10. **已完成**:`/case-admin` 挂「我的→系统与服务」adminOnly(管理员可见)

---

## 11. 附:审计方法说明

- 页面清单:Glob 全量 `**/page.tsx`（排除 route group 前缀）
- 导航源:nav-registry.ts + app-shell.tsx（SCENES）+ mobile-shell.tsx（MOBILE_TABS）+ command-palette.tsx + 12 个 hub 页入口
- 孤儿判定:页面路由不被任何导航源/hub 页引用（含前缀匹配）
- 重复判定:源码级对比引用组件与页面标题
