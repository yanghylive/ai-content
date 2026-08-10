# 本机（macOS）真实账号验收指引 · 2026-08-10

> 目标：本机完成「浏览器平台真实发布 + 真实执行」验收，解锁验收门禁 6/8 项 BLOCKED，并顺带验证本轮新功能。
> 不需要 Windows 机器；只需一个真实平台账号（抖音或视频号）扫码登录。
> 预计 30-45 分钟。

---

## 0. 前置条件检查（2 分钟）

```bash
# 1. 后端在跑（3011）
curl -s --noproxy '*' http://127.0.0.1:3011/api/health | head -c 80
# 期望：{"success":true,...,"ready":true...}

# 2. 前端在跑（3010）
curl -s --noproxy '*' -o /dev/null -w "frontend: %{http_code}\n" http://127.0.0.1:3010/

# 3. 发布账号表当前为空（预期，后面会登录）
sqlite3 "$HOME/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite" \
  "SELECT COUNT(*) FROM publish_accounts;"
```

如果后端没跑：
```bash
cd ~/Documents/New\ project/ai-content/backend
MASTER_KEY=$(cat "$HOME/Library/Application Support/ai-content-desktop/credential-master-key")
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  KAYPAL_CREDENTIAL_MASTER_KEY="$MASTER_KEY" \
  SQLITE_DATABASE_URL="file:/Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite" \
  node --enable-source-maps dist-bundle-sqlite/index.js
```

---

## 1. 登录真实平台账号（10 分钟）

### 方式 A：桌面端界面（推荐）
1. 打开前端 `http://127.0.0.1:3010`
2. 登录后进入「发布中心 → 平台账号」
3. 点击「添加账号 / 登录」，选择平台（**抖音 douyin**，登录链路最稳）
4. 弹出真实浏览器 → **手机扫码登录**
5. 登录成功后回到账号列表，等待状态变为「正常 / 已登录」（status=1）

### 方式 B：API 直开浏览器
```bash
# 打开抖音登录浏览器（二维码）
curl --noproxy '*' "http://127.0.0.1:3011/api/auto-upload/accounts/login?type=douyin"
# 扫码完成后查账号状态
curl --noproxy '*' "http://127.0.0.1:3011/api/auto-upload/accounts"
```

### 验证登录成功
```bash
curl --noproxy '*' "http://127.0.0.1:3011/api/auto-upload/accounts"
# 期望返回数组，含 status=1（正常）的抖音账号，记录其 id（如 publish-account-douyin-xxx）
```

> 可选：登录第二个平台（视频号 wechat-channel）做多平台发布验证。

---

## 2. 准备测试素材（5 分钟）

```bash
mkdir -p ~/Desktop/acceptance-material
# 放一张图片（推荐 1MB 内 JPG/PNG）：
#   ~/Desktop/acceptance-material/test-image.jpg
# 放一段短视频（可选，≤50MB MP4）：
#   ~/Desktop/acceptance-material/test-video.mp4
```
也可以用系统自带图片快速生成：
```bash
sips -s format jpeg -z 800 800 \
  "$HOME/Desktop/acceptance-material/test-image.jpg" 2>/dev/null || \
  python3 -c "
from PIL import Image
Image.new('RGB', (800, 800), (99, 102, 241)).save('$HOME/Desktop/acceptance-material/test-image.jpg')
print('测试图已生成')"
```

---

## 3. 跑验收门禁（10 分钟）

```bash
cd ~/Documents/New\ project/ai-content

env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NODE_OPTIONS \
  COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN=1 \
  API_BASE=http://localhost:3011/api \
  FRONTEND_URL=http://localhost:3010 \
  COMMERCIAL_REAL_EXECUTION=1 \
  COMMERCIAL_REAL_PUBLISH=1 \
  COMMERCIAL_APPROVE_PUBLISH=1 \
  COMMERCIAL_DOUYIN_ACCOUNT_ID=<上一步记录的账号 id> \
  COMMERCIAL_PUBLISH_MATERIAL_FILE="$HOME/Desktop/acceptance-material/test-image.jpg" \
  node scripts/commercial-acceptance-gate.mjs
```

**期望结果**：
```
Summary: PASS=50+ WARN=0 BLOCKED≈2 FAILED=0
```
解锁 6/8：`publishing center has no ready account` / `no local engine accounts` / `real publish submission` / `real execution gate` 等。

**剩余 BLOCKED**（预期保留）：
- 微信链路类（需 Windows 真机，见第五节）
- 其他未登录平台相关（如需可补登录）

---

## 4. 本机新功能验收（可选，10 分钟）

登录真实账号后，顺带验证本轮新功能：

### 4.1 AI 网页代操作（真实浏览器）
```bash
# 需要登录态 cookie，从浏览器复制 ai_content_session 后：
curl --noproxy '*' -X POST "http://127.0.0.1:3011/api/local-engine/browser/ai-action" \
  -H "Cookie: ai_content_session=<你的session>" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"打开 https://example.com 然后点击 登录 然后 截图"}'
# 期望：results 每步 ok:true + evidenceUrl 截图
```

### 4.2 商品视频带货文案（无需登录态验证逻辑）
```bash
curl --noproxy '*' -X POST "http://127.0.0.1:3011/api/video/product-copy" \
  -H "Content-Type: application/json" \
  -d '{"productName":"筋膜枪","sellingPoints":["静音","三档"],"price":199}'
# 期望：返回 title + copy + segments（分镜）
```

### 4.3 Token 用量追踪
```bash
curl --noproxy '*' "http://127.0.0.1:3011/api/usage/token" \
  -H "Cookie: ai_content_session=<你的session>"
# 期望：tokenCount/tokenLimit/remaining
```

### 4.4 POI 门店
```bash
curl --noproxy '*' -X POST "http://127.0.0.1:3011/api/poi" \
  -H "Cookie: ai_content_session=<你的session>" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试门店","city":"成都","category":"餐饮"}'
curl --noproxy '*' "http://127.0.0.1:3011/api/poi/report" \
  -H "Cookie: ai_content_session=<你的session>"
```

### 4.5 悬浮球（桌面端）
- 启动桌面应用（`npm run dev`），右下角出现圆形悬浮球
- 点击 → 输入指令 → 执行 → 看结果与截图证据

---

## 5. 本机验收范围边界

| 能力 | 本机(macOS) | 需 Windows 真机 |
|---|---|---|
| 抖音/视频号发布 | ✅ | - |
| 社交互动（评论/私信/曝光） | ✅ | - |
| AI 网页代操作 / 悬浮球 | ✅ | - |
| Token / POI / 商品视频 | ✅ | - |
| 微信 8 能力（联系人/群发/加友/朋友圈/自动回复） | ❌ | ✅（wx_key.dll + native runner 为 Windows 实现） |
| Windows 桌面安装包（NSIS） | ❌ | ✅ |

微信链路验收走既有流程：`Windows真机测试指引.md` + `win-acceptance-run.bat` + 证据回传清单。

---

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 登录后账号状态还是 expired | 发布中心点「刷新」，或重启后端；检查是否扫码后未等待回跳 |
| 门禁报 real publish 仍 BLOCKED | 确认 `COMMERCIAL_REAL_PUBLISH=1` + `COMMERCIAL_APPROVE_PUBLISH=1` + 素材路径存在 |
| AI 代操作报 401 | 用当前浏览器 session cookie（登录态），或先刷新登录 |
| 悬浮球不出现 | 桌面端设置 `hoverBallEnabled`（默认 true）；重启应用 |
| 门禁超时 | 真实发布/执行较慢（浏览器操作），把终端超时设大或后台跑 |

---

## 7. 交付确认清单

- [ ] 发布中心有 1+ 真实 ready 账号（status=1）
- [ ] 门禁 Summary：FAILED=0，BLOCKED 收敛到 ≤2（仅微信类）
- [ ] （可选）AI 代操作 / 商品视频 / Token / POI 各冒烟通过
- [ ] 测试数据清理：POI 测试门店、Token 测试消耗可留（无害）

完成后把门禁 Summary 截图/输出回传，即完成本机验收阶段。
