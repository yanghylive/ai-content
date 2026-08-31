# ai-content 发布门禁 & CI 修复交接（2026-08-31）

> 交接人：二狗（WorkBuddy 会话，工作区 jz-ai-guard）
> 接手人：ai-content 线程（Codex/大壮 或其他会话）
> 目的：让 ai-content 线程无缝接手"发布门禁 + CI 发布路径"的剩余工作。
> 状态核对基准：HEAD `75f3276b`，工作区未提交改动仅 memory/docs（接手线程自己的工作流，勿动）。

---

## 一、任务背景（为什么有这摊事）

1. 九章AI管家（jz-ai-guard）v0.3.1 发布时沉淀了 3 条跨项目铁律：
   - **release body 签名必须与 OSS manifest 一致**（备用更新链路按平台取签名）
   - **flip 必须连安装包一起翻**（daemon 主通道下载 `updates/latest/<file>`，只翻 manifest = 全量升级 404）
   - **写 API 鉴权后验证脚本必须带 token**
2. 大王让检查 ai-content 桌面端发布脚本是否有同类问题 → 检查发现：
   - upload-to-oss.js 已在 2026-08-27 整改（三通道 feed 引用收集 + blockmap 补传）✅
   - **verify-oss-release.js 只查 Windows 通道，Mac 通道是盲区**（Mac 漏传 verify 发现不了）→ P1
   - 上传顺序不可控（yml 可能先于安装包到位）→ P2
3. 大王已按方案落地主修复（release-feed-plan + upload-to-oss 三通道 + verify 三通道 + CI 门禁），见 `0d303720`；本线程（大壮）在其上完成 CI 发布路径修复（`3d5233e8`/`3137f5a5`/`75f3276b`）并补交交接文档。

## 二、已完成（含 commit 与验证证据）

| commit | 内容 | 验证 |
|---|---|---|
| `0d303720` | **主修复**：release-feed-plan（上传计划，安装包→blockmap→feed 排序 + fail-closed）、upload-to-oss 三平台 feed + OSS_UPLOAD_FILES、verify-oss-release 三通道 remote-only、release-desktop.yml 加 verify job（含 Linux，后被 27ed9ece 移除）、Mac 兜底统一 buildUploadPlan | release-feed-plan.test.js 4/4 |
| `3d5233e8` | **Windows checkout invalid path 修复**：验收证据截图文件名内嵌换行符（`window-283059\n283039\n...png`）→ Windows git checkout 挂死 → 整个 workflow 失败（**v1.1.99 至今 CI 发布从未跑通的根因**）。已改名 `window-283059-multi.png`，全仓库 -z 扫描确认仅此 1 个 | - |
| `3137f5a5` | **CI 发布路径两老坑**：① workflow `NEXT_PUBLIC_API_BASE` 写死绝对 3011 → 改 `/api`（同源，check:full-installer-assets pre 抓出）；② Octop sidecar CI 现场生成方案（uv 装 octop==0.9.26 + Python 3.12 + chromium-headless-shell） | 本机模拟全链路通过（见 §五） |
| `75f3276b` | **EEXIST 根治**：extraResources 7 个 from 项写入同一 `backend/node_modules/`（@playwright/mcp、playwright、playwright-core、sharp、@img、detect-libc、semver）→ electron-builder 同目标多 from hardlink 冲突（CI 干净环境必现）→ **合并为单 from + filter 子目录**；win octop venv 步骤内 PATH 立即 export（GITHUB_PATH 只对后续步骤生效） | **本机清 dist 跑 `electron-builder --mac --dir`：打包成功无 EEXIST**，@img 全子包（darwin-arm64 + win32-x64）+ sharp + octop sidecar 完整进包 |

## 三、线上现状（2026-08-31 16:58 核对）

- `latest.yml`（Win）：**1.1.108** ✅ 可读
- `latest-mac.yml`（Mac）：**1.1.108** ✅ 可读
- `latest-linux.yml`：**1.1.107** ✅ 可读（AppImage 384MB + deb 265MB + blockmap 全 200）
  - **大王决策**：Linux 非发布目标（`27ed9ece` 移除 ubuntu job/build:linux/Linux 上传，verify 双通道）；**Linux 1.1.107 保留为最后一代**（不删、不再发）
  - 此前 1.1.99 的 404 已由本线程触发的 CI（ubuntu job）顺手修复

## 四、未完成 / 待办（按优先级）

> **2026-08-31 晚终版更新（二狗）**：1、2 两项收尾完成。EEXIST 根因修复 `e5297c8c` 晚于失败 run（非环境差异）；随后 CI 上连环挖出并修复 6 个"本机假绿"缺口，**skip_upload 验证 run 33400106127 双平台全绿**：
>
> | # | 缺口 | 根因 | 修复 commit |
> |---|---|---|---|
> | 1 | runtime/generated（release-config + backend.env）从未进构建链 | 本机靠 8/30 手动跑过的残留（版本号停在 1.1.102），CI 无此文件 → 包内缺 backend/.env | `faa37df7`（挂入 build:mac 链 + build-win-full.js；backend.env 缺失回退 example） |
> | 2 | prepare-media-tools 幽灵依赖 | spdx-license-list 本机 node_modules 历史手动装、lockfile 无 | `faa37df7`（补 devDeps ^6.11.0） |
> | 3 | check-package-contents `/dev/null` 重定向 | Windows cmd 无 /dev/null + 7z 不保证在 PATH | `6727672a`（find7z + 去重定向 + --win-only） |
> | 4 | asar 检查 win 假红 | @electron/asar listFiles 用 path.join，Windows 输出 `\` 反斜杠 | `37a4a737`（归一化 `/`） |
> | 5 | win 包缺 darwin sharp 变体 | Windows npm 装不出 darwin 可选依赖 | `37a4a737`（prepare-sharp-win32 win 平台补齐 darwin 两包）+ `378e9002`（系统 bsdtar 解 tar，Git GNU tar 把 `C:\` 当远程主机） |
> | 6 | 包内后端冒烟缺 AGENT_GATEWAY_SECRET | 冒烟漏模拟 main.js 注入契约，本机靠开发态 .env 假绿 | `8e526e76`（随机注入） |
>
> 教训总纲：**CI 干净环境是"本机残留产物假绿"的照妖镜**——以后 CI 失败先怀疑"本机有但 git/构建链没有的东西"，别先怀疑环境差异。
3. **【待大王定】CI 修复是否随下一版发布自然验证**：extraResources 合并产物功能等价，不强制发版；下次正式发版（升 1.1.111）走 CI 时自然验证。

## 五、关键踩坑清单（接手必读）

1. **`pip install octop==0.9.26` 报 `resolution-too-deep`**（依赖树深，pip resolver 限制）→ **必须用 uv**（`uv pip install --python <venv> octop==0.9.26`，663MB venv import OK，uv 0.11.x 本机可用）
2. **octop 0.9.26 要求 Python >= 3.12**（系统 python3.9 装不上是假失败，报 "No matching distribution"）→ workflow 用 `actions/setup-python@v5` 固定 3.12
3. **`GITHUB_PATH` 只对后续步骤生效**：同步骤内要用 uv 必须 `export PATH="$HOME/.local/bin:$PATH"`
4. **`prepare-octop-sidecar.js` win 默认 `C:\Python312\python.exe`**（CI 不存在）→ 必须传 `OCTOP_PYTHON`（`python -c 'import sys;print(sys.executable)'` 写 GITHUB_ENV）
5. **mac 的 `build:mac` 不调用 prepare-octop-sidecar**（依赖 runtime/octop 已存在）→ CI 上必须显式加步骤生成；win 由 `build-win-full.js` 内部调用
6. **electron-builder extraResources 同目标目录多 from 会 EEXIST**（hardlink 冲突，CI 干净环境必现、本机因 dist 缓存不现）→ 合并单 from + filter
7. **Windows checkout `invalid path` 排查**：`git ls-files -z`（按 \0 分，含 \n 文件名会被逐行读拆散漏检）；中文文件名合法，`[\x00-\x1f]` 控制字符才是病根
8. **Octop venv 平台绑定**：win 包要 win-x64 Python venv，mac 包要 mac venv——macOS 交叉构建塞 mac venv 进 win 包是坏 sidecar（运行时 CDP 不可用）
9. **GitHub CI 可用性**：ai-content 仓库 CI 正常（Billing 问题是 jz-ai-guard 仓库独有，别混淆）

## 六、下一步建议（接手线程）

1. ~~定位并修掉 mac CI Build artifacts 失败点~~ → 已修（`e5297c8c`），CI 复验 run 33390502368
2. ~~加 `skip_upload` 开关 + 用 `skip_upload=true` 完整验证 CI 双平台构建通过~~ → 已落地（`89d4bb21`）+ 验证 run 33390502368
3. 修完后 CI 发布路径即正式可用；下次发版（升 1.1.111）走 CI 全自动（build → upload → verify:remote 双通道门禁）
4. 若大王要连发验证，按发版铁律先升版本号再触发

## 七、验证命令速查

```bash
cd "/Users/yanghy/Documents/New project/ai-content"

# 远程双通道门禁（无本地产物依赖）
cd desktop && npm run release:verify:remote
# 期望：Release verification passed（Windows + macOS 1.1.108，installer + blockmap 元数据一致）

# 触发 CI（发布流程，会真实上传！验证请等 skip_upload 落地或用临时方式）
gh workflow run release-desktop.yml --ref main -f channel=latest

# 查 CI
gh run list --workflow=release-desktop.yml --limit 3
gh run view <run-id> --log --job=<job-id>   # 拉全量日志（--log-failed 有时返回空）

# 本机模拟 CI 干净环境打包验证（EEXIST 回归）
cd desktop && rm -rf dist/mac-arm64 && npx electron-builder --mac --dir

# 本机 octop 现场装模拟
uv pip install --python /tmp/test-venv octop==0.9.26
cd desktop && OCTOP_VENV=/tmp/test-venv node scripts/prepare-octop-sidecar.js --dry-run
```

---

**交接结论**：核心目标（发布门禁三通道 + Linux 404 修复 + verify:remote passed）已达成；剩余为"CI 发布路径验证收尾"（mac 一个环境差异失败点 + skip_upload 开关），非阻塞，可从容推进。
