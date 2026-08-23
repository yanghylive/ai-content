# agent-gateway 模块（3010 × Octop 核心引擎，已迁入）

> 来源：`prototype/src`（Codex 2026-08-14 工作区）核心引擎，2026-08-23 迁入真实仓库。

## 范围（诚实声明）
- **已迁入**：核心引擎（`core/`）+ mock 适配器（`adapters/`）+ 错误码（`contracts/error-codes.ts`）+ factory。
- **未接线**：本模块是独立可测的引擎，**未接入真实 3010 业务服务、真实 RPA、真实 Kaypal Memory、真实 Prisma 持久化**（《冻结清单》外部阻塞项）。
- **未迁入**：原型的 REST/WS 服务层（`server/app.ts`，express+ws）——真实仓库 HTTP 层由 NestJS 控制器承担，属后续接线工作。
- **契约**：机器可读契约（OpenAPI / JSON Schema / error-codes.yaml / compatibility-matrix）在 `backend/docs/contracts/`，本模块的 `contracts/error-codes.ts` 与 `error-codes.yaml` 同源。

## 目录
```
src/modules/agent-gateway/
├── core/        # 状态机/工具注册表/幂等/审批/事件总线/记忆编排/鉴权/载荷校验/factory
├── adapters/    # Mock Octop / Mock Kaypal Memory / Mock 业务工具（stub，待换真实实现）
├── contracts/   # error-codes.ts（与 docs/contracts/error-codes.yaml 同源）
└── *.spec.ts    # jest 测试（6 套件 / 49 用例）
```

## 运行测试
```bash
cd backend
npx jest agent-gateway          # 仅本模块
npm test                        # 全量（含本模块）
```

## 接线指引（后续）
1. 用 Nest `@Module` 包装 `core/factory.ts` 的 `createAgentGateway()` 为 provider；
2. 用真实 PrismaService 替换内存态存储（`IdempotencyStore`/`ApprovalService`/`EventBus` 持久化，参考 `docs/contracts/` 的 Prisma 草案）；
3. `adapters/` 三个 Mock 换成真实 Octop / Kaypal Memory / 3010 业务工具实现；
4. HTTP 层由 Nest Controller 实现 `docs/contracts/agent.openapi.yaml` 的冻结接口。
