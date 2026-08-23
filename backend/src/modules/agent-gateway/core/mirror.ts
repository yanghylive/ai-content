import { AgentEvent, AgentSession, AgentTask, Artifact } from './types';

/**
 * 引擎写路径持久化镜像接口。
 * 内存态仍是权威（读路径不依赖 DB）；每次写操作后 fire-and-forget 镜像到 DB
 * （真实仓库实现 PrismaMirror 落 agent_gateway_* 表，供重启恢复/审计/对账）。
 * 所有方法可选——未实现的镜像方自动跳过。
 */
export interface AgentGatewayMirror {
  sessionCreated?(s: AgentSession): void | Promise<void>;
  sessionUpdated?(s: AgentSession): void | Promise<void>;
  taskCreated?(t: AgentTask): void | Promise<void>;
  taskUpdated?(t: AgentTask): void | Promise<void>;
  eventPublished?(e: AgentEvent): void | Promise<void>;
  artifactStored?(a: Artifact): void | Promise<void>;
}
