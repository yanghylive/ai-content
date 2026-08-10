# ai-content 分支交接 · codex/content-workspace-20260721

> **写给接手同事**：拉代码 → 看本文档 → 跑起来 → 继续干。
> 生成日期：2026-08-09 · 对应 GitHub 最新 HEAD：`37b9f39a`

---

## 1. 这个分支是什么

- **仓库**：`git@github.com:yanghylive/ai-content.git`（JIUZHANG AI 内容创作平台，全栈单体仓）
- **分支**：`codex/content-workspace-20260721`（当前主力开发分支，日常提交都往这推）
- **技术栈**：Next.js 16（frontend）+ NestJS（backend）+ Electron（desktop）+ Postgres/SQLite 双模式 + PWA/APK（mobile）
- **最近 21 个提交**（相对上一个远程基线 `c8bc5eb3`）覆盖：移动端安卓适配、省钱返利 H5 改版、桌面端发布与登录修复、单入口架构改造、认证/AI 链路调整、MemoryCore 记忆层接入。

**一句话版本故事**：这段时间的核心是把产品从「桌面优先」推向「移动端可用的完整形态」——安卓适配（P0/P1/P2）+ 省钱返利 H5 全面改版 + 桌面端登录/发布链路的稳定化收尾。

---

## 2. 最近 21 个提交做了什么（按功能域）

### 📱 移动端（PWA + APK）
| 提交 | 内容 |
|---|---|
| `c4568bdd` | **修复：命令面板 FAB 与 AI 助手浮球右下角重叠**——两个 fixed 圆钮定位打架（right:18 且 bottom 只差 2px），橙球（命令面板）上移至 bottom:140 与金球（AI 助手）错开 12px |
| `ba4521dc` | **修复：微信登录 404**——按钮此前用相对路径打到静态服务触发 not-found；改 `getApiBase()` 拼绝对地址直连 3011（生产回落同源 /api），版本升 1.1.68 |
| `94e26544` | 安卓适配 P0：快捷键入口、触控目标（≥44px）、增长只读工作台 |
| `327ddfa6` | 安卓适配 P1：APK 内不渲染管理端（admin 后台重定向） |
| `6feaa440` | 安卓适配 P2：growth-v2 6 个子页移动端只读分流 |
| `7c58a7c6` | 重构：统一 `MobileTabBar` 组件（P2 架构沉淀，5 Tab 导航 URL 驱动） |

### 💰 省钱返利（savings H5）
| 提交 | 内容 |
|---|---|
| `962a1777` | savings 增长能力与数据增强（P2/P3） |
| `0763d9d2` | **savings H5 全面改版**（P0/P1 架构重构 + P2/P3 能力）——主要页面与交互重构 |
| `d30b433b` | 首页分类导航 + 默认商品流（P3-2） |
| `c2cf2bcb` | 修复：凭证缺失时分类错误显示「网络波动」→ 改为「凭证未配置」 |
| `7e7e26a9` | 瀑布流卡重设计 + B 端客群分类 + 美团纳入分类 |

### 🖥️ 桌面端（Electron）
| 提交 | 内容 |
|---|---|
| `dcff2f47` | **发布 v1.1.65**：新 Windows 安装包 + 同事测试指引（计费统一后多模态/语音链路全通） |
| `0ddec669` | **登录授权 4 项修复**：①确认页按钮走系统浏览器 ②复制授权码走主进程原生剪贴板 ③「记住账号和密码」（safeStorage 加密）④本地账号登录后自动绑定 kaypal 云账号（否则模型台/语音全授权失败） |
| `72be025d` | 修复：启动崩溃——`setupIPC` 里 `shell:open-external` 重复注册 |
| `c451443d` | **发布 v1.1.66**：登录授权 4 项修复后的新安装包；prepare-media-tools 加缓存避免 GitHub 下载超时中断构建 |
| `e4c2229f` | **单入口架构改造 v1.1.70**（重点，见下节） |

### 🔐 认证 / AI 链路
| 提交 | 内容 |
|---|---|
| `4e8f963d` | **test 共用生产账号**：桌面/本地认证切生产 `KAYPAL_AUTH_BASE_URL=kaypal.cn`（微信回调域名已白名单）；AI 模型台独立 `KAYPAL_AI_PROXY_BASE_URL` 继续走 test 网关；补 `KAYPAL_AI_PROXY_API_KEY`（此前桌面 AI 一直缺 key） |

### 🧠 记忆层 / 其它
| 提交 | 内容 |
|---|---|
| `6f030dd0` | 接入 **MemoryCore**（TencentDB Agent Memory）远端记忆层 |
| `635274c3` | 修复：content-strategies 路由顺序——静态路由 `industries/templates` 被 `:id` 捕获导致 404（NestJS 按声明序匹配） |
| `e54836f9` | docs：测试指引更新至 1.1.67（含启动崩溃热修复说明） |
| `37b9f39a` | chore：gitignore 忽略安装包解压产物（超 GitHub 100MB 上限，历史已重写清理，见 §6） |

---

## 3. ⭐ 重点：单入口架构改造 v1.1.70（e4c2229f）——改代码前必读

这是最近一次架构级改动，**影响前端 API 请求的写法**，接手同事务必先理解：

**改动内容**：
1. **桌面内置静态服务加 /api 反代**（`desktop/main.js` 的 `proxyApiToBackend`）：透传 method/headers/body，后端未起时返回 502 + 中文提示，不再裸奔到 3011。
2. **本地 3010 换用 `scripts/serve-static.mjs`**（新脚本）：反代 3011 + `.html` fallback + SPA 回退，修复了原脚本的正则 bug。
3. **`getApiBase()` 简化**（`frontend/src/lib/api/client.ts`）：默认同源 `/api`；只保留两种例外——非 loopback 域名直连、next-dev 模式直连。
4. **桌面构建注入 `NEXT_PUBLIC_API_BASE=/api`**。
5. **打包守卫反转**：`assertFrontendApiBase` 改为「产物不得含绝对 3011 字面量 + 必须含同源默认」，双向验证（旧产物 FAIL / 新产物 PASS）。

**对你的影响**：
- 前端代码里**不要再写死 `http://127.0.0.1:3011`** 之类的绝对地址拼 API——一律走相对 `/api`（同源反代）。
- 本地起前端用 `scripts/serve-static.mjs`（起在 3010），而不是裸 `serve out`。
- 桌面构建产物必须含同源 `/api` 默认，打包守卫会校验。

---

## 4. 怎么跑起来

### 4.1 环境变量清单（缺哪个起不来，见 `desktop/backend.env` 全量）

| 变量 | 用途 | 来源 |
|---|---|---|
| `KAYPAL_CREDENTIAL_MASTER_KEY` | 凭据主密钥，后端必填 | `~/Library/Application Support/ai-content-desktop/credential-master-key` |
| `SQLITE_DATABASE_URL` | sqlite 桌面库路径 | 桌面模式用（`~/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`） |
| `KAYPAL_AUTH_BASE_URL` | 认证基址（当前 = `kaypal.cn` 生产） | desktop/backend.env |
| `KAYPAL_AI_PROXY_BASE_URL` / `KAYPAL_AI_PROXY_API_KEY` | AI 模型台代理（test 网关） | desktop/backend.env |
| `MEMORY_CORE_BASE_URL` / `MEMORY_CORE_USER_KEY` | MemoryCore 记忆层 | 启动时注入 |
| `HAODANKU_APIKEY` | 好单库（省钱返利数据源） | 启动时注入 |

### 4.2 启动命令（macOS）

```bash
# 后端（3011）——必须先清代理和 NODE_OPTIONS，否则起不来/请求 400
cd backend
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  KAYPAL_CREDENTIAL_MASTER_KEY=$(cat ~/Library/Application\ Support/ai-content-desktop/credential-master-key) \
  npm run start:dev

# 前端静态服务（3010）——走新的 serve-static 脚本（反代 3011 + .html fallback）
cd frontend
npm run build          # 生产构建出 out/
node ../scripts/serve-static.mjs
```

### 4.3 桌面端（Electron）

```bash
cd desktop
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE \
  ELECTRON_DISABLE_SANDBOX=1 NODE_ENV=development npm run dev
```

### 4.4 移动端（PWA）

- 入口：`https://aicontent.vip.kaypal.cn/today`（注意不是 app.jiuzhangai.com）
- 本地模拟器验证：`adb -s emulator-5554`（模拟器 jztest34，坐标 y×1.9）

---

## 5. 怎么继续干（纪律）

1. **拉分支**：`git fetch origin && git checkout codex/content-workspace-20260721`
2. **先跑通再改**：按 §4 起后端 + 前端，访问 3010 走一遍核心链路。
3. **代码质量门**（集中 `quality-gates.yml`，CI 会跑）：
   - 前端/后端 `npm run lint:strict`（max-warnings=0，**新代码必须干净**）
   - `npm run typecheck`（tsc --noEmit）
   - demo 相关改动必须过 `demo-guard`
   - ⚠️ `next.config.ts` 的 `typescript.ignoreBuildErrors` 必须保持 `false`（类型错误挂掉是预期护栏）
4. **客户交互红线**（`AGENTS.md`，改 workbench/wechat 相关代码前必读）：Agent-S 必须是桌面客户交互主执行器；auto-send 是默认模式；任何把 Agent-S 移出执行路径的改动都要先问。
5. **git 纪律**：
   - `git add` 只用精确路径（**目录通配会误收 PID/大文件/遗留脚本**——上次 890MB 安装包解压产物就是这么进历史的）
   - 重要 WIP 绝不 stash（隐形区易忘），开 feature 分支 commit 起来
   - push 前 `git fetch` 确认无并行提交在途；push 偶发超时用 `GIT_SSH_COMMAND="ssh -o ConnectTimeout=40 -o ServerAliveInterval=20"`

---

## 6. 已知坑（踩过，别重踩）

| 坑 | 现象 | 对策 |
|---|---|---|
| **sqlite bundle 缺表** | 改 postgres `schema.prisma` 后，桌面库核心接口**静默 500** | 必须同步 `schema.sqlite.prisma` + 给桌面库手动补表（rebate_*、content_strategies 等 10 张表那次就是这么补的） |
| **NestJS 路由顺序** | `@Get(':id')` 吞掉后面声明的静态路由 → 404 | 静态路由放在 `:id` 之前（`content-strategies.controller.ts` 有注释警示） |
| **CORS 白名单** | 测试端口不在白名单 → 页面 API 全被拦跳登录 | 后端只放行 localhost 3000-3015/3721；测试用 route 转发（**转发不带 Origin 头**） |
| **3010/3421 是静态服务** | 改源码 CSS/JS 不生效 | 必须重新 `next build` 出 out/ 再刷新（不是 dev 热更新） |
| **Playwright 会话注入** | node execSync 引号嵌套会剥 SQL 引号 → 插不进会话 | 用 python sqlite3 插 `user_sessions`（token_hash = sha256(token)） |
| **GitHub 大文件硬限** | push 被 pre-receive hook 拒 | >100MB 文件（如安装包解压产物）绝不入库；已加 gitignore 规则 |
| **bash `$VAR` 后跟全角括号** | 变量名解析异常 | 用 `${VAR}` |

---

## 7. 遗留事项 / 可继续的方向

- **VSigntool 73MB warning**（非阻塞）：`docs/acceptance-evidence-2026-06-21/.../codesign-assets/` 下两个 VSigntool 安装包超 GitHub 建议 50MB 但未超 100MB 硬限，push 只警告。后续可选移 LFS 或剔除。
- **移动端多账号矩阵「8 失败」未修复**：根因 = `GET /auto-upload/accounts?validate=1` 强制 validate 把所有账号打成 `sessionStatus=error`，与 `/health` 的 `readyAccounts:7` 矛盾。修法：validate 路径无副作用 + 前端消费 health。（详见 `mobile/` 相关记录）
- **云端/真实资源待办**：C2 云端额度状态机、C4 计费验收（需真实账号）、B3 真实发布回读、B4 互动闭环、E 真人测试（真实账号 + Windows 真机）。
- **savings 数据源**：好单库（HAODANKU_APIKEY）为真实数据源，测试时注意凭证状态展示。

---

*本文档随分支更新。接手同事若发现描述与实际不符，请更新本文档并 commit。*
