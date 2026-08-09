# 演示舱模块开发契约（写 demo 前必读）

> **一句话**：demo 是**能力证明**，不是**产品功能**。默认关闭、默认剔除、禁止生产使用。

---

## 1. 什么时候需要 demo 舱

- 对标竞品（如炼刀 AI 员工）的个人微信自动化 / 曝光刷量等**不合规但需证明能力**的功能
- 需要向投资人/客户展示"我们能做"但**不能上线**的功能
- 需要内部验证某技术路线可行性但**不准备商用**的功能

## 2. demo 代码的 5 条铁律

### 铁律 1：物理隔离
- 所有 demo 代码置于 `**/demo/**` 目录或 `*.demo.ts(x)` 后缀
- 不得与 production 模块同目录混编
- 仓库根永久保留 `DEMO_MODULES_DISCLAIMER.md`

### 铁律 2：运行时门禁
- 前端：`if (!isDemoModeEnabled()) return disabledUI()`
- 后端：`requireDemoMode()` 守卫每个 demo controller/service
- 任何 demo 功能必须可通过 `ENABLE_DEMO=false` 完全关闭

### 铁律 3：零真实凭证 / 零真实目标
- 禁止 import 生产凭证模块（`KAYPAL_CREDENTIAL_MASTER_KEY` 体系）
- 仅读取 `demo/fixtures/*.json` 合成数据
- 自动化目标为本地 mock 服务（如 `http://127.0.0.1:9xxx/we_chat/mock`）
- **绝不连真实微信/抖音/小红书/TikTok**

### 铁律 4：UI 水印与日志
- 任何 demo 界面顶部常驻红字 Banner：「⚠ 演示模式 · 不合规功能 · 禁止生产使用」
- 日志统一前缀 `[DEMO-MODE][NON-COMPLIANT]`

### 铁律 5：不实现对抗性逻辑
- 即便在 demo 中，也不实现可绕过平台风控的对抗性逻辑到可运行程度（如伪造设备指纹、协议级逆向）
- demo 仅展示 UI / 流程编排，底层用 mock

---

## 3. 写 demo 的 4 步走

### Step 1：先读文档
- 本文件（`DEMO_MODULE_CONTRACT.md`）
- `DEMO_MODULES_DISCLAIMER.md`
- 合规边界确认书 v2 第五节

### Step 2：写代码
```typescript
// 前端示例
import { isDemoModeEnabled, logDemoModeBanner } from '@/lib/demo/isDemoModeEnabled';

export function DemoWechatPersonalPanel() {
  if (!isDemoModeEnabled()) {
    return <div className="demo-disabled">演示模式未开启</div>;
  }
  logDemoModeBanner('wechat-personal');
  return (
    <div className="demo-panel">
      <div className="demo-banner">⚠ 演示模式 · 不合规功能 · 禁止生产使用</div>
      {/* demo UI */}
    </div>
  );
}
```

```typescript
// 后端示例
import { Controller, Get } from '@nestjs/common';
import { requireDemoMode } from '@/lib/demo/demo-mode';

@Controller('demo/wechat-personal')
export class DemoWechatPersonalController {
  @Get('status')
  getStatus() {
    requireDemoMode();
    return { status: 'demo-mode', mock: true };
  }
}
```

### Step 3：准备 fixture
```json
// demo/fixtures/wechat-contacts.json
[
  { "wxid": "demo_user_001", "nickname": "演示用户A", "remark": "mock" },
  { "wxid": "demo_user_002", "nickname": "演示用户B", "remark": "mock" }
]
```

### Step 4：自检 + 提交
```bash
npm run demo:check   # 本机自检
npm run demo:guard   # CI 守门（与 CI 一致）
```

---

## 4. Code Review 检查清单

- [ ] demo 代码在 `**/demo/**` 或 `*.demo.ts(x)`？
- [ ] 有 `isDemoModeEnabled()` / `requireDemoMode()` 守卫？
- [ ] 无真实凭证 / 真实账号 / 真实平台域名？
- [ ] UI 有红字 Banner？
- [ ] 日志有 `[DEMO-MODE]` 前缀？
- [ ] fixture 是纯 mock 数据？
- [ ] `DEMO_MODULES_DISCLAIMER.md` 已读？

---

## 5. 常见错误

| 错误 | 后果 | 修复 |
|---|---|---|
| production 文件 import demo | CI 守门失败 | 把 demo 代码移到 `**/demo/**` 或 `*.demo.ts(x)` |
| demo 里写真实微信 API 地址 | CI 守门失败 | 改为本地 mock 端点 |
| 忘记加 `requireDemoMode()` | 生产环境可能暴露 demo | 加守卫 |
| 用 `KAYPAL_CREDENTIAL_MASTER_KEY` 加密 demo 数据 | 违反零真实凭证 | 改用 mock 数据 |
| release 构建时 `ENABLE_DEMO=true` | CI 守门失败 | release 强制 false |

---

## 6. 演示舱 vs 生产轨对照

| | 生产轨（Tier 1） | 演示舱（Tier 2） |
|---|---|---|
| 微信 | 企业微信（官方 API） | 个人微信 RPA 流程编排（mock） |
| 曝光获客 | 数据看板 / 转化漏斗 | 自动化操作（刷量等，mock） |
| 能否上线 | ✅ 可服务真实客户 | 🚫 禁止生产使用 |
| 凭证/目标 | 真实 + master key 加密 | 零真实凭证，只跑本地 mock |
| 默认状态 | 始终开启 | 默认关闭，仅本机可临时开启 |

---

## 7. 临时启用流程（演示时用，验证后必须还原）

> demo 模块**默认不注册**（`no-demo-in-prod` 规则禁止 production 文件 import demo——这是"默认剔除"的合规设计，production 构建无 demo 路由）。**演示前**按下面 4 步临时开启，**演示完** git checkout 还原。

### 后端（两步）

1. **临时注册 DemoModule**（违反 guard 规则，仅演示期间允许）：
   ```typescript
   // backend/src/app.module.ts
   import { DemoModule } from './demo/demo.module';   // 加 import
   // imports 数组里加：
   DemoModule,
   ```
   ⚠️ 改完 `npm run demo:guard` 会红——这是预期的，演示后还原即绿。
2. **开启 demo 模式**（后端运行时守卫）：
   ```bash
   ENABLE_DEMO=true DEMO_OVERRIDE_TOKEN=<32位随机> npm run start:dev   # 或部署时注入 .env
   ```

### 前端（一步）

3. **构建期开启 demo flag**：
   ```bash
   NEXT_PUBLIC_ENABLE_DEMO=true npm run build   # demo 页面才会渲染（否则 disabled 提示）
   ```

### 验证

4. 访问 `/demo/video-studio`（登录后），确认红字 Banner「⚠ 演示模式 · 不合规功能 · 禁止生产使用」。

### 还原（强制）

```bash
git checkout backend/src/app.module.ts   # 撤销临时注册（guard 恢复绿）
# 后端 .env 移除 ENABLE_DEMO / DEMO_OVERRIDE_TOKEN
# 前端用默认构建（无 NEXT_PUBLIC_ENABLE_DEMO）
```

**8-04 / 8-06 实战记录**：`AppModule` 曾从未注册 DemoModule（wechat-personal demo 路由一直是 404）；演示舱模块一律放 `backend/src/demo/`（勿建 `src/modules/demo/` 第二份——2026-08-06 已清理孤儿）；fixtures 是运行时读文件，build 后需拷进 `dist/demo/fixtures/`（tsc 不编译 .json）。

**📅 维护历史**：
- 2026-07-30 22:24 — v1 吴八哥首版，基于合规边界确认书 v2 第五节
- 2026-08-06 11:30 — v2 增补 §7 临时启用流程（demo 默认不注册的合规说明 + 4 步启用/还原）
