# 真实账号验收指引（2026-08-10）

> 背景：验收门禁 PASS=50 / BLOCKED=8，剩余 8 项全部是**真实账号环境**问题（代码链路已就绪）。
> 本文档给出登录真实账号 → 跑通门禁的完整步骤。预计 30 分钟。

## 一、需要准备

| 资源 | 用途 | 是否必需 |
|---|---|---|
| 抖音测试账号（可扫码登录） | 发布中心 ready 账号 + 真实发布验收 | 必需（至少 1 个） |
| 视频号/小红书账号（可选） | 多平台发布验收 | 可选 |
| 一个测试发布素材（图片/视频） | 真实发布提交 | 发布验收必需 |
| 本机微信桌面版（可选） | 微信链路真机验收 | 可选（需 Windows 真机） |

## 二、登录真实账号（发布中心）

两种方式任选：

### 方式 A：桌面端界面登录（推荐）
1. 启动桌面应用（或 `npm run dev`）
2. 进入「发布中心 → 平台账号」
3. 点「添加账号/登录」→ 选择平台（如抖音）
4. 真实浏览器打开登录页 → 扫码登录 → 等待账号状态变为「正常/已登录」
5. 验证：`GET /api/auto-upload/accounts` 返回该账号且 `status=1`

### 方式 B：API 直开浏览器
```bash
# 打开抖音登录浏览器（二维码）
curl "http://127.0.0.1:3011/api/auto-upload/accounts/login?type=douyin"
# 扫码登录完成后，刷新账号列表确认 ready
curl "http://127.0.0.1:3011/api/auto-upload/accounts"
```
登录接口链路：`GET /api/auto-upload/accounts/login`（打开真实浏览器）→ 登录态写入
`publish_accounts`（status=ready）→ 门禁自动识别。

## 三、跑验收门禁（登录后）

```bash
cd ~/Documents/New\ project/ai-content

env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN=1 \
  API_BASE=http://localhost:3011/api \
  FRONTEND_URL=http://localhost:3010 \
  COMMERCIAL_REAL_EXECUTION=1 \
  COMMERCIAL_REAL_PUBLISH=1 \
  COMMERCIAL_APPROVE_PUBLISH=1 \
  COMMERCIAL_DOUYIN_ACCOUNT_ID=<登录后的账号 id> \
  COMMERCIAL_PUBLISH_MATERIAL_FILE=<测试素材路径> \
  node scripts/commercial-acceptance-gate.mjs
```

## 四、BLOCKED=8 逐项解锁对照

| BLOCKED 项 | 解锁动作 |
|---|---|
| publishing center has no ready account | 登录真实平台账号（第二节），账号状态变 ready |
| no local engine accounts in unified publish accounts | 同上（账号入库后自动同步） |
| real publish submission not acknowledged | 设置 `COMMERCIAL_REAL_PUBLISH=1` + `COMMERCIAL_APPROVE_PUBLISH=1` + 提供素材 |
| real execution gate not acknowledged | 设置 `COMMERCIAL_REAL_EXECUTION=1`（确认用测试账号） |
| 微信链路相关 BLOCKED | 需 Windows 真机 + 微信登录（见 `docs/wechat-liandao-parity-handoff-2026-06-28.md`） |

## 五、已知边界

- **发布中心账号状态刷新**：登录后如有延迟，可在界面点「刷新」或重启后端
- **素材要求**：`COMMERCIAL_PUBLISH_MATERIAL_FILE` 指向本地图片/视频（≤50MB）
- **不造假**：门禁不允许伪造 ready 账号；必须真实登录（DISPATCH_MOCK 设计为硬失败）

## 六、预期结果

解锁后应达到：**PASS 全绿，BLOCKED 收敛到仅剩微信真机项**（Windows 微信真机为独立验收阶段）。
