# 三仓库安全移植开发规格（Implementation Spec）

> 日期：2026-08-11 ｜ 依据：s840207702/auto-upload、ZuckerChen/ss-media-tools、HisMax/RedInk 全量拆解
> 目的：一次定死"抄什么、改哪个文件、怎么验收"，实施时照着干，不在多套代码间来回翻。
> 约束：**只做合规范围内的借鉴；每项都有明确落点、函数签名、验收标准，不留尾巴。**

---

## 0. 合规边界（先读这个，决定"能不能抄"）

| 仓库 | 许可证 | 能否抄代码 | 必须做的合规动作 | 借鉴策略 |
|---|---|---|---|---|
| s840207702/auto-upload | Apache-2.0 | ✅ 可 | 新文件头加来源声明；git commit 注明 | 代码可移植，但按 TS 重写，不逐行复制 |
| ZuckerChen/ss-media-tools | **无许可证** | ❌ 不可 | 一条代码都不抄（含 SQL、常量表） | 只借鉴"发布前体检、失败聚合"的产品思路，全部自研 |
| HisMax/RedInk | CC BY-NC-SA 4.0（**非商用**） | ❌ 不可 | 不抄代码、不抄 prompt 文案、不抄字段命名 | 只借鉴架构思路：prompt 外置、三阶段流水线、SSE 断点重放 |

**通用禁止项**（三条硬规矩）：
1. 不复制原仓库的注释、测试用例、选择器字符串原文——选择器按我们现状重写
2. 所有借鉴自 auto-upload 的新文件，头部必须写：
   ```ts
   // 移植自 s840207702/auto-upload (Apache-2.0)：<功能名>，已按本仓库风格重写
   ```
3. commit message 统一前缀标注来源，如 `feat(avatar): 三层头像抓取 (ref: auto-upload avatar.py 思路)`

---

## 1. P0 ｜ 头像/昵称三层抓取（auto-upload avatar.py → TS 重写）

### 落点
- 新文件：`backend/src/modules/auto-upload/identity-capture.ts`（独立纯函数，不依赖 Nest 注入，方便单测）
- 替换点：`auto-upload.client.ts` 的 `captureAccountIdentityBestEffort`（现 4903 行附近）——**现在是整页截图 + 页面 title 当昵称，必须换掉**

### 接口签名
```ts
export interface CapturedIdentity {
  avatarPath?: string | null;  // 头像元素截图文件名（存 getLocalAvatarDir()）
  userName?: string | null;    // 真实昵称
}
export async function captureAccountIdentity(
  page: Page,
  platformType: number,        // 1=小红书 2=视频号 3=抖音 4=快手 5=B站
  engineAccountId: number | string,
  avatarDir: string,
): Promise<CapturedIdentity>
```

### 三层算法（按优先级，命中即停）

**L1 平台 API 直取（最高优先，绕开 DOM 改版）**
在已登录页面内 `page.evaluate(fetch(url, {credentials:'include'}))`：
- 抖音(3)：`https://creator.douyin.com/aweme/v1/creator/user/info/` → `data.user_profile.nick_name`
- B站(5)：`https://api.bilibili.com/x/web-interface/nav` → `data.uname`
- 小红书/视频号/快手：暂不接 API（接口不稳定），直接走 L2

**L2 平台选择器候选**
```ts
const PLATFORM_IDENTITY_SELECTORS: Record<number, { avatar: string[]; name: string[] }>
```
每个平台给 2-4 个候选 CSS（取第一个可见元素）；抖音昵称特殊：hover `#header-avatar` 展开浮层后 JS 扫描右上角（left > innerWidth-180、top<64）取最右文本。

**L3 全 DOM 评分兜底（保证一定有结果）**
- 头像：遍历所有 `img` + `[style*="background-image"]`，先过滤可见性（rect 24px~180px、非 display:none），打分：
  - 类名/alt/src 含 `avatar|head|user|profile|face|account|portrait|uhead|qlogo|bfs/face` → **+90**
  - 近正方形（宽高比 0.7~1.4）→ **+30**
  - 位于页面右上角（x > innerWidth*0.6 且 y < 150）→ **+22**
  - 含 `qrcode|logo|banner|cover|bkg` → **-80**
  - 总分 **>35 才接受** → `locator.screenshot({path: join(avatarDir, 'account_<id>.png')})`
- 昵称：遍历短文本节点，先过黑名单（首页/发布/内容管理/创作中心/设置/登录/退出/帮助…），打分：
  - meta 关键词 `nick|nickname|user-name|display-name|account-name` → **+90**
  - `user|account|profile|author|creator|avatar|name` → **+42**
  - 顶部(y<100) +24、右侧(x>60%) +16、中文昵称格式 +16、子节点>2 **-24**
  - **≥54 才返回**，按 `score→top→left` 排序取最优

### 触发点
1. 登录成功后（`saveVerifiedLoginSession` 前）调一次，替换现有 `captureAccountIdentityBestEffort`
2. `refreshAccountAvatar(id)` 接口保持，内部改为调新函数重抓

### 验收标准
- 抖音/视频号/小红书账号列表显示**真实昵称**（不是"抖音创作者中心"）+ **真实头像元素图**（不是整页截图）
- 登录新账号时头像/昵称一次抓成，无需手动刷新
- 单测：mock 三套 DOM（纯 API 命中 / 选择器命中 / 仅评分兜底）各出正确结果

---

## 2. P1 ｜ 发布前体检（自研；仅借鉴 ss-media-tools 的"平台适配检查"思路）

### 落点
- 新文件：`backend/src/modules/publishing/platform-preflight.service.ts`
- 注册到 `publishing.module.ts`；controller 加端点

### 规则表（自研，规则值按我们现状定）
| 平台 | 标题上限 | 正文要求 | 话题上限 | 禁词示例（表驱动，可后台配） |
|---|---|---|---|---|
| 抖音 | 55 | ≥1 字 | 5 | 违禁词表 |
| 视频号 | 50 | ≥100 字 | 无 | 违禁词表 |
| 小红书 | 20 | ≥1 字 | 5 | 违禁词表 |
| 快手 | 30 | ≥1 字 | 4 | 违禁词表 |
| B站 | 80 | ≥1 字 | 3 | 违禁词表 |

### 接口
```ts
POST /api/publishing/preflight
{ platform: string; title: string; content: string; tags?: string[]; coverUrl?: string }
→ { valid: boolean; errors: string[]; suggestions: string[] }
```
纯规则、零外部依赖；`normalize_publish_tags`（去 #、去重、截断到上限）一并放这里。

### 前端接入
发布表单（publish-flow.tsx）提交前对每个勾选平台调 preflight，逐平台展示 ✅/❌ + suggestions；任一 error 阻止提交并高亮。

### 验收
- 抖音 6 个话题 → error"话题最多 5 个"；视频号标题 60 字 → error
- 正常内容 → valid=true 无 error

---

## 3. P1 ｜ 图文大纲流水线 + prompt 模板外置（自研；仅借鉴 RedInk 架构思路）

### 落点
- 新目录：`backend/src/modules/content-optimization/prompts/`（模板外置，禁止散在代码里）
  - `outline_prompt.txt`：一句话 → 大纲。占位符 `{topic}`；强分隔符 `<page>` + 每页首行 `[封面]/[内容]/[总结]` 类型标记；内置 1 个 few-shot 示例；收尾"直接输出，不要任何说明"
  - `content_prompt.txt`：大纲 → 标题×3 + 文案 + 标签。占位符 `{topic}{outline}`；强制 JSON schema（`titles/copywriting/tags` 字段+字数约束）；收尾"只输出 JSON"
- 新文件：`content-optimization/outline.service.ts`（三阶段流水线编排）

### 流水线（中间表示可编辑，人审卡在出图前）
```
一句话 → POST /api/content-optimization/outline → 大纲(可编辑)
       → POST /api/content-optimization/generate (SSE 逐事件: progress/complete/error/finish)
       → 每页图落盘后写 task 状态表
       → 刷新页面 GET /api/content-optimization/task/:id → 重放已完成事件，不重新调 AI
```

### 解析容错链（三段回退，必须实现）
`直接 json.parse → 提取 markdown ```json 代码块 → 截取首尾 {}`

### 数据落点
task 状态存 DB（复用 materials 或新表 `image_gen_tasks`）：`{taskId, pages[], generated[], failed[], coverRef, fullOutline}`；`images` 数组按索引对齐，合并时防空数组覆盖（保护性合并）。

### 验收
- 一句话 → 5 页图文全流程可跑通，SSE 逐事件更新
- 中途刷新页面 → 已完成图直接显示，**不重复调模型、不重复计费**
- 单测：三段解析容错各一例

---

## 4. P2 ｜ cookie 预检 409 阻断 + 批量失败平台短路（auto-upload 思路）

### 落点：`auto-upload.service.ts` / `auto-upload.client.ts`

### 4a. 发布前预检（抄 main.py 的 _check_publish_account_states 思路）
- 发布接口入口（含批量）先对所选账号做校验：
  - `getValidAccounts` 校验带 **TTL 缓存（1h）** + **Semaphore 并发 3**
  - 任一账号失效 → 返回 **409** `{ reason: 'account_preflight_failed', accounts: [{id, name, status}] }`，**不进入发布流程**
- 现状：我们已有 `validateCookieFile` 但无预检阻断，补上即可

### 4b. 批量失败短路（抄 postVideoBatch 的 failed_platforms）
- 批量发布循环中：某平台失败 → 记录 `failedPlatforms[]`，**该平台后续视频跳过**，其他平台继续
- 结束返回 `{ ok, successPlatforms[], failedPlatforms: [{platform, reason, screenshotPath?}] }`

### 验收
- 失效账号发布 → 409 且前端弹出"账号登录失效"提示，不产生发布任务
- 批量 3 平台、抖音失败 → 抖音不再重试，视频号/小红书正常发布

---

## 5. P2 ｜ 定时排期随机浮动 + 写后回读（auto-upload files_times.py 思路）

### 落点：`schedules/schedules.service.ts`（新增工具函数）+ 各平台发布器

### 5a. 排期器
```ts
export function generateScheduleTimes(
  baseTimes: Array<number | 'HH:mm' | Date>,  // 基准时间
  count: number,                              // 每天条数
  jitterMinutes = 0,                          // 随机浮动（分钟）
): Date[]  // 结果钳制在当天，不跨天
```
- 参考 files_times.py：每天 N 条 × 基准时间列表，`jitter_minutes` 随机浮动并 clamp 在 23:59 内

### 5b. 写后回读断言（防"定时没生效"静默失败）
- 抖音 datepicker：fill 时间后回读输入框值比对，不一致抛错
- 视频号：weui 日期控件遍历选择后回读选中项
- 其余平台先做"写入后读回 value 断言"，失败即抛错不静默

### 验收
- 排期器单测：3 条 × jitter=30 → 结果同天、差值≤30min、不越界
- 真机：抖音/视频号定时发布后，后台显示时间与设置一致

---

## 6. P3 ｜ 快手遮罩清理 + 小红书发布按钮评分定位（auto-upload 思路）

### 落点：各平台发布器（auto-upload 发布链路）

### 6a. 快手新手引导遮罩自动清理（抄 dismiss_creator_guide 思路）
- 识别特征：`ant-tour` / `driver.js` / `joyride` 相关 class/属性
- 处理：`DOM remove()` + 重置 `body pointer-events:''`，不阻塞输入

### 6b. 小红书发布按钮 DOM 评分定位（抄 promote_publish_click_target 思路）
- 候选：`xhs-publish-btn` WebComponent + 底部居中坐标 + **红色背景 rgb(255,36,66) 近似匹配**
- 激活：派发完整事件序列（mouseover→mousedown→mouseup→click），点击重试 3 次
- 现状：小红书发布已有部分逻辑，补评分+事件序列

### 验收
- 快手：带新手引导弹窗的账号能正常填表发布
- 小红书：改版后发布按钮 3 次重试内必中

---

## 7. 实施顺序与全局门禁

| 步 | 内容 | 依赖 | 交付 |
|---|---|---|---|
| 1 | P0 头像抓取 | 无 | 单测 + 真机看账号列表 |
| 2 | P1 发布前体检 | 无 | 单测 + 前端表单接入 |
| 3 | P1 图文流水线 | 无 | 单测 + 页面可跑 |
| 4 | P2 预检 409 + 短路 | 1 | 单测 + 真机失效账号 |
| 5 | P2 排期浮动 + 回读 | 无 | 单测 + 真机定时 |
| 6 | P3 遮罩 + 按钮评分 | 无 | 真机回归 |

**门禁（每步必过，过不了不回退）**：
- `npx tsc --noEmit` 零错误
- 新增单测全绿（每个能力至少 2 个用例）
- 对应平台真机回归一次（登录/发布/头像至少各验证一例）
- 新文件头含来源声明（见 §0）

**明确不做**（防止磨叽扩散）：
- 不移植 ss-media-tools 的 AI 模型注册表/前端（demo 级）
- 不移植 RedInk 的文案模板原文（非商用许可）
- 不移植 TikTok/百家号发布器（不在当前商用范围）
- 不照搬官方选择器原文（按现状重写）

---

## 8. 替换干净协议（防工程垃圾，替换类改动必过）

> 目的：替换旧实现时不留下死代码、遗留调用点、兼容胶水。每步都有自动门禁，不靠"记得删"。

### 8.1 自动化检测工具（已落地）
`backend/scripts/verify-clean-replace.mjs`（npm script：`npm run verify:clean-replace`）：
```bash
node scripts/verify-clean-replace.mjs \
  --symbols <旧符号1,旧符号2> \
  --allow <新实现文件路径> \
  --dirs backend/src,frontend/src
```
- 扫描所有 `.ts/.tsx/.js/.json/.md` 引用，报出 `file:line` 残留
- 白名单 `--allow` 放新实现文件（合法存在）；注释里的历史说明自动跳过
- 退出码：**0=干净，1=有残留**（可进 CI/发版前强制）

### 8.2 替换流程（四步门禁）
1. **替换前**：跑 detect 列出旧符号全量引用清单，逐个确认"删 / 迁 / 留"——留的必须给理由
2. **替换中**：新实现落地并接到调用点；旧实现**不先删**（保持编译绿），但确认不再被调用
3. **替换后（自动门禁，缺一不可）**：
   - `node scripts/verify-clean-replace.mjs --symbols <旧符号> --allow <新文件>` → **零残留**
   - `npx tsc --noEmit` → 零错误（顺带查未用变量）
   - 新增单测全绿
   - **git diff 审查**：替换类 commit 的删除行数应 ≥ 新增行数（纯替换不许留胶水层）；diff 里出现 `legacy`/`compat`/`旧名` 兼容分支 = 打回
4. **真机回归**：对应平台跑一次（登录/发布/头像）

### 8.3 定期体检（每轮发版前跑一次）
```bash
# 1. 未使用导出（死代码源头）
npx ts-prune -p backend/tsconfig.json 2>/dev/null | head -50 || echo "ts-prune 未安装则跳过"
# 2. 历史废弃标记扫描
node scripts/verify-clean-replace.mjs --symbols "已下线,已废弃,deprecated,legacy" --allow 无
# 3. 孤儿文件（git 已删但磁盘残留）
git ls-files --others --exclude-standard | grep -v node_modules | head -20
```

### 8.4 当前 P0 示例的残留清单（替换头像抓取时必须清零）
| 旧符号/旧逻辑 | 位置 | 处理 |
|---|---|---|
| `captureAccountIdentityBestEffort` | auto-upload.client.ts:4903（定义）、5030（调用） | 删除，调用点换 `captureAccountIdentity` |
| 整页截图当头像的 `page.screenshot({fullPage:false})` 分支 | 同函数内 | 删除 |
| 页面 title 当昵称的 `userName: title` | 同函数内 | 删除 |
| `PLATFORM_IDENTITY_SELECTORS` 若新旧重名 | identity-capture.ts vs 旧定义 | 统一只留新文件一份 |
| 历史注释（"5409 /refreshAccountAvatar 已下线"等） | 各文件 | 并入新注释，不留两层说明 |

---

## 9. 实施状态（2026-08-11 更新）

| 项 | 状态 | 说明 |
|---|---|---|
| §1 P0 头像三层抓取 | ✅ 完成 | commit a1baadd + 10b994e + d30c6a3 + a0c4cfb + 115f1f9 + f9713aa + 032adb1；含 avatarUrl 修复、刷新按钮、账号会话抓取、首页 URL、identity 日志 |
| §2 P1 发布前体检 | ✅ 完成 | commit 01ebb2b + a98215e；后端 preflight 接口 + 前端提交拦截，10 单测 |
| §3 P1 图文流水线 | ✅ 完成 | commit 6b4e6bb；prompts/ 外置（outline/content 两模板）+ outline.service 三阶段（/outline → /generate SSE → /task/:id 重放）+ image_gen_tasks 表 + 前端 /content/image-gen；10 单测 |
| §4 P2 cookie 预检+短路 | ✅ 完成 | commit ce8ef8e；短路已实现；4a 现有"失效账号跳过+引擎预检阻断"优于 409 全阻断（标注不再加） |
| §5 P2 排期浮动 | ✅ 完成(5a+5b) | commit 8dfd4a2（5a 排期器）；commit 3255c3d（5b 抖音/视频号定时写后回读断言，4 单测） |
| §6 P3 遮罩+按钮评分 | ✅ 完成(待真机回归) | commit（未推送）；快手遮罩清理扩到 ant-tour/driver.js/joyride + body pointer-events 重置；小红书发布按钮评分定位（xhs-publish-btn+底部居中+红底 rgb(255,36,66) 近似匹配+完整事件序列+重试 3 次）；3 单测。**DOM 层行为需真机验证** |
| §8 替换干净协议 | ✅ 完成 | verify-clean-replace.mjs |
