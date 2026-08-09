# 一键桌面包迁移 Phase 2 执行记录

日期：2026-06-08

目标：产品安装包主链路从 Postgres / Redis 迁到 SQLite / 本地单进程队列，不再要求用户安装 Postgres 或 Redis。

## 已完成

1. 新增 SQLite Prisma schema 生成与校验。
   - `backend/scripts/prepare-sqlite-schema.mjs`
   - `backend/scripts/validate-sqlite-schema.mjs`
   - 生成 `backend/prisma/schema.sqlite.prisma`
   - 处理 SQLite 不支持的 `String[]`、`@db.Text`、enum provider 差异。

2. 新增 SQLite 后端 bundle 构建。
   - `backend/scripts/build-sqlite-bundle.mjs`
   - `npm run build:bundle:sqlite`
   - 产物：`backend/dist-bundle-sqlite`
   - 构建后恢复默认 Postgres Prisma Client，避免影响开发环境。

3. 桌面产品包默认数据库切到 SQLite。
   - `desktop/backend.env` 使用 `KAYPAL_DESKTOP_DATABASE_MODE=sqlite`
   - `DATABASE_URL` / `SQLITE_DATABASE_URL` 指向 SQLite。
   - `desktop/main.js` 在启动时把相对 SQLite URL 改到 Electron `userData` 目录，避免写安装目录。
   - `.env` 缺失时默认也走 SQLite，不再回落到 Postgres。

4. 桌面打包资源切到 SQLite bundle。
   - `desktop/package.json` 从 `backend/dist-bundle-sqlite` 打包后端。
   - 资源包含 `schema.prisma` 和 `schema.sqlite.prisma`。

5. Windows 构建流程切到 SQLite Prisma Client。
   - `desktop/scripts/build-win-full.js` 改为先构建 SQLite bundle。
   - `BUILD_PLATFORM=win-x64` 生成 Windows Prisma engine。
   - `prepare-prisma-engines.js prune` 只保留目标平台 engine。

6. 修复 Prisma JSON path provider 差异。
   - `backend/src/modules/auto-upload/auto-upload.client.ts`
   - Postgres 使用 `path: ['engineAccountId']`
   - SQLite 使用 `path: '$.engineAccountId'`

7. 安装器主链路移除 Postgres。
   - `desktop/installer/deps-manifest.json` 不再列 Postgres / Redis。
   - `desktop/installer/detect-deps.ps1` 不再检测 Postgres。
   - `desktop/installer/bootstrap-installer.ps1` 不再执行 `init-postgres.ps1`。
   - `desktop/installer/self-check.ps1` 不再连接 5432，而检查 SQLite schema/env/engine。
   - `desktop/installer-helper` 独立安装助手资源同步移除 Postgres 检测和依赖顺序。
   - `desktop/package.json` 不再把 legacy `init-postgres.ps1` 打进安装包资源。
   - `desktop/scripts/check-full-installer-assets.js` 明确禁止 Postgres / Redis 重新进入 manifest、detect、bootstrap、self-check 和 installer-helper 主链路。

8. 移除未使用的 Redis/BullMQ 后端依赖。
   - 移除 `@nestjs/bullmq`
   - 移除 `bullmq`
   - 移除 `ioredis`

## 验证

已通过：

- `npm run db:validate:sqlite`
- `npm run build:bundle:sqlite`
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
- `node desktop/scripts/check-full-installer-assets.js --phase=pre`
- `node desktop/scripts/check-commercial-assets.js`
- `node --check desktop/installer-helper/main.js`
- `BUILD_PLATFORM=win-x64 KAYPAL_KEEP_SQLITE_PRISMA_CLIENT=1 npm run build:bundle:sqlite`
- `BUILD_PLATFORM=win-x64 node ../desktop/scripts/prepare-prisma-engines.js prune`

未在当前 macOS 环境完成：

- PowerShell 脚本 AST 语法检查：本机没有 `pwsh`。
- Windows post-build 检查：当前没有实际生成 `desktop/dist/win-unpacked`。

## 剩余说明

- `desktop/installer/init-postgres.ps1` 保留为旧包回退脚本，当前产品安装主链路不调用。
- `backend/package-lock.json` 仍因 `pg` 依赖包含 `postgres-*` 传递包；开发环境主 schema 仍保留 Postgres。
- 审计脚本仍会看到 Postgres/Redis 文档和 legacy 命中，但 `check-full-installer-assets` 已覆盖产品包阻断规则。

## Phase 2 当前结论

数据库与队列主链路迁移已完成到可打包验证状态：产品桌面包默认使用 SQLite，安装器不再要求 Postgres / Redis，后端真实任务队列仍走 Prisma 表 + 单进程 worker。
