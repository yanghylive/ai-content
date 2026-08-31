# 自动更新 · 阿里云 OSS 版

> 用阿里云 OSS 当 update feed 服务器。`electron-updater` 走 `provider: 'generic'`，本质就是把更新包 + `latest.yml` 放在一个 HTTPS 桶里。

## 一、准备 OSS 桶（一次性）

### 1. 在阿里云控制台建桶

- 桶名：`kaypalai-updates`（或你喜欢的）
- 区域：`华东1（杭州）`（或你目标的）
- 读写权限：**公共读**（更新包要给所有用户下）
- 版本管理：**开**（误删可恢复）

### 2. 给桶加跨域规则（防止 web 端拉 yml 报 CORS）

OSS 控制台 → 桶 → 数据安全 → 跨域设置 → 创建规则：

```
允许来源:    *
允许 Methods: GET
允许 Headers: *
暴露 Headers: ETag, Content-Length, Content-Type
缓存时间:    0
```

### 3. 创建 RAM 子账号 + AccessKey（不要用主账号！）

RAM 控制台 → 用户 → 创建用户：
- 访问方式：**仅 OpenAPI**
- 附加策略：`AliyunOSSFullAccess`（或自定义更窄的 `oss:PutObject` on `acs:oss:*:*:kaypalai-updates/updates/*`）

记下：
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

### 4. 桶的公网 URL 格式

```
https://<bucket>.<region>.aliyuncs.com/<path>/
例: https://kaypalai-updates.oss-cn-hangzhou.aliyuncs.com/updates/
```

这就是 `AI_CONTENT_UPDATE_URL`。

---

## 二、本机配置（开发者 + 发布者）

```bash
cd desktop
cp .env.example .env
```

填 4 项：

```dotenv
OSS_ACCESS_KEY_ID=LTAI5t...
OSS_ACCESS_KEY_SECRET=xxx
OSS_BUCKET=kaypalai-updates
OSS_REGION=oss-cn-hangzhou
OSS_UPDATE_PATH=updates/
```

`AI_CONTENT_UPDATE_URL` 用户运行时用，发布时由 `release.js` 自动拼出来。

---

## 三、发布一个新版本

### 方法 A：本地手工发布

```bash
cd desktop

# 1. 升版本号
npm version patch    # 1.0.0 → 1.0.1
# 或: npm version minor / major

# 2. 构建 + 上传
npm run release
```

跑完会在终端打印：

```
Done. Update feed URLs:
  Windows  -> https://kaypalai-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml
  macOS    -> https://kaypalai-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest-mac.yml
  Linux    -> https://kaypalai-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest-linux.yml
```

只构建不上传：`RELEASE_PUBLISH=false npm run release`

只上传不构建（修了 yml 重新推）：
```bash
# 先手动 electron-builder 一次
npm run build:win
# 再单独上传
npm run upload:oss
```

上传守卫：`upload:oss` 只收集现有 `latest*.yml` 引用的产物，并固定按“安装包 → blockmap（Windows/macOS）→ feed”上传；feed 引用的安装包或 blockmap 缺失会直接失败，不会留下一个已经切流但无法下载的 feed。Linux 的 AppImage/deb 不生成同等 blockmap，因此只校验其 feed 和安装包。

发布完成后运行远端验收：
```bash
npm run release:verify
```

默认会检查 OSS 上 Windows、macOS、Linux 三条 feed、各自引用的安装包，以及 Windows/macOS blockmap，并核对版本、大小和 SHA-512。单平台构建调试时可显式缩小远端范围，例如 `RELEASE_VERIFY_FEEDS=latest.yml npm run release:verify`；正式发布不要设置该变量。

GitHub Actions 的三个平台上传完成后会自动执行无本地产物依赖的远端门禁：`npm run release:verify:remote`。它会检查三条 feed 与安装包的 HTTP 可读性和元数据一致性，任一平台漏传都会让发布工作流失败。

### 方法 B：GitHub Actions（推荐）

#### 1. 在 GitHub 仓库加 5 个 Secret

Settings → Secrets and variables → Actions → New repository secret：

| Name | Value |
|---|---|
| `OSS_ACCESS_KEY_ID` | LTAI5t... |
| `OSS_ACCESS_KEY_SECRET` | xxx |
| `OSS_BUCKET` | kaypalai-updates |
| `OSS_REGION` | oss-cn-hangzhou |
| `OSS_UPDATE_PATH` | updates/ |
| `AI_CONTENT_UPDATE_URL` | https://kaypalai-updates.oss-cn-hangzhou.aliyuncs.com/updates/ |

#### 2. 推 tag 触发

```bash
git tag v1.2.0
git push origin v1.2.0
```

3 个 runner（mac/win/linux）并行构建，每个 runner 跑完会自己上传自己平台的产物到 OSS。

**手动触发**（不发 tag）：

GitHub → Actions → Release desktop → Run workflow → 填 `channel=beta` 跑内部测试通道。

---

## 四、用户视角

发布后用户那边发生了什么：

```
用户电脑里 v1.0.0 在跑
  ↓
每 2 小时（或启动 5s 后）electron-updater 拉 https://.../updates/latest.yml
  ↓
发现 v1.2.0 > 1.0.0
  ↓
右下角出条："发现新版本 v1.2.0"
  ↓
用户点"立即更新" → 后台下载 v1.2.0（带 blockmap 断点续传）
  ↓
下载完 → 红条变绿条："已下载完成，立即重启"
  ↓
用户点"立即重启" → App 关 → 启动新版本
```

---

## 五、灰度发布（内部测试通道）

不改代码，发版本时用不同 channel：

```bash
# 给内部测试
RELEASE_CHANNEL=beta npm run release

# 用户那边：
# 装 latest 通道的，看不到 beta 更新
# 装 beta 通道的，先收到 beta 更新（生产环境用 latest）
```

切换通道在客户端那边装新版时通过 `installer --channel=beta` 切（需要 NSIS 自定义，**先不做，默认都是 latest**）。

---

## 六、常见问题

### 桶 403 / 找不到文件

去 OSS 控制台 → 文件管理 → 看 `updates/latest.yml` 是否存在 → 权限 → 公共读开了吗。

### 用户报"当前已是最新"但其实有新版

1. 看 `latest.yml` 里 `version` 字段是不是比用户装的版本大
2. 看 `AI_CONTENT_UPDATE_URL` 用户本地是不是设错了（看 `app.getVersion()` vs yml）
3. 看 electron-updater 日志（`%AppData%/Roaming/KaypalAI内容创作平台/logs/main.log`）

### 旧版本残留太多

```bash
# 列出版本
ossutil ls oss://kaypalai-updates/updates/

# 删掉 30 天前的（先备份）
ossutil rm oss://kaypalai-updates/updates/ --versions --exclude "*latest*"
```

### CDN 加速

OSS 跨区慢的话，开 OSS CDN：

1. 阿里云 CDN 控制台 → 添加域名 `updates.your-domain.com`
2. 回源 `kaypalai-updates.oss-cn-hangzhou.aliyuncs.com`
3. 把 `AI_CONTENT_UPDATE_URL` 改成 `https://updates.your-domain.com/updates/`

---

## 七、不做（暂时）

| 项 | 何时做 |
|---|---|
| 代码签名（Windows EV 证书 / macOS notarization） | 上架商店或被 Defender 大量拦截时 |
| 多 channel 客户端切换 | 团队 > 50 人要分批灰度时 |
| 自动清旧版本 | OSS 满了再说（OSS 1 毛/GB/月很便宜） |
| Windows 安装包里的内嵌 update URL | 装了之后用户自己改 `%AppData%/.../config.json` |
