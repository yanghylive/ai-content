# 桌面端自动更新落地记录 2026-06-12

## 当前结论

本地安装包必须带真实 HTTPS 更新源。当前默认更新源统一为：

```text
https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/
```

客户端仍然支持用 `AI_CONTENT_UPDATE_URL` 覆盖默认地址，方便以后切到独立域名或 115 服务器。

## 本次改动

- `desktop/package.json`
  - `build.publish.url` 从空值改为 Kaypal OSS 更新源。
  - 新增 `npm run upload:ssh-updates`，用于把更新包推到自建服务器。
- `desktop/scripts/check-update-feed.js`
  - 支持从 `AI_CONTENT_UPDATE_URL` 或 `package.json build.publish.url` 读取更新源。
  - 阻止 HTTP、空地址和占位域名。
- `desktop/scripts/release.js`
  - 发布前强制跑更新源校验。
  - 没有传环境变量时，也会把 `package.json` 的默认 URL 写入 electron-builder。
- `desktop/scripts/upload-to-oss.js`
  - 默认 bucket 改为 `kaypal`，只要求传 OSS AccessKey。
- `desktop/scripts/upload-to-ssh-updates.sh`
  - 默认目标：`root@115.29.184.180:/var/www/kaypal-ai-content-updates`。
  - 用于服务器 SSH 可用后部署同一批 `latest*.yml`、安装包和 blockmap。
- `.github/workflows/release-desktop.yml`
  - GitHub Actions 三个平台都先构建 SQLite 后端 bundle。
  - 前端构建固定 `NEXT_PUBLIC_API_BASE=http://localhost:3011/api`。
  - Windows、macOS、Linux 构建完成后分别上传到 OSS 更新源。

## 验证命令

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
npm run release:check
RELEASE_PUBLISH=false RELEASE_TARGETS=mac npm run release
cat dist/mac-arm64/KaypalAI内容创作平台.app/Contents/Resources/app-update.yml
```

期望 `app-update.yml` 包含：

```yaml
provider: generic
url: https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/
```

## 115 服务器状态

用户提供：

```text
root@115.29.184.180:22
```

之前已用本机 `~/.ssh/kaypal_ragflow_deploy` 登录成功，并已把本地 `dist/` 中的更新文件上传到：

```text
/var/www/kaypal-ai-content-updates
```

已核对 `latest-mac.yml` 和 mac zip 的本地/服务器 SHA256 一致。

但这台服务器没有 Nginx，`80/443` 也没有监听；2026-06-12 复查时 SSH 22 端口还出现连接超时。因此 115 目前只能作为待恢复的备用文件落点，不能作为客户端正式自动更新源。

如果以后要把它正式变成更新源，需要先配置域名、HTTPS 和静态目录映射。文件上传命令：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
UPDATE_SSH_KEY=$HOME/.ssh/kaypal_ragflow_deploy \
UPDATE_SSH_HOST=root@115.29.184.180 \
UPDATE_SSH_DIR=/var/www/kaypal-ai-content-updates \
npm run upload:ssh-updates
```

随后在服务器 Nginx 上把该目录映射成 HTTPS `/updates/`，再把 `AI_CONTENT_UPDATE_URL` 切到对应域名。

## 已闭环结果

- GitHub Actions release run 已成功：

```text
https://github.com/yanghylive/ai-content/actions/runs/27414275892
```

- OSS 自动更新入口已全部更新到 `1.1.10`：

```text
https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml
https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest-mac.yml
https://kaypal.oss-cn-hangzhou.aliyuncs.com/updates/latest-linux.yml
```

- 桌面已放置正式自动更新源对应的安装包：

```text
/Users/yanghy/Desktop/KaypalAI内容创作平台-1.1.10-win-x64-autoupdate.exe
/Users/yanghy/Desktop/KaypalAI内容创作平台-1.1.10-arm64-mac-autoupdate-oss.zip
```

- 桌面文件已按 OSS feed 校验 SHA512 和 size：

```text
Windows sha512: gBupGUOpVMiNPjtO71z4vA8d6GPsj950Tws1qB0I2gYsGQqhJHLeXj73gy3SScntQBQMK0Hsj2mfWX5eNAeJoQ==
Windows size: 273793176
Mac sha512: A52y2M6a2xXkP97I8fxXY4YRtJRArfmdDmzSge3d368Ru/rN2uRVCD+3bgaods3DKJc1TAtby2KFPBMGRBRCQg==
Mac size: 324398404
```

## 还没有闭环的事

- 115 服务器还没有公网 HTTPS 静态服务，当前也出现 SSH 超时，不能直接作为 `electron-updater` feed。
- GitHub Actions 提示 Node 20 actions 将在 2026-09-16 移除，需要后续升级 workflow actions/runtime 策略；不影响本次 1.1.10 自动更新包。
