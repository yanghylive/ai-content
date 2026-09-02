import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { AuthRequestContextService } from '../common/auth-request-context.service';

/**
 * 2026-09-01 logout 换库（审计 #1/#2/#6/#7/#9/#11 隔离总解，设计见
 * docs/logout-db-isolation-20260901-design.md）：
 *  - 主库（kaypal-ai.sqlite）= 系统库：认证表（users/user_sessions）+ 模板
 *  - 账号库 = <userDataDir>/accounts/<uid>.sqlite：该账号全部业务数据（物理隔离）
 *  - 本类 extends PrismaClient 即系统库连接；构造返回 Proxy，把业务访问
 *    （model 属性 / $queryRaw / $transaction …）路由到"当前活跃库"：
 *      未登录 → 系统库；登录后 → 账号库
 *  - 认证相关模块（auth.service/auth.guard）显式走 `this.prisma.system` 读系统库
 *  - 白名单（TARGET_ONLY）属性永远访问未代理的系统库 this，防生命周期/内部方法串库
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /** 账号库缓存：路径 → PrismaClient（首次访问惰性创建连接） */
  private readonly accountClients = new Map<string, PrismaClient>();

  /** 2026-09-01（复核 P1-2）：userId → 账号库路径（请求级路由用） */
  private readonly accountPaths = new Map<string, string>();

  /** 当前活跃账号库路径；null = 未登录（业务访问走系统库） */
  private activeAccountPath: string | null = null;

  /** 切库闸（2026-09-01）：切换瞬间拒绝业务访问，防半切换态用错库 */
  private switching = false;

  /** 已清空业务数据的账号库（防重复清空） */
  private readonly accountTablesCleared = new Set<string>();

  /** 2026-09-02：已回补组织关系（tenants/tenant_members）的账号库（进程内防重复回补） */
  private readonly tenantOrgSynced = new Set<string>();

  private static readonly TARGET_ONLY = new Set<string>([
    // 生命周期与内部建表/修复方法（必须跑在系统库上）
    'onModuleInit',
    'onModuleDestroy',
    'ensureSqliteCoreTables',
    'ensureSqliteSchemaColumns',
    'ensureSqliteColumn',
    'isSqliteIndexStatement',
    'repairRpaEvidenceStepIds',
    'repairSqliteNullTimestamps',
    'repairUnsupportedSqliteTimestampColumns',
    'rebuildSqliteTableWithDatetimeColumns',
    'quoteSqliteIdentifier',
    // 换库控制面（自身内部状态）
    'switchDatabase',
    'getActiveAccountPath',
    'getAccountClient',
    'getSystemDatabasePath',
    'ensureAccountDatabase',
    'clearAccountBusinessTables',
    'copySqliteDatabaseWithSidecars',
    'healAccountDatabaseIfCorrupt',
    'isSqliteCorrupt',
    'system',
    'switching',
    'accountClients',
    'accountPaths',
    'activeAccountPath',
    'accountTablesCleared',
    'tenantOrgSynced',
    'resolveActiveClient',
    'registerStudioProjectOwner',
    'assertStudioProjectOwner',
    'listStudioProjectOwnerIds',
    'migrateStudioProjectOwner',
    'authRequestContext',
    'logger',
  ]);

  constructor(private readonly authRequestContext?: AuthRequestContextService) {
    // 2026-09-01（复核第四轮 P1-3）：jest 环境构造期兜底——jest 收尾时 env
    // 可能已被清空，PrismaClient 构造会因 DATABASE_URL 缺失/非法抛 P1012 崩溃。
    // 仅 jest 生效（JEST_WORKER_ID），生产环境不受影响（缺失时业务访问才报错）。
    if (
      process.env.JEST_WORKER_ID !== undefined &&
      (!process.env.DATABASE_URL ||
        !process.env.DATABASE_URL.startsWith('postgres'))
    ) {
      process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
    }
    super();
    const proxy = new Proxy(this, {
      get(target, prop: string | symbol) {
        if (typeof prop !== 'string') {
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        }
        if (PrismaService.TARGET_ONLY.has(prop)) {
          return (target as unknown as Record<string, unknown>)[prop];
        }
        // 切库闸：切换瞬间业务访问直接拒绝（防半切换态用错库）
        if (target.switching) {
          throw new ServiceUnavailableException('数据正在切换，请稍后重试');
        }
        // 业务访问：路由到当前活跃库（账号库或系统库）。
        // 2026-09-01（复核 P1-2）：请求级上下文优先——当前请求带 user.id 时
        // 按该用户账号库路由（并发/切换期间不串库）；无请求上下文回退全局
        // activeAccountPath（登录/登出/后台任务）。注意：不 bind——调用方
        // this=proxy，属性访问再经 proxy 递归转发，行为等价且不破坏 jest.fn。
        const active = target.resolveActiveClient();
        return (active as unknown as Record<string, unknown>)[prop];
      },
      set(target, prop: string | symbol, value: unknown) {
        (target as unknown as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    });
    // 2026-09-01 实锤：Prisma 6 client 内部本身是 Proxy（own prop 含 _originalClient），
    // prototype getter 的 this 会被 Prisma 内部劫持（实测 getter 内 this !== target）。
    // 故 system 不能用 getter，改为构造期实例字段（复制引用），proxy 访问稳定返回系统库 this。
    this.system = this;
    return proxy;
  }

  /**
   * 2026-09-01（复核 P1-2）：解析当前业务访问的目标 client。
   * 请求级（AsyncLocalStorage 的 user.id）> 全局 activeAccountPath > 系统库。
   */
  private resolveActiveClient(): PrismaClient {
    let requestUserId: string | undefined;
    try {
      const ctx = this.authRequestContext?.get() as
        { user?: { id?: string } } | undefined;
      requestUserId = ctx?.user?.id?.trim() || undefined;
    } catch {
      requestUserId = undefined;
    }
    if (requestUserId) {
      const accountPath = this.accountPaths.get(requestUserId);
      if (!accountPath) {
        // 2026-09-01（复核 P1-A）：已认证请求但账号库映射缺失（进程重启后
        // accountPaths 为空）→ 拒绝，绝不回退全局活跃库（会串到别的账号）
        throw new ServiceUnavailableException('账号库尚未就绪，请重新登录');
      }
      return this.getAccountClient(accountPath);
    }
    return this.activeAccountPath
      ? this.getAccountClient(this.activeAccountPath)
      : this;
  }

  /**
   * 2026-09-01（复核 P0）：StudioCore 项目 owner 原子登记（创建入口调用）。
   * INSERT OR IGNORE 后回读实际 owner——并发下两人同时登记只放行真 owner（防抢占）。
   */
  async registerStudioProjectOwner(projectId: string, userId: string) {
    await this.system.$executeRawUnsafe(
      `INSERT OR IGNORE INTO studio_project_owners (project_id, user_id) VALUES (?, ?)`,
      projectId,
      userId,
    );
    const rows = await this.system.$queryRawUnsafe<Array<{ user_id: string }>>(
      `SELECT user_id FROM studio_project_owners WHERE project_id = ?`,
      projectId,
    );
    const actual = rows.length > 0 ? rows[0].user_id : null;
    if (actual !== userId) {
      throw new ServiceUnavailableException(
        `视频项目 ${projectId} 已归属其他账号`,
      );
    }
  }

  /** 校验项目 owner（无记录或不匹配 → 拒绝，不泄露存在性） */
  async assertStudioProjectOwner(projectId: string, userId: string) {
    const rows = await this.system.$queryRawUnsafe<Array<{ user_id: string }>>(
      `SELECT user_id FROM studio_project_owners WHERE project_id = ?`,
      projectId,
    );
    if (rows.length === 0 || rows[0].user_id !== userId) {
      throw new NotFoundException(`视频项目 ${projectId} 不存在`);
    }
  }

  /** 当前用户拥有的全部项目 id（列表过滤用） */
  async listStudioProjectOwnerIds(userId: string): Promise<Set<string>> {
    const rows = await this.system.$queryRawUnsafe<
      Array<{ project_id: string }>
    >(`SELECT project_id FROM studio_project_owners WHERE user_id = ?`, userId);
    return new Set(rows.map((row) => row.project_id));
  }

  /** 受控迁移项目归属（仅 admin 调用；无记录则创建） */
  async migrateStudioProjectOwner(projectId: string, newOwnerId: string) {
    await this.system.$executeRawUnsafe(
      `INSERT INTO studio_project_owners (project_id, user_id) VALUES (?, ?)
       ON CONFLICT(project_id) DO UPDATE SET user_id = excluded.user_id`,
      projectId,
      newOwnerId,
    );
  }

  /** 系统库连接句柄：认证表（users / user_sessions）永远走它，不随登录切换（构造期赋值） */
  system!: PrismaClient;

  /** 当前活跃账号库路径（null = 未登录，业务走系统库） */
  getActiveAccountPath(): string | null {
    return this.activeAccountPath;
  }

  /** 切换业务访问目标库：path=账号库文件绝对路径；null 切回系统库 */
  async switchDatabase(path: string | null): Promise<void> {
    this.switching = true;
    try {
      this.activeAccountPath = path;
      if (path) {
        // 预连接，尽早暴露路径错误
        this.getAccountClient(path);
      }
    } finally {
      this.switching = false;
    }
  }

  /** 账号库 client（惰性创建 + 连接，缓存复用） */
  getAccountClient(path: string): PrismaClient {
    let client = this.accountClients.get(path);
    if (!client) {
      const url = path.startsWith('file:') ? path : `file:${path}`;
      client = new PrismaClient({
        datasources: { db: { url } },
      });
      this.accountClients.set(path, client);
      // 惰性连接：首次调用即连，失败抛错由调用方兜底
      void client.$connect();
    }
    return client;
  }

  /** 系统库文件路径（file: 前缀剥离后） */
  getSystemDatabasePath(): string {
    const dbUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    return dbUrl.replace(/^file:/, '');
  }

  /**
   * 确保某账号的业务库存在：首登从系统库（模板）复制 + 清空业务表。
   * 返回账号库绝对路径。复制后再清空系统库业务表，保证模板干净。
   */
  async ensureAccountDatabase(userId: string): Promise<string> {
    const systemPath = this.getSystemDatabasePath();
    if (!systemPath) {
      throw new Error('系统库路径未配置（SQLITE_DATABASE_URL 缺失）');
    }
    const accountsDir = join(dirname(systemPath), 'accounts');
    mkdirSync(accountsDir, { recursive: true });
    const safeKey = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const accountPath = join(accountsDir, `${safeKey}.sqlite`);

    if (!existsSync(accountPath)) {
      // 首登：系统库作为模板复制（含结构 + 认证表），业务数据按账号物理隔离。
      // 2026-09-01（复核 P1-3）：必须复制 WAL/SHM 三件套——SQLite 在 WAL 模式下
      // 已提交事务可能只在 -wal 文件里（实测现网库 4.4MB WAL），只复制主库会丢数据；
      // 新库首次打开时自动 checkpoint 合并 WAL，数据完整。
      await this.copySqliteDatabaseWithSidecars(systemPath, accountPath);
      await this.clearAccountBusinessTables(accountPath);
      // 模板净化：系统库业务数据首登后不再需要（已随账号库隔离）
      if (!this.accountTablesCleared.has('__system__')) {
        await this.clearAccountBusinessTables(systemPath);
        this.accountTablesCleared.add('__system__');
      }
    } else {
      // 2026-09-01 P3（换库适配）：账号库损坏自愈——登录时 quick_check，
      // 损坏则带备份隔离 + 从系统库模板重建（与主库 heal 策略一致）。
      await this.healAccountDatabaseIfCorrupt(accountPath, systemPath);
      // 2026-09-02（logout 换库隔离回归修复）：旧白名单把 tenants /
      // tenant_members 当业务表清空过，存量账号库缺组织关系 →
      // resolveTenantId 查空 → growth/overview 等 403。存量库幂等回补。
      await this.syncTenantOrgTables(accountPath);
    }
    // 2026-09-01（复核 P1-2）：登记 userId → 账号库路径（请求级路由）
    this.accountPaths.set(userId, accountPath);
    return accountPath;
  }

  /**
   * 2026-09-01（复核 P2/第三轮）：SQLite 一致性快照——用 VACUUM INTO 生成
   * 事务内一致快照（含 WAL 中已提交数据），替代串行复制主库/WAL/SHM（复制期间
   * 源库变化会不一致）。失败直接抛错阻断迁移（不静默回退）。
   * 兼容性：VACUUM INTO 需 SQLite ≥3.27（2019，Prisma 内置满足）。
   */
  private async copySqliteDatabaseWithSidecars(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    // VACUUM INTO 目标必须不存在
    if (existsSync(targetPath)) {
      rmSync(targetPath, { force: true });
    }
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${targetPath}${suffix}`, { force: true });
    }
    // 路径转义（SQLite VACUUM INTO 不接受参数绑定，须字面量）
    const escaped = targetPath.replace(/'/g, "''");
    await this.system.$queryRawUnsafe(`VACUUM INTO '${escaped}'`);
    this.logger.log(`账号库一致性快照完成（VACUUM INTO）：${targetPath}`);
  }

  /**
   * 2026-09-01 P3：账号库损坏探测 + 带备份重建。
   * PRAGMA quick_check 失败（抛错/返回非 ok）→ 移走 sidecar（WAL/SHM）→
   * rename 损坏库为 .corrupt-<stamp> → 从系统库模板复制重建 → 清空业务表。
   * 丢弃缓存连接；重建后首次访问重新建立。
   */
  private async healAccountDatabaseIfCorrupt(
    accountPath: string,
    systemPath: string,
  ): Promise<void> {
    const corrupt = await this.isSqliteCorrupt(accountPath);
    if (!corrupt) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logger.error(
      `账号库损坏（quick_check 失败），备份后从系统库模板重建：${accountPath}（备份 .corrupt-${stamp}）`,
    );
    this.accountClients.delete(accountPath);
    // sidecar 先移（防残留 WAL 污染重建后的新库），失败则中止重建
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${accountPath}${suffix}`;
      if (existsSync(sidecar)) {
        renameSync(sidecar, `${sidecar}.corrupt-${stamp}`);
      }
    }
    renameSync(accountPath, `${accountPath}.corrupt-${stamp}`);
    // 2026-09-01（复核 P2）：恢复复制前 checkpoint，避免丢 WAL 中已提交数据
    await this.copySqliteDatabaseWithSidecars(systemPath, accountPath);
    this.accountTablesCleared.delete(accountPath);
    await this.clearAccountBusinessTables(accountPath);
  }

  /** PRAGMA quick_check 探测库完整性（损坏/不可读 → true） */
  private async isSqliteCorrupt(dbPath: string): Promise<boolean> {
    try {
      const client = this.getAccountClient(dbPath);
      await client.$queryRawUnsafe('PRAGMA quick_check');
      return false;
    } catch (error) {
      this.logger.warn(
        `账号库 quick_check 失败（${dbPath}）：${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  /**
   * 清空指定库的业务表数据（保留表结构），排除认证表、系统级组织关系表与迁移表。
   * 表清单运行时枚举 sqlite_master，零维护。
   * 2026-09-02（修复）：tenants / tenant_members 是系统级组织关系（用户↔组织），
   * 账号库派生自系统库时保留——否则 resolveTenantId 查账号库 tenant_members
   * 为空 → 所有带租户校验的接口（growth/overview 等）403 TENANT_MEMBERSHIP_REQUIRED。
   */
  private async clearAccountBusinessTables(dbPath: string): Promise<void> {
    if (this.accountTablesCleared.has(dbPath)) {
      return;
    }
    const client = this.getAccountClient(dbPath);
    const tables = (
      await client.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('users', 'user_sessions', 'tenants', 'tenant_members', '_prisma_migrations')`,
      )
    ).map((row) => row.name);
    // 2026-09-01（复核 P1-3）：删除失败不再吞掉照样标记完成——失败表会导致
    // 账号库残留上一账号业务数据（隔离破坏），汇总失败并抛错中止（首登可重试）。
    const failed: Array<{ table: string; message: string }> = [];
    for (const table of tables) {
      try {
        await client.$executeRawUnsafe(`DELETE FROM "${table}"`);
      } catch (error) {
        failed.push({
          table,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (failed.length > 0) {
      const detail = failed
        .map((item) => `${item.table}(${item.message.slice(0, 80)})`)
        .join('; ');
      throw new Error(`清空业务表失败（${dbPath}），未标记已清空：${detail}`);
    }
    this.accountTablesCleared.add(dbPath);
    this.logger.log(
      `账号库业务数据已清空（保留结构）：${dbPath}（表数 ${tables.length}）`,
    );
  }

  /**
   * 2026-09-02（logout 换库隔离回归修复）：旧版 clearAccountBusinessTables
   * 白名单不含 tenants/tenant_members，存量账号库（已存在文件）的组织关系行
   * 被当业务数据清空 → resolveTenantId 查账号库 tenant_members 为空 →
   * 所有租户校验接口（growth/overview 等）403 TENANT_MEMBERSHIP_REQUIRED。
   * 白名单修复只影响新派生库；存量库在这里幂等回补（INSERT OR IGNORE，
   * 进程内每库只跑一次；重启后 accountPaths 清空，首个请求经守卫重入）。
   * 只回补与账号库 users 相关的组织行，规避 FK 失败；模板无组织表则跳过。
   */
  private async syncTenantOrgTables(accountPath: string): Promise<void> {
    if (this.tenantOrgSynced.has(accountPath)) {
      return;
    }
    const systemTables = (
      await this.system.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tenants', 'tenant_members')`,
      )
    ).map((row) => row.name);
    if (
      !systemTables.includes('tenants') ||
      !systemTables.includes('tenant_members')
    ) {
      this.logger.warn(`系统库无组织表，跳过账号库组织关系回补：${accountPath}`);
      this.tenantOrgSynced.add(accountPath);
      return;
    }
    const account = this.getAccountClient(accountPath);
    const localUserIds = new Set(
      (
        await account.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM users`,
        )
      ).map((row) => row.id),
    );
    if (localUserIds.size === 0) {
      this.tenantOrgSynced.add(accountPath);
      return;
    }

    const members = await this.system.$queryRawUnsafe<
      Array<{
        id: string;
        tenant_id: string;
        user_id: string;
        role: string;
        status: string;
        permissions: string | null;
        joined_at: string;
        created_at: string;
        updated_at: string;
      }>
    >(
      `SELECT id, tenant_id, user_id, role, status, permissions, joined_at, created_at, updated_at FROM tenant_members`,
    );
    const eligibleMembers = members.filter((member) =>
      localUserIds.has(member.user_id),
    );
    const neededTenantIds = new Set(
      eligibleMembers.map((member) => member.tenant_id),
    );

    const tenants = await this.system.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        owner_user_id: string;
        metadata: string | null;
        created_at: string;
        updated_at: string;
      }>
    >(
      `SELECT id, name, slug, status, owner_user_id, metadata, created_at, updated_at FROM tenants`,
    );
    const tenantsToInsert = tenants.filter(
      (tenant) =>
        localUserIds.has(tenant.owner_user_id) || neededTenantIds.has(tenant.id),
    );

    // Prisma raw 会把 Json 列解析成对象/数组（如 permissions '[]' → []），
    // 数组参数在 SQLite 绑定直接报 "Arrays are not supported" → 统一序列化。
    const serialize = (value: unknown): string | number | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'object') {
        // 库内 DATETIME 以 INTEGER(ms) 存储 → Date 也序列化为毫秒数，避免混存格式
        return value instanceof Date ? value.getTime() : JSON.stringify(value);
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value as string | number;
    };
    for (const tenant of tenantsToInsert) {
      await account.$executeRawUnsafe(
        `INSERT OR IGNORE INTO tenants (id, name, slug, status, owner_user_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        tenant.id,
        tenant.name,
        tenant.slug,
        tenant.status,
        tenant.owner_user_id,
        serialize(tenant.metadata),
        serialize(tenant.created_at),
        serialize(tenant.updated_at),
      );
    }
    for (const member of eligibleMembers) {
      await account.$executeRawUnsafe(
        `INSERT OR IGNORE INTO tenant_members (id, tenant_id, user_id, role, status, permissions, joined_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        member.id,
        member.tenant_id,
        member.user_id,
        member.role,
        member.status,
        serialize(member.permissions),
        serialize(member.joined_at),
        serialize(member.created_at),
        serialize(member.updated_at),
      );
    }
    this.tenantOrgSynced.add(accountPath);
    if (tenantsToInsert.length > 0 || eligibleMembers.length > 0) {
      this.logger.log(
        `账号库组织关系已回补（tenants ${tenantsToInsert.length} / members ${eligibleMembers.length}）：${accountPath}`,
      );
    }
  }

  async onModuleInit() {
    const attempts = 8;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        // v1.1.104（真机 P0，8/30 15827 实锤）：顺序调整——先做列收敛再建核心表。
        // 旧库已存在的表（如 mobile_devices）可能缺新增列（device_token_hash），
        // ensureSqliteCoreTables 的 CREATE INDEX 引用该列会直接崩（P2010 no such
        // column），而列收敛本来能补——但原来排在建表之后，永远跑不到。
        // 新顺序：先补旧库缺列 → 再 CREATE TABLE IF NOT EXISTS 建缺失表 + 索引。
        await this.ensureSqliteSchemaColumns();
        await this.ensureSqliteCoreTables();
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : 'unknown';
        if (attempt === attempts) {
          break;
        }
        this.logger.warn(
          `数据库连接失败，${attempt}/${attempts}，800ms 后重试：${message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    throw lastError;
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // 2026-09-01 换库：登出时关闭所有账号库连接，避免残留文件句柄
    for (const client of this.accountClients.values()) {
      try {
        await client.$disconnect();
      } catch {
        // 单个账号库断开失败不阻塞关闭
      }
    }
    this.accountClients.clear();
  }

  private async ensureSqliteCoreTables() {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) {
      return;
    }

    // 性能优化：SQLite 连接初始化即开启 WAL 日志模式 + busy_timeout，
    // 提升并发读写吞吐、避免写锁竞争时立即失败（journal_mode 持久化在库文件，busy_timeout 按连接生效）。
    // 注意：两个 PRAGMA 都会返回结果行（WAL 模式名 / busy_timeout 值），必须用
    // $queryRawUnsafe——$executeRawUnsafe 执行返回行的 SQL 在 SQLite 下抛
    //  "Execute returned results, which is not allowed in SQLite"（曾致启动崩溃）。
    //
    // 2026-08-26 真机 P0：Windows 打包端对「预置 166 表 seed」执行 PRAGMA journal_mode=WAL
    // 时，Prisma 引擎报 SQLITE_CORRUPT（database disk image is malformed / malformed database
    // schema），导致后端启动即崩。macOS 开发态走空库 + WAL 正常、从未暴露。WAL 只是并发优化、
    // 非必需 → 改为 best-effort：切 WAL 失败时静默降级为默认 delete 模式继续启动，绝不让优化项
    // 阻断商用链路。busy_timeout 同样 best-effort（对连接生效，不影响库文件）。
    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    } catch (error) {
      this.logger?.warn?.(
        `SQLite WAL 模式切换失败（降级 delete 模式继续）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    } catch {
      // busy_timeout 失败不阻断启动
    }

    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        avatar TEXT,
        last_login_at DATETIME,
        kaypal_user_id TEXT,
        role TEXT NOT NULL DEFAULT 'operator',
        commercial_execution_allowed BOOLEAN NOT NULL DEFAULT false,
        plan_mode TEXT NOT NULL DEFAULT 'trial',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_kaypal_user_id_key ON users(kaypal_user_id)`,
      `CREATE INDEX IF NOT EXISTS users_status_idx ON users(status)`,
      `CREATE INDEX IF NOT EXISTS users_role_idx ON users(role)`,
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions(expires_at)`,
      `CREATE TABLE IF NOT EXISTS system_configs (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        owner_user_id TEXT NOT NULL,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT tenants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_key ON tenants(slug)`,
      `CREATE INDEX IF NOT EXISTS tenants_owner_user_id_idx ON tenants(owner_user_id)`,
      `CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status)`,
      `CREATE TABLE IF NOT EXISTS tenant_members (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        status TEXT NOT NULL DEFAULT 'active',
        permissions JSONB NOT NULL DEFAULT '[]',
        joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_tenant_id_user_id_key ON tenant_members(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS tenant_members_tenant_id_idx ON tenant_members(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS tenant_members_user_id_idx ON tenant_members(user_id)`,
      `CREATE INDEX IF NOT EXISTS tenant_members_role_idx ON tenant_members(role)`,
      `CREATE INDEX IF NOT EXISTS tenant_members_status_idx ON tenant_members(status)`,
      `CREATE TABLE IF NOT EXISTS tenant_entitlements (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        source TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'FREE',
        status TEXT NOT NULL DEFAULT 'active',
        features JSONB NOT NULL DEFAULT '[]',
        commercial_execution_allowed BOOLEAN NOT NULL DEFAULT false,
        external_subscription_id TEXT,
        period_start DATETIME,
        period_end DATETIME,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT tenant_entitlements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS tenant_entitlements_tenant_id_source_key ON tenant_entitlements(tenant_id, source)`,
      `CREATE INDEX IF NOT EXISTS tenant_entitlements_tenant_id_idx ON tenant_entitlements(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS tenant_entitlements_source_idx ON tenant_entitlements(source)`,
      `CREATE INDEX IF NOT EXISTS tenant_entitlements_plan_idx ON tenant_entitlements(plan)`,
      `CREATE INDEX IF NOT EXISTS tenant_entitlements_status_idx ON tenant_entitlements(status)`,
      `CREATE INDEX IF NOT EXISTS tenant_entitlements_period_end_idx ON tenant_entitlements(period_end)`,
      `CREATE TABLE IF NOT EXISTS entitlement_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT,
        plan TEXT NOT NULL,
        plan_mode TEXT,
        source TEXT NOT NULL,
        features JSONB NOT NULL DEFAULT '{}',
        blockers JSONB NOT NULL DEFAULT '[]',
        context TEXT,
        ref_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS entitlement_snapshots_user_id_created_at_idx ON entitlement_snapshots(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS entitlement_snapshots_ref_id_idx ON entitlement_snapshots(ref_id)`,
      `CREATE TABLE IF NOT EXISTS activation_events (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        event_type TEXT NOT NULL,
        ref_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS activation_events_user_event_key ON activation_events(user_id, event_type)`,
      `CREATE TABLE IF NOT EXISTS content_asset_versions (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        asset_type TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        version_no INTEGER NOT NULL DEFAULT 1,
        snapshot TEXT,
        change_summary TEXT,
        actor_user_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS content_asset_versions_type_id_no_key ON content_asset_versions(asset_type, asset_id, version_no)`,
      `CREATE INDEX IF NOT EXISTS content_asset_versions_type_id_created_idx ON content_asset_versions(asset_type, asset_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS content_plans (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        actor_user_id TEXT,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        audience TEXT,
        core_claim TEXT,
        offer TEXT,
        platforms JSONB NOT NULL DEFAULT '[]',
        success_metric TEXT,
        evidence_refs JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS content_plans_tenant_user_status_idx ON content_plans(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS content_plans_status_idx ON content_plans(status)`,
      `CREATE TABLE IF NOT EXISTS review_runs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        actor_user_id TEXT,
        period TEXT NOT NULL DEFAULT '7d',
        filters JSONB NOT NULL DEFAULT '{}',
        funnel JSONB,
        insights JSONB NOT NULL DEFAULT '[]',
        actions JSONB NOT NULL DEFAULT '[]',
        generated_from TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS review_runs_tenant_user_created_idx ON review_runs(tenant_id, user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS review_runs_generated_from_idx ON review_runs(generated_from)`,
      `CREATE TABLE IF NOT EXISTS attribution_links (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        from_type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'deterministic',
        confidence TEXT NOT NULL DEFAULT 'high',
        label TEXT,
        evidence JSONB NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // 六步闭环 schema drift 修复：唯一约束须含 tenant_id（Prisma @@unique([tenantId,fromType,fromId,toType,toId,model])），
      // 旧库曾建缺 tenant_id 的 attribution_links_unique_key，导致 upsert 找不到约束 → 归因链落库静默失败。
      `DROP INDEX IF EXISTS attribution_links_unique_key`,
      `CREATE UNIQUE INDEX IF NOT EXISTS tenantId_fromType_fromId_toType_toId_model ON attribution_links(tenant_id, from_type, from_id, to_type, to_id, model)`,
      `DROP INDEX IF EXISTS attribution_links_to_idx`,
      `CREATE INDEX IF NOT EXISTS attribution_links_to_idx ON attribution_links(tenant_id, to_type, to_id)`,
      `DROP INDEX IF EXISTS attribution_links_from_idx`,
      `CREATE INDEX IF NOT EXISTS attribution_links_from_idx ON attribution_links(tenant_id, from_type, from_id)`,
      // 2026-09-01（复核 P1-D）：StudioCore 项目认领表（用户级授权）——
      // 项目由上游 8610 创建（本后端无创建入口），首个访问当前项目的用户认领，
      // 之后所有项目 ID 操作校验归属（跨账号不可见/不可操作）。
      `CREATE TABLE IF NOT EXISTS studio_project_owners (
        project_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // —— 唯一约束批量补齐（schema drift 检测发现：以下表的 @@unique 在 SQLite 建表时漏建唯一索引，导致 upsert 静默失败）——
      `CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_external_key ON billing_subscriptions(provider, external_subscription_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_provider_external_key ON billing_invoices(provider, external_invoice_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_events_provider_event_key ON billing_webhook_events(provider, event_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS content_versions_draft_version_key ON content_versions(draft_id, version_no)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS wecom_contacts_config_external_key ON wecom_contacts(config_id, external_user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS growth_account_health_user_platform_account_key ON growth_account_health(user_id, platform, account_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS growth_account_health_tenant_platform_account_key ON growth_account_health(tenant_id, platform, account_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_user_platform_account_key ON account_subscriptions(user_id, platform, account_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS user_memories_user_type_content_key ON user_memories(user_id, type, content)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_quotas_user_date_key ON ai_usage_quotas(user_id, date)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS cps_orders_vendor_order_key ON cps_orders(vendor_code, order_no)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rebate_accounts_tenant_user_key ON rebate_accounts(tenant_id, user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS price_histories_item_platform_snapshot_key ON price_histories(item_id, platform_code, snapshot_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_accounts_tenant_user_key ON ai_credit_accounts(tenant_id, user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS cps_favorites_tenant_user_item_platform_key ON cps_favorites(tenant_id, user_id, item_id, platform_code)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS savings_checkins_tenant_user_date_key ON savings_checkins(tenant_id, user_id, checkin_date)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS exposure_accounts_user_platform_account_key ON exposure_accounts(user_id, platform, account_id)`,
      // —— 普通索引批量补齐（schema drift 检测：以下 @@index 在 SQLite 建表时漏建，仅影响查询性能）——
      `CREATE INDEX IF NOT EXISTS users_kaypal_user_id_idx ON users(kaypal_user_id)`,
      `CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_id_idx ON billing_subscriptions(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_idx ON billing_subscriptions(provider)`,
      `CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx ON billing_subscriptions(status)`,
      `CREATE INDEX IF NOT EXISTS billing_subscriptions_plan_idx ON billing_subscriptions(plan)`,
      `CREATE INDEX IF NOT EXISTS billing_subscriptions_current_period_end_idx ON billing_subscriptions(current_period_end)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_tenant_id_idx ON billing_invoices(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_provider_idx ON billing_invoices(provider)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON billing_invoices(status)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_external_customer_id_idx ON billing_invoices(external_customer_id)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_external_subscription_id_idx ON billing_invoices(external_subscription_id)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_paid_at_idx ON billing_invoices(paid_at)`,
      `CREATE INDEX IF NOT EXISTS billing_invoices_failed_at_idx ON billing_invoices(failed_at)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_tenant_id_idx ON billing_webhook_events(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_idx ON billing_webhook_events(provider)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_event_type_idx ON billing_webhook_events(event_type)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_status_idx ON billing_webhook_events(status)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_external_customer_id_idx ON billing_webhook_events(external_customer_id)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_external_subscription_id_idx ON billing_webhook_events(external_subscription_id)`,
      `CREATE INDEX IF NOT EXISTS billing_webhook_events_processed_at_idx ON billing_webhook_events(processed_at)`,
      `CREATE INDEX IF NOT EXISTS content_strategies_is_default_idx ON content_strategies(is_default)`,
      `CREATE INDEX IF NOT EXISTS content_strategies_enabled_idx ON content_strategies(enabled)`,
      `CREATE INDEX IF NOT EXISTS content_strategy_templates_industry_type_idx ON content_strategy_templates(industry, type)`,
      `CREATE INDEX IF NOT EXISTS content_strategy_templates_enabled_idx ON content_strategy_templates(enabled)`,
      `CREATE INDEX IF NOT EXISTS materials_owner_id_platform_idx ON materials(owner_id, platform)`,
      `CREATE INDEX IF NOT EXISTS articles_parent_id_idx ON articles(parent_id)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_tenant_id_checked_at_idx ON compliance_checks(tenant_id, checked_at)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_user_id_checked_at_idx ON compliance_checks(user_id, checked_at)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_material_id_idx ON compliance_checks(material_id)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_topic_id_idx ON compliance_checks(topic_id)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_redfox_call_log_id_idx ON compliance_checks(redfox_call_log_id)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_target_type_target_id_idx ON compliance_checks(target_type, target_id)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_platform_idx ON compliance_checks(platform)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_risk_level_idx ON compliance_checks(risk_level)`,
      `CREATE INDEX IF NOT EXISTS compliance_checks_status_idx ON compliance_checks(status)`,
      `CREATE INDEX IF NOT EXISTS content_drafts_user_id_updated_at_idx ON content_drafts(user_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS content_drafts_tenant_id_updated_at_idx ON content_drafts(tenant_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS content_optimization_runs_draft_id_created_at_idx ON content_optimization_runs(draft_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_optimization_runs_user_id_updated_at_idx ON content_optimization_runs(user_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS content_versions_user_id_updated_at_idx ON content_versions(user_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS content_versions_tenant_id_updated_at_idx ON content_versions(tenant_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS content_versions_draft_id_version_no_idx ON content_versions(draft_id, version_no)`,
      `CREATE INDEX IF NOT EXISTS content_versions_status_idx ON content_versions(status)`,
      `CREATE INDEX IF NOT EXISTS content_versions_is_official_idx ON content_versions(is_official)`,
      `CREATE INDEX IF NOT EXISTS content_publish_intents_version_id_idx ON content_publish_intents(version_id)`,
      `CREATE INDEX IF NOT EXISTS content_publish_intents_user_id_created_at_idx ON content_publish_intents(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_manual_reviews_version_id_created_at_idx ON content_manual_reviews(version_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_manual_reviews_user_id_created_at_idx ON content_manual_reviews(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_publish_feedback_version_id_created_at_idx ON content_publish_feedback(version_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_publish_feedback_user_id_created_at_idx ON content_publish_feedback(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_version_comments_version_id_created_at_idx ON content_version_comments(version_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_version_comments_user_id_created_at_idx ON content_version_comments(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS content_evidence_logs_target_type_target_id_idx ON content_evidence_logs(target_type, target_id)`,
      `CREATE INDEX IF NOT EXISTS content_evidence_logs_user_id_created_at_idx ON content_evidence_logs(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_sourceArticleId_idx ON interaction_tasks(sourceArticleId)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_publishRecordId_idx ON interaction_tasks(publishRecordId)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_identity_id_idx ON interaction_events(identity_id)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_content_id_idx ON interaction_events(content_id)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_parent_event_id_idx ON interaction_events(parent_event_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_corp_configs_user_id_idx ON wecom_corp_configs(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_corp_configs_status_idx ON wecom_corp_configs(status)`,
      `CREATE INDEX IF NOT EXISTS wecom_group_msg_tasks_user_id_idx ON wecom_group_msg_tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_group_msg_tasks_config_id_idx ON wecom_group_msg_tasks(config_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_group_msg_tasks_wecom_msg_id_idx ON wecom_group_msg_tasks(wecom_msg_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_moment_tasks_user_id_idx ON wecom_moment_tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_moment_tasks_config_id_idx ON wecom_moment_tasks(config_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_moment_tasks_wecom_job_id_idx ON wecom_moment_tasks(wecom_job_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_contacts_config_id_idx ON wecom_contacts(config_id)`,
      `CREATE INDEX IF NOT EXISTS boss_accounts_user_id_idx ON boss_accounts(user_id)`,
      `CREATE INDEX IF NOT EXISTS boss_candidates_user_id_idx ON boss_candidates(user_id)`,
      `CREATE INDEX IF NOT EXISTS boss_candidates_account_id_idx ON boss_candidates(account_id)`,
      `CREATE INDEX IF NOT EXISTS boss_tasks_user_id_idx ON boss_tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS boss_tasks_account_id_idx ON boss_tasks(account_id)`,
      `CREATE INDEX IF NOT EXISTS boss_tasks_status_idx ON boss_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS growth_strategies_user_id_idx ON growth_strategies(user_id)`,
      `CREATE INDEX IF NOT EXISTS growth_strategies_tenant_id_idx ON growth_strategies(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_configs_user_id_status_idx ON growth_acquisition_configs(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_configs_user_id_schedule_enabled_idx ON growth_acquisition_configs(user_id, schedule_enabled)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_configs_tenant_id_status_idx ON growth_acquisition_configs(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_configs_tenant_id_schedule_enabled_idx ON growth_acquisition_configs(tenant_id, schedule_enabled)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_configs_platform_account_id_idx ON growth_acquisition_configs(platform, account_id)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_runs_user_id_started_at_idx ON growth_acquisition_runs(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_runs_tenant_id_started_at_idx ON growth_acquisition_runs(tenant_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS growth_acquisition_runs_config_id_started_at_idx ON growth_acquisition_runs(config_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS rpa_executions_user_id_started_at_idx ON rpa_executions(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS rpa_executions_tenant_id_started_at_idx ON rpa_executions(tenant_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS rpa_executions_platform_status_idx ON rpa_executions(platform, status)`,
      `CREATE INDEX IF NOT EXISTS rpa_executions_run_id_idx ON rpa_executions(run_id)`,
      // P1 复核：同账号活动执行数据库级唯一约束（部分唯一索引）。
      // 同一用户同平台同账号，同时只能有一条活动执行（running/paused/needs-human）。
      // 并发创建时第二个会因唯一约束冲突失败 → createWithLock 捕获后转为 account_busy。
      `CREATE UNIQUE INDEX IF NOT EXISTS rpa_executions_active_account_unique ON rpa_executions(user_id, platform, account_id) WHERE status IN ('running', 'paused', 'needs-human')`,
      // P1-4 复核：租户共享账号互斥（同租户成员用同一纳管账号也锁住）
      `CREATE UNIQUE INDEX IF NOT EXISTS rpa_executions_active_account_tenant_unique ON rpa_executions(tenant_id, platform, account_id) WHERE status IN ('running', 'paused', 'needs-human') AND tenant_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS growth_leads_user_id_status_idx ON growth_leads(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_leads_user_id_platform_idx ON growth_leads(user_id, platform)`,
      `CREATE INDEX IF NOT EXISTS growth_leads_tenant_id_status_idx ON growth_leads(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_leads_tenant_id_platform_idx ON growth_leads(tenant_id, platform)`,
      `CREATE INDEX IF NOT EXISTS growth_leads_source_task_id_idx ON growth_leads(source_task_id)`,
      `CREATE INDEX IF NOT EXISTS growth_account_health_user_id_risk_status_idx ON growth_account_health(user_id, risk_status)`,
      `CREATE INDEX IF NOT EXISTS growth_account_health_tenant_id_risk_status_idx ON growth_account_health(tenant_id, risk_status)`,
      `CREATE INDEX IF NOT EXISTS growth_account_health_snapshots_user_id_platform_account_id_checked_at_idx ON growth_account_health_snapshots(user_id, platform, account_id, checked_at)`,
      `CREATE INDEX IF NOT EXISTS growth_account_health_snapshots_tenant_id_platform_account_id_idx ON growth_account_health_snapshots(tenant_id, platform, account_id)`,
      `CREATE INDEX IF NOT EXISTS growth_workflows_user_id_status_idx ON growth_workflows(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_workflows_tenant_id_status_idx ON growth_workflows(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_tenant_id_idx ON growth_scheduler_leases(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_user_id_idx ON growth_scheduler_leases(user_id)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_locked_until_idx ON growth_scheduler_leases(locked_until)`,
      `CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id)`,
      `CREATE INDEX IF NOT EXISTS brand_knowledge_tenant_id_idx ON brand_knowledge(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS account_subscriptions_tenant_id_user_id_idx ON account_subscriptions(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS user_memories_user_id_type_idx ON user_memories(user_id, type)`,
      `CREATE INDEX IF NOT EXISTS user_memories_user_id_priority_idx ON user_memories(user_id, priority)`,
      `CREATE INDEX IF NOT EXISTS ai_chat_logs_user_id_created_at_idx ON ai_chat_logs(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS ai_tool_call_logs_user_id_created_at_idx ON ai_tool_call_logs(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS ai_call_traces_user_id_created_at_idx ON ai_call_traces(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS ai_call_traces_scene_created_at_idx ON ai_call_traces(scene, created_at)`,
      `CREATE INDEX IF NOT EXISTS mobile_devices_user_id_idx ON mobile_devices(user_id)`,
      `CREATE INDEX IF NOT EXISTS mobile_devices_device_token_hash_idx ON mobile_devices(device_token_hash)`,
      `CREATE INDEX IF NOT EXISTS executor_tasks_user_id_status_idx ON executor_tasks(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS executor_tasks_device_id_idx ON executor_tasks(device_id)`,
      `CREATE INDEX IF NOT EXISTS offer_snapshots_vendor_code_platform_code_item_id_idx ON offer_snapshots(vendor_code, platform_code, item_id)`,
      `CREATE INDEX IF NOT EXISTS offer_snapshots_master_id_idx ON offer_snapshots(master_id)`,
      `CREATE INDEX IF NOT EXISTS price_watches_tenant_id_user_id_status_idx ON price_watches(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS cps_promo_links_tenant_id_user_id_idx ON cps_promo_links(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS cps_orders_tenant_id_user_id_status_idx ON cps_orders(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS rebate_ledgers_tenant_id_user_id_created_at_idx ON rebate_ledgers(tenant_id, user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS rebate_withdrawals_tenant_id_user_id_status_idx ON rebate_withdrawals(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS rebate_exchanges_tenant_id_user_id_idx ON rebate_exchanges(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS price_histories_tenant_id_user_id_snapshot_at_idx ON price_histories(tenant_id, user_id, snapshot_at)`,
      `CREATE INDEX IF NOT EXISTS price_histories_item_id_snapshot_at_idx ON price_histories(item_id, snapshot_at)`,
      `CREATE INDEX IF NOT EXISTS stores_tenant_id_status_idx ON stores(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS procurement_lists_tenant_id_user_id_idx ON procurement_lists(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS procurement_lists_store_id_idx ON procurement_lists(store_id)`,
      `CREATE INDEX IF NOT EXISTS cps_favorites_tenant_id_user_id_created_at_idx ON cps_favorites(tenant_id, user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS savings_checkins_tenant_id_user_id_checkin_date_idx ON savings_checkins(tenant_id, user_id, checkin_date)`,
      `CREATE INDEX IF NOT EXISTS poi_stores_tenant_id_user_id_status_idx ON poi_stores(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS poi_stores_tenant_id_user_id_city_idx ON poi_stores(tenant_id, user_id, city)`,
      `CREATE INDEX IF NOT EXISTS exposure_accounts_user_id_idx ON exposure_accounts(user_id)`,
      `CREATE INDEX IF NOT EXISTS activation_events_tenant_id_event_type_created_at_idx ON activation_events(tenant_id, event_type, created_at)`,
      `CREATE INDEX IF NOT EXISTS source_contents_tenant_id_platform_account_id_collected_at_idx ON source_contents(tenant_id, platform, account_id, collected_at)`,
      `CREATE INDEX IF NOT EXISTS suppressions_tenant_id_kind_normalized_value_idx ON suppressions(tenant_id, kind, normalized_value)`,
      `CREATE INDEX IF NOT EXISTS lead_signals_tenant_id_type_idx ON lead_signals(tenant_id, type)`,
      `CREATE TABLE IF NOT EXISTS lead_event_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        consumed_at DATETIME
      )`,
      `CREATE INDEX IF NOT EXISTS lead_event_outbox_status_created_idx ON lead_event_outbox(status, created_at)`,
      `CREATE TABLE IF NOT EXISTS schedule_configs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        task_type TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        config JSONB,
        last_run_time DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS schedule_configs_user_task_key ON schedule_configs(user_id, task_type)`,
      `CREATE TABLE IF NOT EXISTS app_install_states (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        actor_user_id TEXT,
        app_key TEXT NOT NULL,
        purchase_status TEXT NOT NULL DEFAULT 'not_purchased',
        install_status TEXT NOT NULL DEFAULT 'not_installed',
        entitlement_snapshot JSONB,
        settings JSONB,
        purchased_at DATETIME,
        installed_at DATETIME,
        uninstalled_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT app_install_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS app_install_states_user_id_app_key_key ON app_install_states(user_id, app_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS app_install_states_tenant_id_app_key_key ON app_install_states(tenant_id, app_key)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_user_id_idx ON app_install_states(user_id)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_tenant_id_idx ON app_install_states(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_actor_user_id_idx ON app_install_states(actor_user_id)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_app_key_idx ON app_install_states(app_key)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_purchase_status_idx ON app_install_states(purchase_status)`,
      `CREATE INDEX IF NOT EXISTS app_install_states_install_status_idx ON app_install_states(install_status)`,
      `CREATE TABLE IF NOT EXISTS wecom_assistant_integrations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        encrypted_webhook_url TEXT NOT NULL,
        masked_webhook_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_tested_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_assistant_settings (
        id TEXT PRIMARY KEY NOT NULL,
        integration_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        brand_name TEXT,
        store_name TEXT,
        reply_style TEXT,
        transfer_keywords JSONB NOT NULL DEFAULT '[]',
        send_to_wecom BOOLEAN NOT NULL DEFAULT true,
        auto_send_to_customer BOOLEAN NOT NULL DEFAULT false,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT wecom_assistant_settings_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES wecom_assistant_integrations(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_outbound_messages (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        integration_id TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'wecom',
        message_type TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT wecom_outbound_messages_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES wecom_assistant_integrations(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS wecom_assistant_settings_integration_id_key ON wecom_assistant_settings(integration_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_assistant_integrations_user_id_idx ON wecom_assistant_integrations(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_assistant_integrations_status_idx ON wecom_assistant_integrations(status)`,
      `CREATE INDEX IF NOT EXISTS wecom_assistant_integrations_updated_at_idx ON wecom_assistant_integrations(updated_at)`,
      `CREATE INDEX IF NOT EXISTS wecom_assistant_settings_user_id_idx ON wecom_assistant_settings(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_outbound_messages_user_id_idx ON wecom_outbound_messages(user_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_outbound_messages_integration_id_idx ON wecom_outbound_messages(integration_id)`,
      `CREATE INDEX IF NOT EXISTS wecom_outbound_messages_status_idx ON wecom_outbound_messages(status)`,
      `CREATE INDEX IF NOT EXISTS wecom_outbound_messages_created_at_idx ON wecom_outbound_messages(created_at)`,
      `CREATE TABLE IF NOT EXISTS crm_companies (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        name TEXT NOT NULL,
        domain TEXT,
        industry TEXT,
        phone TEXT,
        website TEXT,
        city TEXT,
        employees INTEGER,
        annual_revenue_cents INTEGER NOT NULL DEFAULT 0,
        owner_user_id TEXT,
        tags JSONB NOT NULL DEFAULT '[]',
        metadata JSONB,
        archived_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_companies_owner_id_idx ON crm_companies(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_companies_tenant_id_idx ON crm_companies(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_companies_name_idx ON crm_companies(name)`,
      `CREATE INDEX IF NOT EXISTS crm_companies_domain_idx ON crm_companies(domain)`,
      `CREATE INDEX IF NOT EXISTS crm_companies_industry_idx ON crm_companies(industry)`,
      `CREATE INDEX IF NOT EXISTS crm_companies_updated_at_idx ON crm_companies(updated_at)`,
      `CREATE TABLE IF NOT EXISTS crm_customers (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        display_name TEXT NOT NULL,
        company_id TEXT,
        title TEXT,
        email TEXT,
        phone TEXT,
        wechat TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        source_platform TEXT,
        source_keyword TEXT,
        matched_keyword TEXT,
        source_url TEXT,
        source_text TEXT,
        latest_reply TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        tags JSONB NOT NULL DEFAULT '[]',
        profile_url TEXT,
        external_user_id TEXT,
        dedupe_key TEXT,
        assigned_user_id TEXT,
        first_interaction_task_id TEXT,
        latest_interaction_task_id TEXT,
        metadata JSONB,
        archived_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_owner_id_dedupe_key_key ON crm_customers(owner_id, dedupe_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_tenant_id_dedupe_key_key ON crm_customers(tenant_id, dedupe_key)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_owner_id_idx ON crm_customers(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_tenant_id_idx ON crm_customers(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_company_id_idx ON crm_customers(company_id)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_status_idx ON crm_customers(status)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_email_idx ON crm_customers(email)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_phone_idx ON crm_customers(phone)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_source_platform_idx ON crm_customers(source_platform)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_source_keyword_idx ON crm_customers(source_keyword)`,
      `CREATE INDEX IF NOT EXISTS crm_customers_updated_at_idx ON crm_customers(updated_at)`,
      `CREATE TABLE IF NOT EXISTS crm_opportunities (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        name TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'qualified',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        probability INTEGER NOT NULL DEFAULT 20,
        company_id TEXT,
        primary_customer_id TEXT,
        close_date DATETIME,
        next_step TEXT,
        competitor TEXT,
        source TEXT,
        metadata JSONB,
        archived_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_owner_id_idx ON crm_opportunities(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_tenant_id_idx ON crm_opportunities(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_company_id_idx ON crm_opportunities(company_id)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_primary_customer_id_idx ON crm_opportunities(primary_customer_id)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_stage_idx ON crm_opportunities(stage)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_close_date_idx ON crm_opportunities(close_date)`,
      `CREATE INDEX IF NOT EXISTS crm_opportunities_updated_at_idx ON crm_opportunities(updated_at)`,
      `CREATE TABLE IF NOT EXISTS crm_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        due_at DATETIME,
        completed_at DATETIME,
        assignee_id TEXT,
        company_id TEXT,
        customer_id TEXT,
        opportunity_id TEXT,
        metadata JSONB,
        archived_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_owner_id_idx ON crm_tasks(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_tenant_id_idx ON crm_tasks(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_company_id_idx ON crm_tasks(company_id)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_customer_id_idx ON crm_tasks(customer_id)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_opportunity_id_idx ON crm_tasks(opportunity_id)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_status_idx ON crm_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_priority_idx ON crm_tasks(priority)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_due_at_idx ON crm_tasks(due_at)`,
      `CREATE INDEX IF NOT EXISTS crm_tasks_updated_at_idx ON crm_tasks(updated_at)`,
      `CREATE TABLE IF NOT EXISTS crm_notes (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        body TEXT NOT NULL,
        created_by TEXT,
        company_id TEXT,
        customer_id TEXT,
        opportunity_id TEXT,
        metadata JSONB,
        archived_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_notes_owner_id_idx ON crm_notes(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_notes_tenant_id_idx ON crm_notes(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_notes_company_id_idx ON crm_notes(company_id)`,
      `CREATE INDEX IF NOT EXISTS crm_notes_customer_id_idx ON crm_notes(customer_id)`,
      `CREATE INDEX IF NOT EXISTS crm_notes_opportunity_id_idx ON crm_notes(opportunity_id)`,
      `CREATE INDEX IF NOT EXISTS crm_notes_created_at_idx ON crm_notes(created_at)`,
      `CREATE TABLE IF NOT EXISTS crm_timeline_events (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        customer_id TEXT,
        company_id TEXT,
        opportunity_id TEXT,
        task_id TEXT,
        note_id TEXT,
        related_interaction_task_id TEXT,
        related_runtime_execution_id TEXT,
        event_type TEXT NOT NULL,
        channel TEXT,
        content TEXT,
        reply_content TEXT,
        status TEXT,
        failure_reason TEXT,
        evidence JSONB,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_owner_id_idx ON crm_timeline_events(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_tenant_id_idx ON crm_timeline_events(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_customer_id_idx ON crm_timeline_events(customer_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_company_id_idx ON crm_timeline_events(company_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_opportunity_id_idx ON crm_timeline_events(opportunity_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_task_id_idx ON crm_timeline_events(task_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_note_id_idx ON crm_timeline_events(note_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_related_interaction_task_id_idx ON crm_timeline_events(related_interaction_task_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_related_runtime_execution_id_idx ON crm_timeline_events(related_runtime_execution_id)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_event_type_idx ON crm_timeline_events(event_type)`,
      `CREATE INDEX IF NOT EXISTS crm_timeline_events_created_at_idx ON crm_timeline_events(created_at)`,
      `CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        summary TEXT,
        source_url TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT 'Other',
        author TEXT NOT NULL DEFAULT '',
        publish_date DATETIME,
        collect_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'unmined',
        mining_count INTEGER NOT NULL DEFAULT 0,
        keywords JSONB NOT NULL DEFAULT '[]',
        metadata JSONB,
        image_url TEXT,
        original_image_url TEXT,
        hasImage BOOLEAN NOT NULL DEFAULT false,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS materials_status_idx ON materials(status)`,
      `CREATE INDEX IF NOT EXISTS materials_collect_date_idx ON materials(collect_date)`,
      `CREATE INDEX IF NOT EXISTS materials_platform_idx ON materials(platform)`,
      `CREATE INDEX IF NOT EXISTS materials_hasImage_idx ON materials(hasImage)`,
      `CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        title TEXT NOT NULL,
        description TEXT,
        summary TEXT,
        source_type TEXT NOT NULL DEFAULT '外部采集',
        keywords JSONB NOT NULL DEFAULT '[]',
        ai_score REAL,
        score_details JSONB,
        score_reason TEXT,
        reasoning TEXT,
        search_queries JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        is_published BOOLEAN NOT NULL DEFAULT false,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS topics_status_idx ON topics(status)`,
      `CREATE INDEX IF NOT EXISTS topics_is_published_idx ON topics(is_published)`,
      `CREATE INDEX IF NOT EXISTS topics_created_at_idx ON topics(created_at)`,
      `CREATE INDEX IF NOT EXISTS topics_tenant_user_idx ON topics(tenant_id, user_id)`,
      `CREATE TABLE IF NOT EXISTS styles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        prompt_template TEXT NOT NULL DEFAULT '',
        parameters JSONB,
        is_default BOOLEAN NOT NULL DEFAULT false,
        type TEXT NOT NULL DEFAULT 'article',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS styles_name_key ON styles(name)`,
      `CREATE INDEX IF NOT EXISTS styles_type_idx ON styles(type)`,
      `CREATE TABLE IF NOT EXISTS ai_platforms (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        api_key TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT true,
        config JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_platforms_name_key ON ai_platforms(name)`,
      `CREATE TABLE IF NOT EXISTS ai_models (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        config JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ai_models_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES ai_platforms(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_models_platform_id_model_id_key ON ai_models(platform_id, model_id)`,
      `CREATE TABLE IF NOT EXISTS default_model_configs (
        id TEXT PRIMARY KEY NOT NULL,
        purpose TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS default_model_configs_purpose_key ON default_model_configs(purpose)`,
      `CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        topic_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT 'article',
        content_format TEXT NOT NULL DEFAULT 'markdown',
        workspace_brief JSONB,
        workspace_outline JSONB,
        workspace_step TEXT NOT NULL DEFAULT 'brief',
        workspace_revision INTEGER NOT NULL DEFAULT 1,
        xiaohongshu_data JSONB,
        raw_html TEXT,
        final_html TEXT,
        template_id TEXT,
        style_id TEXT,
        model_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        cover_image TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT articles_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT articles_style_id_fkey FOREIGN KEY (style_id) REFERENCES styles(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT articles_model_id_fkey FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS articles_status_idx ON articles(status)`,
      `CREATE INDEX IF NOT EXISTS articles_topic_id_idx ON articles(topic_id)`,
      `CREATE INDEX IF NOT EXISTS articles_content_type_idx ON articles(content_type)`,
      `CREATE INDEX IF NOT EXISTS articles_template_id_idx ON articles(template_id)`,
      `CREATE INDEX IF NOT EXISTS articles_tenant_id_user_id_created_at_idx ON articles(tenant_id, user_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS topic_materials (
        topic_id TEXT NOT NULL,
        material_id TEXT NOT NULL,
        PRIMARY KEY (topic_id, material_id),
        CONSTRAINT topic_materials_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT topic_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        config JSONB,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_crawl_time DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS sources_enabled_idx ON sources(enabled)`,
      `CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS system_logs_created_at_idx ON system_logs(created_at)`,
      `CREATE INDEX IF NOT EXISTS system_logs_level_idx ON system_logs(level)`,
      `CREATE TABLE IF NOT EXISTS publish_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        platform TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        app_id TEXT,
        api_token TEXT,
        config JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS publish_accounts_tenant_id_user_id_created_at_idx ON publish_accounts(tenant_id, user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS publish_accounts_tenant_id_user_id_platform_status_idx ON publish_accounts(tenant_id, user_id, platform, status)`,
      `CREATE TABLE IF NOT EXISTS publish_records (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        durable_record_id TEXT,
        article_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        publish_url TEXT,
        error_message TEXT,
        source_identity JSONB,
        body_snapshot TEXT,
        payload_json JSONB,
        result_json JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT publish_records_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT publish_records_account_id_fkey FOREIGN KEY (account_id) REFERENCES publish_accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS publish_records_article_id_idx ON publish_records(article_id)`,
      `CREATE INDEX IF NOT EXISTS publish_records_account_id_idx ON publish_records(account_id)`,
      `CREATE INDEX IF NOT EXISTS publish_records_status_idx ON publish_records(status)`,
      `CREATE INDEX IF NOT EXISTS publish_records_tenant_id_user_id_created_at_idx ON publish_records(tenant_id, user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS publish_records_tenant_id_user_id_durable_record_id_idx ON publish_records(tenant_id, user_id, durable_record_id)`,
      `CREATE TABLE IF NOT EXISTS interaction_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        taskType TEXT NOT NULL,
        accountId TEXT,
        sessionId TEXT,
        ruleId TEXT,
        sendMode TEXT NOT NULL DEFAULT 'approval-send',
        status TEXT NOT NULL DEFAULT 'QUEUED',
        riskLevel TEXT NOT NULL DEFAULT 'medium',
        stage TEXT,
        currentTarget TEXT,
        draftText TEXT,
        processedCount INTEGER NOT NULL DEFAULT 0,
        failedCount INTEGER NOT NULL DEFAULT 0,
        skippedCount INTEGER NOT NULL DEFAULT 0,
        batchTargets JSONB,
        batchSummary JSONB,
        events JSONB NOT NULL DEFAULT '[]',
        evidence JSONB NOT NULL DEFAULT '[]',
        config JSONB,
        createdBy TEXT,
        localTaskId TEXT,
        requiresDoubleConfirmation BOOLEAN NOT NULL DEFAULT false,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        claimedBy TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_status_idx ON interaction_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_taskType_idx ON interaction_tasks(taskType)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_tenant_id_user_id_status_idx ON interaction_tasks(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_tenant_id_user_id_taskType_idx ON interaction_tasks(tenant_id, user_id, taskType)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_tenant_id_user_id_createdAt_idx ON interaction_tasks(tenant_id, user_id, createdAt)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_accountId_idx ON interaction_tasks(accountId)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_sessionId_idx ON interaction_tasks(sessionId)`,
      `CREATE INDEX IF NOT EXISTS interaction_tasks_createdAt_idx ON interaction_tasks(createdAt)`,
      `CREATE TABLE IF NOT EXISTS interaction_task_events (
        id TEXT PRIMARY KEY NOT NULL,
        taskId TEXT NOT NULL,
        stage TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        payload JSONB,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS interaction_task_events_taskId_idx ON interaction_task_events(taskId)`,
      `CREATE INDEX IF NOT EXISTS interaction_task_events_createdAt_idx ON interaction_task_events(createdAt)`,
      `CREATE TABLE IF NOT EXISTS interaction_events (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        platform TEXT NOT NULL,
        account_id TEXT,
        channel TEXT NOT NULL DEFAULT 'comment',
        external_event_id TEXT,
        external_thread_id TEXT,
        author_external_id TEXT,
        source_url TEXT,
        source_article_id TEXT,
        publish_record_id TEXT,
        body TEXT,
        dedupe_key TEXT NOT NULL,
        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        raw JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS interaction_events_tenant_dedupe_key ON interaction_events(tenant_id, dedupe_key)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_tenant_platform_account_idx ON interaction_events(tenant_id, platform, account_id, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_source_article_idx ON interaction_events(source_article_id)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_publish_record_idx ON interaction_events(publish_record_id)`,
      `CREATE INDEX IF NOT EXISTS interaction_events_author_idx ON interaction_events(author_external_id)`,
      `CREATE TABLE IF NOT EXISTS local_engine_reply_rules (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        bot_key TEXT NOT NULL DEFAULT 'default',
        config_version INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1,
        name TEXT,
        industry TEXT,
        tone TEXT,
        send_mode TEXT,
        keywords JSONB NOT NULL DEFAULT '[]',
        forbidden_words JSONB NOT NULL DEFAULT '[]',
        highlights JSONB NOT NULL DEFAULT '[]',
        closing_text TEXT,
        rule_json JSONB NOT NULL DEFAULT '{}',
        escalation_rules JSONB,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS local_engine_reply_rules_tenant_id_user_id_bot_key_key ON local_engine_reply_rules(tenant_id, user_id, bot_key)`,
      `CREATE INDEX IF NOT EXISTS local_engine_reply_rules_tenant_id_user_id_updated_at_idx ON local_engine_reply_rules(tenant_id, user_id, updated_at)`,
      `CREATE TABLE IF NOT EXISTS local_engine_agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        source TEXT NOT NULL DEFAULT 'web',
        status TEXT NOT NULL DEFAULT 'draft',
        title TEXT NOT NULL DEFAULT '',
        scope TEXT,
        target_app TEXT,
        instruction TEXT,
        risk_level TEXT,
        events JSONB DEFAULT '[]',
        confirmations JSONB DEFAULT '[]',
        evidence JSONB DEFAULT '[]',
        session_json JSONB NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_source_idx ON local_engine_agent_sessions(source)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_status_idx ON local_engine_agent_sessions(status)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_tenant_id_user_id_source_idx ON local_engine_agent_sessions(tenant_id, user_id, source)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_tenant_id_user_id_status_idx ON local_engine_agent_sessions(tenant_id, user_id, status)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_tenant_id_user_id_updated_at_idx ON local_engine_agent_sessions(tenant_id, user_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_sessions_updated_at_idx ON local_engine_agent_sessions(updated_at)`,
      `CREATE TABLE IF NOT EXISTS local_engine_agent_confirmations (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        session_id TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        risk_level TEXT NOT NULL DEFAULT 'low',
        target TEXT,
        target_label TEXT,
        content TEXT,
        reply_text TEXT,
        operator TEXT,
        note TEXT,
        confirmation_json JSONB NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at DATETIME
      )`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_confirmations_session_id_idx ON local_engine_agent_confirmations(session_id)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_confirmations_status_idx ON local_engine_agent_confirmations(status)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_confirmations_tenant_id_user_id_session_id_idx ON local_engine_agent_confirmations(tenant_id, user_id, session_id)`,
      `CREATE INDEX IF NOT EXISTS local_engine_agent_confirmations_tenant_id_user_id_status_idx ON local_engine_agent_confirmations(tenant_id, user_id, status)`,
      `CREATE TABLE IF NOT EXISTS geo_bridge_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        action_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent_to_ai_content',
        source TEXT NOT NULL DEFAULT 'kaypal-geo',
        brand_id TEXT,
        brand_name TEXT,
        platform TEXT,
        brief TEXT,
        goal TEXT,
        reason TEXT,
        retest_window TEXT,
        return_url TEXT,
        callback_url TEXT,
        keyword TEXT,
        content_preview TEXT,
        result_url TEXT,
        published_url TEXT,
        last_callback_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS geo_bridge_tasks_action_id_key ON geo_bridge_tasks(action_id)`,
      `CREATE INDEX IF NOT EXISTS geo_bridge_tasks_status_idx ON geo_bridge_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS geo_bridge_tasks_platform_idx ON geo_bridge_tasks(platform)`,
      `CREATE INDEX IF NOT EXISTS geo_bridge_tasks_brand_name_idx ON geo_bridge_tasks(brand_name)`,
      `CREATE INDEX IF NOT EXISTS geo_bridge_tasks_updated_at_idx ON geo_bridge_tasks(updated_at)`,
      `CREATE TABLE IF NOT EXISTS redfox_connections (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'RedFox',
        api_key_encrypted TEXT NOT NULL,
        api_key_masked TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        daily_call_limit INTEGER,
        daily_cost_limit INTEGER,
        last_test_at DATETIME,
        last_error TEXT,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_connections_tenant_id_user_id_key ON redfox_connections(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_connections_user_id_idx ON redfox_connections(user_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_connections_tenant_id_idx ON redfox_connections(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_connections_status_idx ON redfox_connections(status)`,
      `CREATE TABLE IF NOT EXISTS redfox_skills (
        id TEXT PRIMARY KEY NOT NULL,
        skill_no TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT,
        category TEXT,
        tags JSONB NOT NULL DEFAULT '[]',
        summary TEXT,
        description TEXT,
        input_schema JSONB,
        output_schema JSONB,
        status TEXT NOT NULL DEFAULT 'active',
        raw JSONB,
        synced_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_skills_skill_no_key ON redfox_skills(skill_no)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_skills_code_key ON redfox_skills(code)`,
      `CREATE INDEX IF NOT EXISTS redfox_skills_platform_idx ON redfox_skills(platform)`,
      `CREATE INDEX IF NOT EXISTS redfox_skills_category_idx ON redfox_skills(category)`,
      `CREATE INDEX IF NOT EXISTS redfox_skills_status_idx ON redfox_skills(status)`,
      `CREATE INDEX IF NOT EXISTS redfox_skills_synced_at_idx ON redfox_skills(synced_at)`,
      `CREATE TABLE IF NOT EXISTS redfox_skill_installs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        scenario TEXT NOT NULL DEFAULT 'general',
        config JSONB,
        usage_policy JSONB,
        last_used_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_skill_installs_tenant_id_skill_id_scenario_key ON redfox_skill_installs(tenant_id, skill_id, scenario)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_skill_installs_user_id_skill_id_scenario_key ON redfox_skill_installs(user_id, skill_id, scenario)`,
      `CREATE INDEX IF NOT EXISTS redfox_skill_installs_tenant_id_enabled_idx ON redfox_skill_installs(tenant_id, enabled)`,
      `CREATE INDEX IF NOT EXISTS redfox_skill_installs_user_id_enabled_idx ON redfox_skill_installs(user_id, enabled)`,
      `CREATE INDEX IF NOT EXISTS redfox_skill_installs_skill_id_idx ON redfox_skill_installs(skill_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_skill_installs_scenario_idx ON redfox_skill_installs(scenario)`,
      `CREATE TABLE IF NOT EXISTS redfox_interfaces (
        id TEXT PRIMARY KEY NOT NULL,
        platform_code TEXT NOT NULL,
        platform_name TEXT,
        interface_no TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'POST',
        scenario TEXT,
        status TEXT NOT NULL DEFAULT 'online',
        category TEXT,
        description TEXT,
        price REAL,
        min_price REAL,
        require_auth BOOLEAN NOT NULL DEFAULT true,
        parameters JSONB,
        examples JSONB,
        raw JSONB,
        synced_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_interfaces_interface_no_key ON redfox_interfaces(interface_no)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_interfaces_code_key ON redfox_interfaces(code)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS redfox_interfaces_platform_code_path_method_key ON redfox_interfaces(platform_code, path, method)`,
      `CREATE INDEX IF NOT EXISTS redfox_interfaces_platform_code_idx ON redfox_interfaces(platform_code)`,
      `CREATE INDEX IF NOT EXISTS redfox_interfaces_path_idx ON redfox_interfaces(path)`,
      `CREATE INDEX IF NOT EXISTS redfox_interfaces_scenario_idx ON redfox_interfaces(scenario)`,
      `CREATE INDEX IF NOT EXISTS redfox_interfaces_status_idx ON redfox_interfaces(status)`,
      `CREATE INDEX IF NOT EXISTS redfox_interfaces_synced_at_idx ON redfox_interfaces(synced_at)`,
      `CREATE TABLE IF NOT EXISTS redfox_call_logs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        connection_id TEXT,
        skill_id TEXT,
        skill_code TEXT,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'POST',
        status TEXT NOT NULL DEFAULT 'pending',
        http_status INTEGER,
        cost_points INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        request_hash TEXT,
        request_summary JSONB,
        response_summary JSONB,
        error_code TEXT,
        error_message TEXT,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_tenant_id_started_at_idx ON redfox_call_logs(tenant_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_user_id_started_at_idx ON redfox_call_logs(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_connection_id_idx ON redfox_call_logs(connection_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_skill_id_idx ON redfox_call_logs(skill_id)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_skill_code_idx ON redfox_call_logs(skill_code)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_endpoint_idx ON redfox_call_logs(endpoint)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_status_idx ON redfox_call_logs(status)`,
      `CREATE INDEX IF NOT EXISTS redfox_call_logs_request_hash_idx ON redfox_call_logs(request_hash)`,
      `CREATE TABLE IF NOT EXISTS intelligence_items (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        source_id TEXT,
        redfox_skill_id TEXT,
        redfox_call_log_id TEXT,
        material_id TEXT,
        topic_id TEXT,
        growth_lead_id TEXT,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        summary TEXT,
        source_url TEXT,
        source_external_id TEXT,
        author TEXT,
        author_url TEXT,
        publish_date DATETIME,
        metrics JSONB NOT NULL DEFAULT '{}',
        keywords JSONB NOT NULL DEFAULT '[]',
        raw JSONB,
        status TEXT NOT NULL DEFAULT 'new',
        dedupe_key TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS intelligence_items_tenant_id_dedupe_key_key ON intelligence_items(tenant_id, dedupe_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS intelligence_items_user_id_dedupe_key_key ON intelligence_items(user_id, dedupe_key)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_tenant_id_type_idx ON intelligence_items(tenant_id, type)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_user_id_type_idx ON intelligence_items(user_id, type)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_platform_idx ON intelligence_items(platform)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_status_idx ON intelligence_items(status)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_source_id_idx ON intelligence_items(source_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_redfox_skill_id_idx ON intelligence_items(redfox_skill_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_redfox_call_log_id_idx ON intelligence_items(redfox_call_log_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_material_id_idx ON intelligence_items(material_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_topic_id_idx ON intelligence_items(topic_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_growth_lead_id_idx ON intelligence_items(growth_lead_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_items_created_at_idx ON intelligence_items(created_at)`,
      `CREATE TABLE IF NOT EXISTS benchmark_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        intelligence_item_id TEXT,
        growth_lead_id TEXT,
        platform TEXT NOT NULL,
        nickname TEXT NOT NULL,
        external_user_id TEXT,
        profile_url TEXT,
        avatar_url TEXT,
        metrics JSONB NOT NULL DEFAULT '{}',
        reason TEXT,
        diagnosis JSONB,
        status TEXT NOT NULL DEFAULT 'watching',
        raw JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS benchmark_accounts_tenant_id_platform_external_user_id_key ON benchmark_accounts(tenant_id, platform, external_user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS benchmark_accounts_user_id_platform_external_user_id_key ON benchmark_accounts(user_id, platform, external_user_id)`,
      `CREATE INDEX IF NOT EXISTS benchmark_accounts_tenant_id_status_idx ON benchmark_accounts(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS benchmark_accounts_user_id_status_idx ON benchmark_accounts(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS benchmark_accounts_platform_idx ON benchmark_accounts(platform)`,
      `CREATE INDEX IF NOT EXISTS benchmark_accounts_intelligence_item_id_idx ON benchmark_accounts(intelligence_item_id)`,
      `CREATE INDEX IF NOT EXISTS benchmark_accounts_growth_lead_id_idx ON benchmark_accounts(growth_lead_id)`,
      `CREATE TABLE IF NOT EXISTS intelligence_monitors (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        skill_install_id TEXT,
        type TEXT NOT NULL,
        platform TEXT,
        keyword TEXT,
        account_external_id TEXT,
        industry TEXT,
        schedule TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        config JSONB,
        cost_limit_points INTEGER,
        last_run_at DATETIME,
        next_run_at DATETIME,
        last_error TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_tenant_id_status_idx ON intelligence_monitors(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_user_id_status_idx ON intelligence_monitors(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_skill_install_id_idx ON intelligence_monitors(skill_install_id)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_type_idx ON intelligence_monitors(type)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_platform_idx ON intelligence_monitors(platform)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_keyword_idx ON intelligence_monitors(keyword)`,
      `CREATE INDEX IF NOT EXISTS intelligence_monitors_next_run_at_idx ON intelligence_monitors(next_run_at)`,
      `CREATE TABLE IF NOT EXISTS intelligence_reports (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        audience TEXT,
        owner TEXT,
        range_key TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        completeness INTEGER NOT NULL DEFAULT 0,
        findings JSONB NOT NULL DEFAULT '[]',
        evidence JSONB NOT NULL DEFAULT '[]',
        markdown TEXT NOT NULL,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS intelligence_reports_tenant_id_status_idx ON intelligence_reports(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS intelligence_reports_user_id_status_idx ON intelligence_reports(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS intelligence_reports_kind_idx ON intelligence_reports(kind)`,
      `CREATE INDEX IF NOT EXISTS intelligence_reports_updated_at_idx ON intelligence_reports(updated_at)`,
      `CREATE TABLE IF NOT EXISTS comment_insights (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        intelligence_item_id TEXT,
        growth_lead_id TEXT,
        redfox_call_log_id TEXT,
        platform TEXT NOT NULL,
        source_url TEXT,
        source_external_id TEXT,
        pain_points JSONB NOT NULL DEFAULT '[]',
        intent_keywords JSONB NOT NULL DEFAULT '[]',
        demand_signals JSONB NOT NULL DEFAULT '[]',
        objections JSONB NOT NULL DEFAULT '[]',
        reply_suggestions JSONB NOT NULL DEFAULT '[]',
        raw JSONB,
        analyzed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS comment_insights_tenant_id_analyzed_at_idx ON comment_insights(tenant_id, analyzed_at)`,
      `CREATE INDEX IF NOT EXISTS comment_insights_user_id_analyzed_at_idx ON comment_insights(user_id, analyzed_at)`,
      `CREATE INDEX IF NOT EXISTS comment_insights_intelligence_item_id_idx ON comment_insights(intelligence_item_id)`,
      `CREATE INDEX IF NOT EXISTS comment_insights_growth_lead_id_idx ON comment_insights(growth_lead_id)`,
      `CREATE INDEX IF NOT EXISTS comment_insights_redfox_call_log_id_idx ON comment_insights(redfox_call_log_id)`,
      `CREATE INDEX IF NOT EXISTS comment_insights_platform_idx ON comment_insights(platform)`,
      `CREATE TABLE IF NOT EXISTS crm_import_batches (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        source_type TEXT NOT NULL,
        filename TEXT,
        status TEXT NOT NULL DEFAULT 'committed',
        mode TEXT NOT NULL DEFAULT 'local-crm-write',
        row_count INTEGER NOT NULL DEFAULT 0,
        committed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        dry_run_id TEXT,
        dry_run_proof_hash TEXT,
        commit_proof_hash TEXT NOT NULL,
        rollback_token TEXT NOT NULL,
        rollback_proof_hash TEXT,
        rollback_reason TEXT,
        mapping JSONB NOT NULL DEFAULT '{}',
        quality_issues JSONB NOT NULL DEFAULT '[]',
        customer_ids JSONB NOT NULL DEFAULT '[]',
        write_tables JSONB NOT NULL DEFAULT '[]',
        external_network BOOLEAN NOT NULL DEFAULT false,
        external_crm_touched BOOLEAN NOT NULL DEFAULT false,
        committed_at DATETIME,
        rolled_back_at DATETIME,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_import_batches_rollback_token_key ON crm_import_batches(rollback_token)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_owner_id_idx ON crm_import_batches(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_tenant_id_idx ON crm_import_batches(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_source_type_idx ON crm_import_batches(source_type)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_status_idx ON crm_import_batches(status)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_commit_proof_hash_idx ON crm_import_batches(commit_proof_hash)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_dry_run_id_idx ON crm_import_batches(dry_run_id)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_committed_at_idx ON crm_import_batches(committed_at)`,
      `CREATE INDEX IF NOT EXISTS crm_import_batches_rolled_back_at_idx ON crm_import_batches(rolled_back_at)`,
      `CREATE TABLE IF NOT EXISTS crm_audit_events (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        tenant_id TEXT,
        import_batch_id TEXT,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        proof_hash TEXT,
        external_network BOOLEAN NOT NULL DEFAULT false,
        external_crm_touched BOOLEAN NOT NULL DEFAULT false,
        write_tables JSONB NOT NULL DEFAULT '[]',
        read_tables JSONB NOT NULL DEFAULT '[]',
        summary TEXT,
        payload JSONB,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_owner_id_idx ON crm_audit_events(owner_id)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_tenant_id_idx ON crm_audit_events(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_import_batch_id_idx ON crm_audit_events(import_batch_id)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_event_type_idx ON crm_audit_events(event_type)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_action_idx ON crm_audit_events(action)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_status_idx ON crm_audit_events(status)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_proof_hash_idx ON crm_audit_events(proof_hash)`,
      `CREATE INDEX IF NOT EXISTS crm_audit_events_created_at_idx ON crm_audit_events(created_at)`,
      `CREATE TABLE IF NOT EXISTS runtime_executions (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        relatedId TEXT NOT NULL,
        relatedType TEXT NOT NULL,
        executor TEXT NOT NULL,
        platform TEXT NOT NULL,
        taskType TEXT NOT NULL,
        accountId TEXT,
        ok BOOLEAN NOT NULL,
        status TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        userMessage TEXT NOT NULL,
        technicalMessage TEXT,
        runtimeJson JSONB NOT NULL,
        evidenceJson JSONB NOT NULL DEFAULT '[]',
        readbackJson JSONB,
        agentSSessionId TEXT,
        engineUrl TEXT,
        idempotency_key TEXT,
        request_hash TEXT,
        confirmation_id TEXT,
        auth_session_id TEXT,
        claim_token TEXT,
        claimed_at DATETIME,
        lease_expires_at DATETIME,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS brand_knowledge (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'brand',
        tags JSONB NOT NULL DEFAULT '[]',
        source TEXT,
        metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS brand_knowledge_user_id_created_at_idx ON brand_knowledge(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS brand_knowledge_user_id_type_idx ON brand_knowledge(user_id, type)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS runtime_executions_tenant_user_task_idempotency_key ON runtime_executions(tenant_id, user_id, taskType, idempotency_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS runtime_executions_durable_publish_related_id_key ON runtime_executions(tenant_id, user_id, relatedId) WHERE taskType = 'auto-upload-publish-record-v1'`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_relatedId_idx ON runtime_executions(relatedId)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_tenant_id_user_id_taskType_createdAt_idx ON runtime_executions(tenant_id, user_id, taskType, createdAt)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_taskType_status_lease_expires_at_createdAt_idx ON runtime_executions(taskType, status, lease_expires_at, createdAt)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_accountId_idx ON runtime_executions(accountId)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_executor_idx ON runtime_executions(executor)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_status_idx ON runtime_executions(status)`,
      `CREATE INDEX IF NOT EXISTS runtime_executions_createdAt_idx ON runtime_executions(createdAt)`,
      `CREATE TABLE IF NOT EXISTS solution_runs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        package_code TEXT NOT NULL,
        package_name TEXT NOT NULL,
        package_version TEXT NOT NULL DEFAULT '2026-07-01',
        catalog_snapshot_hash TEXT,
        trigger TEXT NOT NULL DEFAULT 'manual',
        source TEXT NOT NULL DEFAULT 'solutions',
        parent_run_id TEXT,
        correlation_id TEXT,
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        progress INTEGER NOT NULL DEFAULT 0,
        started_at DATETIME,
        ended_at DATETIME,
        duration_ms INTEGER,
        error_code TEXT,
        error_message TEXT,
        input_json JSONB NOT NULL DEFAULT '{}',
        resolved_plan_json JSONB NOT NULL DEFAULT '{}',
        data_object_mapping JSONB NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL DEFAULT 'medium',
        confirmation_policy TEXT NOT NULL DEFAULT 'manual_required',
        send_mode TEXT NOT NULL DEFAULT 'approval-send',
        dry_run BOOLEAN NOT NULL DEFAULT true,
        estimated_cost_points INTEGER NOT NULL DEFAULT 0,
        max_cost_points INTEGER NOT NULL DEFAULT 0,
        actual_cost_points INTEGER NOT NULL DEFAULT 0,
        cost_status TEXT NOT NULL DEFAULT 'estimated',
        summary_json JSONB NOT NULL DEFAULT '{}',
        output_refs JSONB NOT NULL DEFAULT '[]',
        acceptance_checks JSONB NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS solution_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'workflow_step',
        executor_kind TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'planned',
        depends_on JSONB NOT NULL DEFAULT '[]',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        retry_policy JSONB,
        queued_at DATETIME,
        started_at DATETIME,
        ended_at DATETIME,
        duration_ms INTEGER,
        input_json JSONB NOT NULL DEFAULT '{}',
        output_json JSONB,
        target_object TEXT,
        reason_code TEXT,
        error_message TEXT,
        runtime_execution_id TEXT,
        redfox_call_log_id TEXT,
        interaction_task_id TEXT,
        agent_session_id TEXT,
        agent_confirmation_id TEXT,
        intelligence_monitor_id TEXT,
        dedupe_key TEXT,
        request_hash TEXT,
        idempotency_key TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS solution_results (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        task_id TEXT,
        kind TEXT NOT NULL DEFAULT 'summary',
        status TEXT NOT NULL DEFAULT 'created',
        business_object_refs JSONB NOT NULL DEFAULT '[]',
        counts JSONB NOT NULL DEFAULT '{}',
        readback JSONB,
        quality_score INTEGER,
        completeness INTEGER,
        next_action TEXT,
        failure_reason TEXT,
        accepted_at DATETIME,
        approved_by TEXT,
        payload_summary JSONB,
        raw_result_json JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS solution_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        task_id TEXT,
        result_id TEXT,
        kind TEXT NOT NULL,
        uri TEXT,
        path TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        checksum TEXT,
        label TEXT,
        preview JSONB,
        source TEXT,
        object_ref JSONB,
        pii_level TEXT NOT NULL DEFAULT 'none',
        redaction_status TEXT NOT NULL DEFAULT 'not_required',
        retention_policy TEXT,
        metadata JSONB,
        created_by TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS solution_cost_entries (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        task_id TEXT,
        provider TEXT NOT NULL DEFAULT 'redfox',
        operation TEXT,
        skill_code TEXT,
        endpoint TEXT,
        estimated_cost_points INTEGER NOT NULL DEFAULT 0,
        authorized_cost_points INTEGER NOT NULL DEFAULT 0,
        captured_cost_points INTEGER NOT NULL DEFAULT 0,
        refunded_cost_points INTEGER NOT NULL DEFAULT 0,
        billing_status TEXT NOT NULL DEFAULT 'estimated',
        reservation_id TEXT,
        transaction_id TEXT,
        policy_version TEXT,
        request_hash TEXT,
        idempotency_key TEXT,
        latency_ms INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        redfox_call_log_id TEXT,
        runtime_execution_id TEXT,
        error_code TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS solution_runs_tenant_id_status_idx ON solution_runs(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_tenant_id_created_at_idx ON solution_runs(tenant_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_user_id_created_at_idx ON solution_runs(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_package_code_idx ON solution_runs(package_code)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_status_idx ON solution_runs(status)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_correlation_id_idx ON solution_runs(correlation_id)`,
      `CREATE INDEX IF NOT EXISTS solution_runs_idempotency_key_idx ON solution_runs(idempotency_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS solution_tasks_run_id_order_key ON solution_tasks(run_id, "order")`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_run_id_status_idx ON solution_tasks(run_id, status)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_status_idx ON solution_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_executor_kind_idx ON solution_tasks(executor_kind)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_redfox_call_log_id_idx ON solution_tasks(redfox_call_log_id)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_runtime_execution_id_idx ON solution_tasks(runtime_execution_id)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_interaction_task_id_idx ON solution_tasks(interaction_task_id)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_agent_confirmation_id_idx ON solution_tasks(agent_confirmation_id)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_dedupe_key_idx ON solution_tasks(dedupe_key)`,
      `CREATE INDEX IF NOT EXISTS solution_tasks_request_hash_idx ON solution_tasks(request_hash)`,
      `CREATE INDEX IF NOT EXISTS solution_results_run_id_idx ON solution_results(run_id)`,
      `CREATE INDEX IF NOT EXISTS solution_results_task_id_idx ON solution_results(task_id)`,
      `CREATE INDEX IF NOT EXISTS solution_results_kind_idx ON solution_results(kind)`,
      `CREATE INDEX IF NOT EXISTS solution_results_status_idx ON solution_results(status)`,
      `CREATE INDEX IF NOT EXISTS solution_results_created_at_idx ON solution_results(created_at)`,
      `CREATE INDEX IF NOT EXISTS solution_artifacts_run_id_idx ON solution_artifacts(run_id)`,
      `CREATE INDEX IF NOT EXISTS solution_artifacts_task_id_idx ON solution_artifacts(task_id)`,
      `CREATE INDEX IF NOT EXISTS solution_artifacts_result_id_idx ON solution_artifacts(result_id)`,
      `CREATE INDEX IF NOT EXISTS solution_artifacts_kind_idx ON solution_artifacts(kind)`,
      `CREATE INDEX IF NOT EXISTS solution_artifacts_created_at_idx ON solution_artifacts(created_at)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_run_id_idx ON solution_cost_entries(run_id)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_task_id_idx ON solution_cost_entries(task_id)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_provider_idx ON solution_cost_entries(provider)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_skill_code_idx ON solution_cost_entries(skill_code)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_endpoint_idx ON solution_cost_entries(endpoint)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_billing_status_idx ON solution_cost_entries(billing_status)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_redfox_call_log_id_idx ON solution_cost_entries(redfox_call_log_id)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_runtime_execution_id_idx ON solution_cost_entries(runtime_execution_id)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_request_hash_idx ON solution_cost_entries(request_hash)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_idempotency_key_idx ON solution_cost_entries(idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS solution_cost_entries_created_at_idx ON solution_cost_entries(created_at)`,
      `CREATE TABLE IF NOT EXISTS account_subscriptions (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "platform" TEXT DEFAULT 'douyin',
        "account_id" TEXT,
        "account_name" TEXT,
        "account_url" TEXT,
        "active" BOOLEAN DEFAULT 1,
        "last_fetched_at" DATETIME,
        "last_snapshot" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("user_id", "platform", "account_id")
      )`,
      `CREATE TABLE IF NOT EXISTS ai_chat_logs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "session_id" TEXT,
        "model" TEXT,
        "platform" TEXT,
        "messages" INTEGER DEFAULT 0,
        "tool_calls" INTEGER DEFAULT 0,
        "status" TEXT DEFAULT 'ok',
        "error_msg" TEXT,
        "duration_ms" INTEGER DEFAULT 0,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS ai_credit_accounts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "balance" REAL DEFAULT 0,
        "total_granted" REAL DEFAULT 0,
        "total_consumed" REAL DEFAULT 0,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("tenant_id", "user_id")
      )`,
      `CREATE TABLE IF NOT EXISTS ai_tool_call_logs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tool" TEXT,
        "args_json" TEXT,
        "result_ok" BOOLEAN,
        "error_msg" TEXT,
        "duration_ms" INTEGER DEFAULT 0,
        "confirmed" BOOLEAN DEFAULT 0,
        "tokens_used" INTEGER DEFAULT 0,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS ai_call_traces (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "scene" TEXT,
        "model_id" TEXT,
        "model_name" TEXT,
        "prompt_json" JSONB NOT NULL DEFAULT '[]',
        "completion" TEXT,
        "prompt_tokens" INTEGER DEFAULT 0,
        "completion_tokens" INTEGER DEFAULT 0,
        "total_tokens" INTEGER DEFAULT 0,
        "latency_ms" INTEGER DEFAULT 0,
        "success" BOOLEAN DEFAULT 1,
        "error_msg" TEXT,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS ai_usage_quotas (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "date" DATETIME,
        "chat_count" INTEGER DEFAULT 0,
        "tool_count" INTEGER DEFAULT 0,
        "chat_limit" INTEGER DEFAULT 50,
        "tool_limit" INTEGER DEFAULT 100,
        "token_count" INTEGER DEFAULT 0,
        "token_limit" INTEGER DEFAULT 2000000,
        "updated_at" DATETIME,
        UNIQUE ("user_id", "date")
      )`,
      `CREATE TABLE IF NOT EXISTS billing_invoices (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "provider" TEXT,
        "external_invoice_id" TEXT,
        "external_customer_id" TEXT,
        "external_subscription_id" TEXT,
        "status" TEXT DEFAULT 'open',
        "amount_due" INTEGER DEFAULT 0,
        "amount_paid" INTEGER DEFAULT 0,
        "currency" TEXT DEFAULT 'CNY',
        "hosted_invoice_url" TEXT,
        "invoice_pdf_url" TEXT,
        "attempted_at" DATETIME,
        "paid_at" DATETIME,
        "failed_at" DATETIME,
        "latest_webhook_event_id" TEXT,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("provider", "external_invoice_id")
      )`,
      `CREATE TABLE IF NOT EXISTS billing_subscriptions (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "provider" TEXT,
        "external_customer_id" TEXT,
        "external_subscription_id" TEXT,
        "plan" TEXT DEFAULT 'FREE',
        "status" TEXT DEFAULT 'inactive',
        "current_period_start" DATETIME,
        "current_period_end" DATETIME,
        "cancel_at_period_end" BOOLEAN DEFAULT 0,
        "latest_webhook_event_id" TEXT,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("provider", "external_subscription_id")
      )`,
      `CREATE TABLE IF NOT EXISTS billing_webhook_events (
        "id" TEXT PRIMARY KEY NOT NULL,
        "provider" TEXT,
        "event_id" TEXT,
        "event_type" TEXT,
        "tenant_id" TEXT,
        "external_customer_id" TEXT,
        "external_subscription_id" TEXT,
        "signature_verified" BOOLEAN DEFAULT 0,
        "status" TEXT DEFAULT 'received',
        "error_message" TEXT,
        "processed_at" DATETIME,
        "payload" JSONB,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("provider", "event_id")
      )`,
      `CREATE TABLE IF NOT EXISTS boss_accounts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "name" TEXT DEFAULT 'Boss 直聘',
        "login_status" TEXT DEFAULT 'unknown',
        "storage_state_path" TEXT,
        "last_checked_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS boss_candidates (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "account_id" TEXT,
        "name" TEXT,
        "job_title" TEXT,
        "wechat_id" TEXT,
        "status" TEXT DEFAULT 'new',
        "notes" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS boss_tasks (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "account_id" TEXT,
        "task_type" TEXT,
        "status" TEXT DEFAULT 'queued',
        "result" JSONB,
        "error_message" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS client_configs (
        "key" TEXT PRIMARY KEY NOT NULL,
        "value" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS compliance_checks (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "material_id" TEXT,
        "topic_id" TEXT,
        "redfox_call_log_id" TEXT,
        "target_type" TEXT,
        "target_id" TEXT,
        "platform" TEXT,
        "risk_level" TEXT DEFAULT 'unknown',
        "status" TEXT DEFAULT 'completed',
        "findings" JSONB DEFAULT '"[]"',
        "suggestions" JSONB DEFAULT '"[]"',
        "raw" JSONB,
        "checked_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_drafts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "source_type" TEXT,
        "source_id" TEXT,
        "title" TEXT,
        "content" TEXT,
        "platform" TEXT DEFAULT 'all',
        "target_type" TEXT DEFAULT 'article',
        "status" TEXT DEFAULT 'draft',
        "official_version_id" TEXT,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_evidence_logs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "target_type" TEXT,
        "target_id" TEXT,
        "action" TEXT,
        "snapshot" JSONB,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_manual_reviews (
        "id" TEXT PRIMARY KEY NOT NULL,
        "version_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "risk_level" TEXT,
        "note" TEXT,
        "reviewer_name" TEXT,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_optimization_runs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "draft_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "mode" TEXT,
        "platform" TEXT DEFAULT 'all',
        "input" JSONB,
        "result" JSONB,
        "source_workflow_id" TEXT,
        "source_summary" TEXT,
        "cost_points" INTEGER DEFAULT 0,
        "status" TEXT DEFAULT 'completed',
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_publish_feedback (
        "id" TEXT PRIMARY KEY NOT NULL,
        "version_id" TEXT,
        "publish_intent_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "platform" TEXT DEFAULT 'all',
        "views" INTEGER DEFAULT 0,
        "likes" INTEGER DEFAULT 0,
        "comments" INTEGER DEFAULT 0,
        "saves" INTEGER DEFAULT 0,
        "leads" INTEGER DEFAULT 0,
        "note" TEXT,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_publish_intents (
        "id" TEXT PRIMARY KEY NOT NULL,
        "version_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "platform" TEXT,
        "title" TEXT,
        "content" TEXT,
        "status" TEXT DEFAULT 'ready',
        "scheduled_at" DATETIME,
        "metadata" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_strategies (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT,
        "description" TEXT,
        "industry" TEXT DEFAULT '通用',
        "target_audience" TEXT,
        "commercial_goal" TEXT,
        "core_pain_points" TEXT,
        "writing_angles" TEXT,
        "tone_and_style" TEXT,
        "is_default" BOOLEAN DEFAULT 0,
        "enabled" BOOLEAN DEFAULT 1,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_strategy_templates (
        "id" TEXT PRIMARY KEY NOT NULL,
        "industry" TEXT,
        "type" TEXT,
        "scene" TEXT,
        "hook" TEXT,
        "title" TEXT,
        "content" TEXT,
        "tone_hint" TEXT,
        "is_hot" BOOLEAN DEFAULT 0,
        "source" TEXT DEFAULT 'seed',
        "enabled" BOOLEAN DEFAULT 1,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_version_comments (
        "id" TEXT PRIMARY KEY NOT NULL,
        "version_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "body" TEXT,
        "author_name" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS content_versions (
        "id" TEXT PRIMARY KEY NOT NULL,
        "draft_id" TEXT,
        "run_id" TEXT,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "mode" TEXT,
        "mode_label" TEXT,
        "title" TEXT,
        "content" TEXT,
        "platform" TEXT DEFAULT 'all',
        "target_type" TEXT DEFAULT 'article',
        "version_no" INTEGER DEFAULT 1,
        "status" TEXT DEFAULT 'saved',
        "is_official" BOOLEAN DEFAULT 0,
        "source_workflow_id" TEXT,
        "source_summary" TEXT,
        "compliance_check_id" TEXT,
        "compliance_risk_level" TEXT,
        "compliance_risk_score" INTEGER,
        "compliance_summary" TEXT,
        "compliance_checked_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS cps_favorites (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "vendor_code" TEXT,
        "platform_code" TEXT,
        "item_id" TEXT,
        "title" TEXT,
        "image_url" TEXT,
        "pay_price" REAL,
        "coupon_amount" REAL DEFAULT 0,
        "est_rebate" REAL DEFAULT 0,
        "est_net_cost" REAL DEFAULT 0,
        "commission_rate" REAL,
        "created_at" DATETIME,
        UNIQUE ("tenant_id", "user_id", "item_id", "platform_code")
      )`,
      `CREATE TABLE IF NOT EXISTS cps_orders (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "vendor_code" TEXT,
        "platform_code" TEXT,
        "order_no" TEXT,
        "item_id" TEXT,
        "pay_amount" REAL,
        "est_commission" REAL,
        "act_commission" REAL DEFAULT 0,
        "user_rebate" REAL DEFAULT 0,
        "platform_share" REAL DEFAULT 0,
        "status" TEXT,
        "refund_amount" REAL DEFAULT 0,
        "paid_at" DATETIME,
        "settled_at" DATETIME,
        "raw_status" TEXT,
        "sync_checkpoint" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("vendor_code", "order_no")
      )`,
      `CREATE TABLE IF NOT EXISTS cps_platforms (
        "id" TEXT PRIMARY KEY NOT NULL,
        "code" TEXT,
        "name" TEXT,
        "enabled" BOOLEAN DEFAULT 1,
        "settleDays" INTEGER DEFAULT 30,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS cps_promo_links (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "vendor_code" TEXT,
        "platform_code" TEXT,
        "item_id" TEXT,
        "original_url" TEXT,
        "promo_url" TEXT,
        "idempotency_key" TEXT,
        "attribution" JSONB,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS cps_vendors (
        "id" TEXT PRIMARY KEY NOT NULL,
        "code" TEXT,
        "name" TEXT,
        "platform_code" TEXT,
        "app_key_enc" TEXT,
        "app_secret_enc" TEXT,
        "pid" TEXT,
        "priority" INTEGER DEFAULT 100,
        "status" TEXT DEFAULT 'active',
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS executor_tasks (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "device_id" TEXT,
        "type" TEXT DEFAULT 'publish',
        "payload" JSONB,
        "status" TEXT DEFAULT 'queued',
        "result" JSONB,
        "attempts" INTEGER DEFAULT 0,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        "executed_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS exposure_accounts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "platform" TEXT DEFAULT 'douyin',
        "account_id" TEXT,
        "name" TEXT,
        "status" TEXT DEFAULT 'active',
        "note" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("platform", "account_id")
      )`,
      `CREATE TABLE IF NOT EXISTS growth_account_health (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "platform" TEXT,
        "account_id" TEXT,
        "account_name" TEXT,
        "login_status" TEXT,
        "today_action_count" INTEGER DEFAULT 0,
        "failure_rate" REAL DEFAULT 0,
        "risk_status" TEXT,
        "cooldown_until" DATETIME,
        "recommendation" TEXT,
        "last_checked_at" DATETIME,
        UNIQUE ("user_id", "platform", "account_id"),
        UNIQUE ("tenant_id", "platform", "account_id")
      )`,
      `CREATE TABLE IF NOT EXISTS growth_account_health_snapshots (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "platform" TEXT,
        "account_id" TEXT,
        "account_name" TEXT,
        "login_status" TEXT,
        "today_action_count" INTEGER DEFAULT 0,
        "failure_rate" REAL DEFAULT 0,
        "risk_status" TEXT,
        "cooldown_until" DATETIME,
        "recommendation" TEXT,
        "checked_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_acquisition_configs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "mode" TEXT,
        "task_name" TEXT,
        "platform" TEXT,
        "account_id" TEXT,
        "account_name" TEXT,
        "source_inputs" JSONB DEFAULT '"[]"',
        "include_keywords" JSONB DEFAULT '"[]"',
        "exclude_keywords" JSONB DEFAULT '"[]"',
        "blacklist_nicknames" JSONB DEFAULT '"[]"',
        "comment_templates" JSONB DEFAULT '"[]"',
        "private_message_templates" JSONB DEFAULT '"[]"',
        "daily_limit" INTEGER DEFAULT 20,
        "per_target_limit" INTEGER DEFAULT 1,
        "deduplicate" BOOLEAN DEFAULT 1,
        "schedule_enabled" BOOLEAN DEFAULT 0,
        "begin_time" TEXT DEFAULT '09:30',
        "risk_mode" TEXT DEFAULT 'confirm-first',
        "status" TEXT DEFAULT 'enabled',
        "exposure_count" INTEGER DEFAULT 0,
        "exposure_date" TEXT,
        "last_run_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_acquisition_runs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "config_id" TEXT,
        "mode" TEXT,
        "platform" TEXT,
        "status" TEXT,
        "failure_reason" TEXT,
        "message" TEXT,
        "candidate_count" INTEGER DEFAULT 0,
        "selected_count" INTEGER DEFAULT 0,
        "contacted_count" INTEGER DEFAULT 0,
        "crm_captured_count" INTEGER DEFAULT 0,
        "evidence_urls" JSONB DEFAULT '"[]"',
        "lead_ids" JSONB DEFAULT '"[]"',
        "started_at" DATETIME,
        "ended_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_leads (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "platform" TEXT,
        "source_type" TEXT,
        "source_task_id" TEXT,
        "source_run_id" TEXT,
        "crm_customer_id" TEXT,
        "nickname" TEXT,
        "profile_url" TEXT,
        "avatar_url" TEXT,
        "external_user_id" TEXT,
        "source_text" TEXT,
        "source_url" TEXT,
        "video_title" TEXT,
        "video_url" TEXT,
        "comment_time" TEXT,
        "matched_keywords" JSONB DEFAULT '"[]"',
        "score" INTEGER DEFAULT 0,
        "score_reasons" JSONB DEFAULT '"[]"',
        "status" TEXT DEFAULT 'new',
        "next_follow_up_at" DATETIME,
        "owner_user_id" TEXT,
        "notes" JSONB DEFAULT '"[]"',
        "evidence_urls" JSONB DEFAULT '"[]"',
        "latest_reply" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      // 复核#2：统一 RPA 获客执行记录（对齐 3010-AI获客完整开发文档 §7.2）
      `CREATE TABLE IF NOT EXISTS rpa_executions (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "platform" TEXT,
        "session_id" TEXT,
        "account_id" TEXT,
        "mode" TEXT DEFAULT 'unknown',
        "steps" JSONB DEFAULT '"[]"',
        "resume_step" TEXT,
        "reason_code" TEXT,
        "next_action" TEXT,
        "page_fingerprint" TEXT,
        "evidence" JSONB DEFAULT '"[]"',
        "status" TEXT DEFAULT 'running',
        "driver_version" TEXT,
        "run_id" TEXT,
        "user_message" TEXT,
        "technical_message" TEXT,
        "input_json" JSONB DEFAULT '"{}"',
        "version" INTEGER DEFAULT 1,
        "started_at" DATETIME,
        "ended_at" DATETIME
      )`,
      // 复核 #3：独立步骤表 + 独立证据表（运行时建表，与 schema 迁移一致）
      `CREATE TABLE IF NOT EXISTS rpa_execution_steps (
        "id" TEXT PRIMARY KEY NOT NULL,
        "execution_id" TEXT NOT NULL,
        "sequence_no" INTEGER NOT NULL,
        "step_name" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'running',
        "attempt" INTEGER NOT NULL DEFAULT 1,
        "reason_code" TEXT,
        "message" TEXT,
        "result_hash" TEXT,
        "started_at" DATETIME,
        "ended_at" DATETIME,
        "created_at" DATETIME
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rpa_execution_steps_execution_id_sequence_no_idx ON rpa_execution_steps(execution_id, sequence_no)`,
      `CREATE TABLE IF NOT EXISTS rpa_evidence (
        "id" TEXT PRIMARY KEY NOT NULL,
        "execution_id" TEXT NOT NULL,
        "step_id" TEXT REFERENCES rpa_execution_steps("id") ON DELETE SET NULL ON UPDATE CASCADE,
        "tenant_id" TEXT,
        "user_id" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "account_id" TEXT,
        "kind" TEXT NOT NULL DEFAULT 'rpa-step',
        "uri" TEXT,
        "sha256" TEXT NOT NULL,
        "captured_at" DATETIME,
        "page_url" TEXT,
        "page_fingerprint" TEXT,
        "source" TEXT NOT NULL DEFAULT 'driver',
        "metadata" JSONB DEFAULT '"{}"',
        "created_at" DATETIME
      )`,
      // P1 复核：sha256 改 (execution_id, sha256) 复合唯一——先删旧单列唯一索引防冲突
      `DROP INDEX IF EXISTS rpa_evidence_sha256_key`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rpa_evidence_execution_sha256_key ON rpa_evidence(execution_id, sha256)`,
      `CREATE INDEX IF NOT EXISTS rpa_evidence_execution_id_idx ON rpa_evidence(execution_id)`,
      `CREATE INDEX IF NOT EXISTS rpa_evidence_user_id_captured_at_idx ON rpa_evidence(user_id, captured_at)`,
      // P1 复核：step_id 真实外键配套索引（新建库声明式 REFERENCES + 存量回填见 repairRpaEvidenceStepIds）
      `CREATE INDEX IF NOT EXISTS rpa_evidence_step_id_idx ON rpa_evidence(step_id)`,
      `CREATE TABLE IF NOT EXISTS growth_scheduler_leases (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "owner_id" TEXT,
        "locked_until" DATETIME,
        "heartbeat_at" DATETIME,
        "last_run_at" DATETIME,
        "cursor" JSONB DEFAULT '"{}"',
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_strategies (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "industry" TEXT,
        "scenario" TEXT,
        "name" TEXT,
        "source_keywords" JSONB DEFAULT '"[]"',
        "demand_keywords" JSONB DEFAULT '"[]"',
        "exclude_keywords" JSONB DEFAULT '"[]"',
        "blacklist_nicknames" JSONB DEFAULT '"[]"',
        "comment_templates" JSONB DEFAULT '"[]"',
        "private_message_templates" JSONB DEFAULT '"[]"',
        "default_daily_limit" INTEGER DEFAULT 20,
        "default_risk_mode" TEXT DEFAULT 'confirm-first',
        "scoring_rules" JSONB DEFAULT '"[]"',
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_workflows (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "name" TEXT,
        "template" TEXT,
        "industry" TEXT,
        "scenario" TEXT,
        "status" TEXT,
        "steps" JSONB DEFAULT '"[]"',
        "current_step_id" TEXT,
        "last_action" TEXT,
        "last_action_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS mobile_devices (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "device_name" TEXT,
        "platform" TEXT DEFAULT 'android',
        "status" TEXT DEFAULT 'online',
        "last_heartbeat_at" DATETIME,
        "agent_version" TEXT,
        "device_uuid" TEXT,
        "device_token_hash" TEXT,
        "capabilities" JSONB,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS offer_snapshots (
        "id" TEXT PRIMARY KEY NOT NULL,
        "vendor_code" TEXT,
        "platform_code" TEXT,
        "item_id" TEXT,
        "title" TEXT,
        "shop_name" TEXT,
        "price" REAL,
        "coupon_amount" REAL DEFAULT 0,
        "pay_price" REAL,
        "commission_rate" REAL,
        "est_commission" REAL,
        "freight" REAL DEFAULT 0,
        "image_url" TEXT,
        "raw_json" JSONB,
        "master_id" TEXT,
        "fetched_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS poi_stores (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "name" TEXT,
        "address" TEXT,
        "city" TEXT,
        "category" TEXT,
        "poi_id" TEXT,
        "lng" REAL,
        "lat" REAL,
        "tags" TEXT,
        "status" TEXT DEFAULT 'active',
        "note" TEXT,
        "visit_count" INTEGER DEFAULT 0,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS price_histories (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "watch_id" TEXT,
        "item_id" TEXT,
        "platform_code" TEXT,
        "title" TEXT,
        "price" REAL,
        "coupon_amount" REAL DEFAULT 0,
        "pay_price" REAL,
        "commission_rate" REAL,
        "est_commission" REAL DEFAULT 0,
        "snapshot_at" DATETIME,
        "created_at" DATETIME,
        UNIQUE ("item_id", "platform_code", "snapshot_at")
      )`,
      `CREATE TABLE IF NOT EXISTS price_watches (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "item_id" TEXT,
        "platform_code" TEXT,
        "title" TEXT,
        "target_pay_price" REAL,
        "target_unit_price" REAL,
        "min_rebate" REAL,
        "notify_windows" TEXT,
        "status" TEXT DEFAULT 'active',
        "source" TEXT DEFAULT 'manual',
        "last_notified_at" DATETIME,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS procurement_lists (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "name" TEXT,
        "address" TEXT,
        "owner" TEXT,
        "store_id" TEXT,
        "items" JSONB,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS product_clip_configs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT,
        "product_name" TEXT,
        "selling_points" TEXT,
        "price" REAL,
        "audience" TEXT,
        "duration_seconds" INTEGER DEFAULT 20,
        "image_url" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS product_masters (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT,
        "title_key" TEXT,
        "brand" TEXT,
        "spec" TEXT,
        "unit" TEXT,
        "unit_qty" REAL,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "tenant_id" TEXT,
        "endpoint" TEXT,
        "p256dh" TEXT,
        "auth" TEXT,
        "user_agent" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS rebate_accounts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "available" REAL DEFAULT 0,
        "pending" REAL DEFAULT 0,
        "frozen" REAL DEFAULT 0,
        "total_earned" REAL DEFAULT 0,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("tenant_id", "user_id")
      )`,
      `CREATE TABLE IF NOT EXISTS rebate_exchanges (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "rebate_amount" REAL,
        "rate" REAL,
        "credit_amount" REAL,
        "status" TEXT,
        "credit_order_no" TEXT,
        "idempotency_key" TEXT,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS rebate_ledgers (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "account_id" TEXT,
        "biz_type" TEXT,
        "biz_no" TEXT,
        "before_amount" REAL,
        "change_amount" REAL,
        "after_amount" REAL,
        "idempotency_key" TEXT,
        "operator" TEXT,
        "remark" TEXT,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS rebate_withdrawals (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "amount" REAL,
        "channel" TEXT,
        "account_mask" TEXT,
        "fee" REAL DEFAULT 0,
        "actual_amount" REAL,
        "status" TEXT,
        "external_no" TEXT,
        "fail_reason" TEXT,
        "idempotency_key" TEXT,
        "reviewed_by" TEXT,
        "paid_at" DATETIME,
        "created_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS risk_policies (
        "id" TEXT PRIMARY KEY NOT NULL,
        "action" TEXT,
        "risk_level" TEXT DEFAULT 'medium',
        "require_confirm" BOOLEAN DEFAULT 1,
        "auto_execute" BOOLEAN DEFAULT 0,
        "forbidden" BOOLEAN DEFAULT 0,
        "min_plan" TEXT,
        "allowed_roles" JSONB DEFAULT '"[]"',
        "whitelist" JSONB DEFAULT '"[]"',
        "description" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS savings_checkins (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "user_id" TEXT,
        "checkin_date" TEXT,
        "reward_amount" REAL DEFAULT 0.1,
        "streak_day" INTEGER DEFAULT 1,
        "created_at" DATETIME,
        UNIQUE ("tenant_id", "user_id", "checkin_date")
      )`,
      `CREATE TABLE IF NOT EXISTS stores (
        "id" TEXT PRIMARY KEY NOT NULL,
        "tenant_id" TEXT,
        "name" TEXT,
        "address" TEXT,
        "owner" TEXT,
        "status" TEXT DEFAULT 'active',
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS user_memories (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "type" TEXT DEFAULT 'episodic',
        "content" TEXT,
        "priority" INTEGER DEFAULT 1,
        "scene" TEXT,
        "usage_count" INTEGER DEFAULT 0,
        "last_used_at" DATETIME,
        "source" TEXT DEFAULT 'chat',
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("user_id", "type", "content")
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_contacts (
        "id" TEXT PRIMARY KEY NOT NULL,
        "config_id" TEXT,
        "external_user_id" TEXT,
        "name" TEXT DEFAULT '',
        "avatar" TEXT,
        "type" TEXT DEFAULT '',
        "user_id" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME,
        UNIQUE ("config_id", "external_user_id")
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_corp_configs (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "name" TEXT DEFAULT '企业微信',
        "corp_id" TEXT,
        "encrypted_corp_secret" TEXT,
        "agent_id" TEXT,
        "status" TEXT DEFAULT 'active',
        "callback_token" TEXT,
        "callback_encoding_aes_key" TEXT,
        "callback_url" TEXT,
        "callback_url_verified_at" DATETIME,
        "last_token_at" DATETIME,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_group_msg_tasks (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "config_id" TEXT,
        "msg_type" TEXT,
        "content" JSONB,
        "external_user_ids" JSONB,
        "sender_ids" JSONB,
        "wecom_msg_id" TEXT,
        "status" TEXT DEFAULT 'creating',
        "result" JSONB,
        "error_message" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS wecom_moment_tasks (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT,
        "config_id" TEXT,
        "text" TEXT,
        "attachments" JSONB,
        "visible_range" JSONB,
        "wecom_job_id" TEXT,
        "status" TEXT DEFAULT 'creating',
        "result" JSONB,
        "error_message" TEXT,
        "created_at" DATETIME,
        "updated_at" DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        platform TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_account_id TEXT,
        source_task_id TEXT,
        source_run_id TEXT,
        source_url TEXT,
        source_text TEXT,
        comment_ref TEXT,
        video_title TEXT,
        video_url TEXT,
        comment_time TEXT,
        external_user_id TEXT,
        dedupe_key TEXT NOT NULL,
        nickname TEXT,
        profile_url TEXT,
        avatar_url TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        score_reasons JSONB NOT NULL DEFAULT '[]',
        matched_keywords JSONB NOT NULL DEFAULT '[]',
        signals JSONB NOT NULL DEFAULT '[]',
        latest_reply TEXT,
        reply_persona_id TEXT,
        replied_at DATETIME,
        last_error TEXT,
        notes JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        customer_id TEXT,
        evidence_urls JSONB NOT NULL DEFAULT '[]',
        owner_user_id TEXT,
        next_follow_up_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_tenant_id_dedupe_key_key ON leads(tenant_id, dedupe_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_user_id_dedupe_key_key ON leads(user_id, dedupe_key)`,
      `CREATE INDEX IF NOT EXISTS leads_user_id_status_idx ON leads(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS leads_tenant_id_platform_idx ON leads(tenant_id, platform)`,
      `CREATE INDEX IF NOT EXISTS leads_source_task_id_idx ON leads(source_task_id)`,
      // —— 六步闭环统一侧事实层/决策层（Sprint 1 增量 §6-7，桌面端 SQLite 补建）——
      `CREATE TABLE IF NOT EXISTS platform_identities (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        external_user_id TEXT,
        normalized_handle TEXT,
        nickname TEXT,
        profile_url TEXT,
        avatar_hash TEXT,
        verified BOOLEAN NOT NULL DEFAULT false,
        identity_confidence INTEGER NOT NULL DEFAULT 0,
        first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS platform_identities_tenant_platform_account_external_key ON platform_identities(tenant_id, platform, account_id, external_user_id)`,
      `CREATE INDEX IF NOT EXISTS platform_identities_tenant_platform_account_idx ON platform_identities(tenant_id, platform, account_id)`,
      `CREATE TABLE IF NOT EXISTS source_contents (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        external_content_id TEXT NOT NULL,
        url TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'video',
        author_identity_id TEXT,
        title TEXT,
        text TEXT,
        published_at DATETIME,
        metrics JSONB,
        raw_hash TEXT NOT NULL,
        collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS source_contents_tenant_platform_account_external_key ON source_contents(tenant_id, platform, account_id, external_content_id)`,
      `CREATE INDEX IF NOT EXISTS source_contents_author_identity_idx ON source_contents(author_identity_id)`,
      `CREATE TABLE IF NOT EXISTS suppressions (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        kind TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_event_id TEXT,
        created_by TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        removed_at DATETIME
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS suppressions_tenant_kind_value_key ON suppressions(tenant_id, kind, normalized_value)`,
      `CREATE TABLE IF NOT EXISTS lead_signals (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        lead_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 1,
        evidence_id TEXT NOT NULL DEFAULT '',
        source TEXT,
        observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        confidence INTEGER NOT NULL DEFAULT 100,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS lead_signals_tenant_lead_type_evidence_key ON lead_signals(tenant_id, lead_id, type, evidence_id)`,
      `CREATE INDEX IF NOT EXISTS lead_signals_tenant_lead_idx ON lead_signals(tenant_id, lead_id)`,
      `CREATE TABLE IF NOT EXISTS lead_score_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        lead_id TEXT NOT NULL,
        fit_score INTEGER NOT NULL,
        intent_score INTEGER NOT NULL,
        identity_confidence INTEGER NOT NULL,
        risk_score INTEGER NOT NULL,
        total_score INTEGER NOT NULL,
        confidence INTEGER NOT NULL,
        components JSONB NOT NULL,
        reasons JSONB NOT NULL,
        evidence_ids JSONB NOT NULL,
        model_version TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        scored_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS lead_score_snapshots_tenant_lead_scored_idx ON lead_score_snapshots(tenant_id, lead_id, scored_at)`,
      `CREATE TABLE IF NOT EXISTS identity_merge_audits (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        target_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_snapshot JSONB NOT NULL,
        migrated_event_ids JSONB NOT NULL DEFAULT '[]',
        migrated_content_ids JSONB NOT NULL DEFAULT '[]',
        field_choices JSONB,
        reverted BOOLEAN NOT NULL DEFAULT false,
        reverted_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS identity_merge_audits_tenant_created_idx ON identity_merge_audits(tenant_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS identity_merge_audits_source_idx ON identity_merge_audits(source_id)`,
      // 作品展示（Showcase 模块，schema 有但 SQLite 建表此前遗漏 → ⑬ 守卫对齐）
      `CREATE TABLE IF NOT EXISTS showcase_cases (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subtitle TEXT,
        provenance_type TEXT NOT NULL,
        client_visibility TEXT NOT NULL DEFAULT 'public',
        primary_platform TEXT,
        platforms TEXT NOT NULL DEFAULT '[]',
        primary_industry TEXT,
        industries TEXT NOT NULL DEFAULT '[]',
        capability_tags TEXT NOT NULL DEFAULT '[]',
        business_problem TEXT,
        solution_summary TEXT,
        key_features JSONB NOT NULL DEFAULT '[]',
        results_summary TEXT,
        evidence_level TEXT NOT NULL DEFAULT 'E0',
        evidence_scope TEXT,
        delivery_modes TEXT NOT NULL DEFAULT '[]',
        maturity TEXT NOT NULL DEFAULT 'concept',
        tech_summary TEXT,
        cover_media JSONB,
        seo_title TEXT,
        seo_description TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        published_at DATETIME,
        last_reviewed_at DATETIME,
        next_review_at DATETIME,
        owner_user_id TEXT,
        reviewer_user_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_cases_status_idx ON showcase_cases(status)`,
      `CREATE INDEX IF NOT EXISTS showcase_cases_provenance_type_idx ON showcase_cases(provenance_type)`,
      `CREATE INDEX IF NOT EXISTS showcase_cases_published_at_idx ON showcase_cases(published_at)`,
      `CREATE TABLE IF NOT EXISTS showcase_media (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        file_url TEXT,
        external_url TEXT,
        thumbnail_url TEXT,
        title TEXT,
        caption TEXT,
        alt_text TEXT NOT NULL,
        device_frame TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        rights_status TEXT NOT NULL DEFAULT 'unreviewed',
        sensitive_reviewed BOOLEAN NOT NULL DEFAULT false,
        checksum TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_media_case_sort_idx ON showcase_media(case_id, sort_order)`,
      `CREATE TABLE IF NOT EXISTS showcase_demo_endpoints (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        target_url TEXT,
        short_code TEXT,
        allowed_devices TEXT NOT NULL DEFAULT '[]',
        iframe_allowed BOOLEAN NOT NULL DEFAULT false,
        access_instruction TEXT,
        valid_from DATETIME,
        valid_until DATETIME,
        fallback_type TEXT NOT NULL,
        fallback_target TEXT,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at DATETIME,
        owner_user_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_demo_endpoints_case_idx ON showcase_demo_endpoints(case_id)`,
      `CREATE INDEX IF NOT EXISTS showcase_demo_endpoints_short_code_idx ON showcase_demo_endpoints(short_code)`,
      `CREATE TABLE IF NOT EXISTS showcase_authorizations (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        grantor TEXT,
        scope TEXT,
        license_name TEXT,
        source_url TEXT,
        version_or_commit TEXT,
        attachment TEXT,
        valid_from DATETIME,
        valid_until DATETIME,
        review_status TEXT NOT NULL DEFAULT 'pending',
        reviewer_user_id TEXT,
        restriction_notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_authorizations_case_idx ON showcase_authorizations(case_id)`,
      `CREATE INDEX IF NOT EXISTS showcase_authorizations_review_status_idx ON showcase_authorizations(review_status)`,
      `CREATE TABLE IF NOT EXISTS showcase_collections (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        cover_media JSONB,
        visibility TEXT NOT NULL DEFAULT 'public',
        channel_code TEXT,
        internal_customer_alias TEXT,
        valid_until DATETIME,
        owner_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_collections_status_idx ON showcase_collections(status)`,
      `CREATE TABLE IF NOT EXISTS showcase_collection_items (
        collection_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, case_id)
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_collection_items_case_idx ON showcase_collection_items(case_id)`,
      `CREATE TABLE IF NOT EXISTS showcase_short_links (
        id TEXT PRIMARY KEY NOT NULL,
        short_code TEXT NOT NULL UNIQUE,
        target_type TEXT NOT NULL,
        target_id TEXT,
        target_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        valid_until DATETIME,
        channel_code TEXT,
        open_count INTEGER NOT NULL DEFAULT 0,
        last_open_at DATETIME,
        owner_user_id TEXT,
        case_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_short_links_target_idx ON showcase_short_links(target_type, target_id)`,
      `CREATE INDEX IF NOT EXISTS showcase_short_links_status_idx ON showcase_short_links(status)`,
      `CREATE TABLE IF NOT EXISTS showcase_taxonomies (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (type, slug)
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_taxonomies_type_enabled_idx ON showcase_taxonomies(type, enabled)`,
      `CREATE TABLE IF NOT EXISTS showcase_tag_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        alias TEXT NOT NULL UNIQUE,
        canonical_taxonomy_id TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_tag_aliases_taxonomy_idx ON showcase_tag_aliases(canonical_taxonomy_id)`,
      `CREATE TABLE IF NOT EXISTS showcase_case_reviews (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL,
        review_type TEXT NOT NULL,
        submitted_by TEXT,
        reviewed_by TEXT,
        decision TEXT NOT NULL DEFAULT 'pending',
        comments TEXT,
        changed_fields JSONB NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS showcase_case_reviews_case_created_idx ON showcase_case_reviews(case_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS showcase_case_reviews_decision_idx ON showcase_case_reviews(decision)`,
      // 审批记录（Approval 模型，schema 有但 SQLite 建表此前遗漏 → /api/approvals 500）
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        action_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        affected_lead_ids JSONB NOT NULL,
        excluded_lead_ids JSONB NOT NULL DEFAULT '[]',
        approver_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        applied_at DATETIME
      )`,
      `CREATE INDEX IF NOT EXISTS approvals_tenant_status_idx ON approvals(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS approvals_tenant_action_idx ON approvals(tenant_id, action_id)`,
      // 领域事件 outbox（DomainEventOutbox 模型，schema 有但 SQLite 建表此前遗漏 → CRM 转客户 500）
      `CREATE TABLE IF NOT EXISTS domain_event_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        payload JSONB,
        status TEXT NOT NULL DEFAULT 'published',
        attempt INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        consumed_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS domain_event_outbox_event_id_key ON domain_event_outbox(event_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS domain_event_outbox_tenant_agg_idem_key ON domain_event_outbox(tenant_id, aggregate_type, aggregate_id, idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS domain_event_outbox_tenant_status_created_idx ON domain_event_outbox(tenant_id, status, created_at)`,
      `CREATE INDEX IF NOT EXISTS domain_event_outbox_tenant_type_idx ON domain_event_outbox(tenant_id, type)`,
      // —— 补齐 schema drift（schema.prisma 有、此前 SQLite 建表遗漏的表）——
      `CREATE TABLE IF NOT EXISTS wechat_pay_orders (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        mchid TEXT NOT NULL DEFAULT '1116143786',
        appid TEXT,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        status TEXT NOT NULL DEFAULT 'pending',
        transaction_id TEXT,
        credit_points INTEGER NOT NULL DEFAULT 0,
        paid_at DATETIME,
        notify_payload JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS wechat_pay_orders_out_trade_no_key ON wechat_pay_orders(out_trade_no)`,
      `CREATE INDEX IF NOT EXISTS wechat_pay_orders_tenant_user_idx ON wechat_pay_orders(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS wechat_pay_orders_status_idx ON wechat_pay_orders(status)`,
      `CREATE INDEX IF NOT EXISTS wechat_pay_orders_transaction_id_idx ON wechat_pay_orders(transaction_id)`,
      `CREATE TABLE IF NOT EXISTS acquisition_quotas (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        date DATETIME NOT NULL,
        discover_count INTEGER NOT NULL DEFAULT 0,
        discover_limit INTEGER NOT NULL DEFAULT 100,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS acquisition_quotas_user_date_key ON acquisition_quotas(user_id, date)`,
      `CREATE TABLE IF NOT EXISTS content_variants (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        content_unit_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        body TEXT NOT NULL,
        title TEXT,
        platform_metadata JSONB,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        license_status TEXT NOT NULL DEFAULT 'unknown',
        copyright_notice TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS content_variants_content_platform_hash_key ON content_variants(content_unit_id, platform, content_hash)`,
      `CREATE INDEX IF NOT EXISTS content_variants_tenant_status_idx ON content_variants(tenant_id, status)`,
      `CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        variant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempt INTEGER NOT NULL DEFAULT 0,
        scheduled_at DATETIME,
        idempotency_key TEXT NOT NULL,
        correlation_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_tenant_idem_key ON publish_jobs(tenant_id, idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS publish_jobs_tenant_status_idx ON publish_jobs(tenant_id, status)`,
      `CREATE TABLE IF NOT EXISTS publish_receipts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL DEFAULT 'legacy-local-user',
        job_id TEXT NOT NULL,
        external_post_id TEXT,
        external_url TEXT,
        readback_state TEXT NOT NULL DEFAULT 'pending',
        readback_at DATETIME,
        platform_metadata JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS publish_receipts_tenant_job_idx ON publish_receipts(tenant_id, job_id)`,
      // P1（P5 门禁 2026-08-22）：GrowthTaskDraft（schema.prisma:3999）此前缺表，
      // SQLite 守卫 150 模型/149 表不匹配，移动端回归 R1 失败——补齐建表+索引
      `CREATE TABLE IF NOT EXISTS growth_task_drafts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop',
        user_id TEXT NOT NULL,
        actor_user_id TEXT,
        intent TEXT NOT NULL,
        goal TEXT NOT NULL,
        platform TEXT,
        account_id TEXT,
        config_json JSONB NOT NULL DEFAULT '{}',
        planned_actions JSONB NOT NULL DEFAULT '[]',
        missing_fields JSONB NOT NULL DEFAULT '[]',
        readiness TEXT NOT NULL DEFAULT 'needs-input',
        blockers JSONB NOT NULL DEFAULT '[]',
        draft_hash TEXT,
        risk_summary TEXT,
        config_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        expires_at DATETIME NOT NULL,
        confirmed_at DATETIME,
        executed_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS growth_task_drafts_user_id_status_idx ON growth_task_drafts(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_task_drafts_tenant_id_status_idx ON growth_task_drafts(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_task_drafts_intent_status_idx ON growth_task_drafts(intent, status)`,

      // ===== 设备代理执行器 5 张表（schema.prisma 155 张对齐，2026-08-23 补齐）=====
      // 执行租约（心跳续租 + 恢复保护期）
      `CREATE TABLE IF NOT EXISTS executor_leases (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at DATETIME NOT NULL,
        frozen_until DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS executor_leases_user_id_account_id_status_idx ON executor_leases(user_id, account_id, status)`,
      `CREATE INDEX IF NOT EXISTS executor_leases_task_id_idx ON executor_leases(task_id)`,
      // 证据链（截图/结构化留证，content_hash 链式防篡改）
      `CREATE TABLE IF NOT EXISTS executor_evidences (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL DEFAULT -1,
        type TEXT NOT NULL DEFAULT 'screenshot',
        content JSONB NOT NULL DEFAULT '{}',
        content_hash TEXT,
        prev_evidence_id TEXT,
        device_id TEXT,
        model_version TEXT,
        policy_version TEXT,
        approval_id TEXT,
        collected_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS executor_evidences_task_id_idx ON executor_evidences(task_id)`,
      `CREATE INDEX IF NOT EXISTS executor_evidences_user_id_task_id_idx ON executor_evidences(user_id, task_id)`,
      `CREATE INDEX IF NOT EXISTS executor_evidences_content_hash_idx ON executor_evidences(content_hash)`,
      // 执行会话（run 级断点恢复）
      `CREATE TABLE IF NOT EXISTS executor_runs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        account_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        checkpoint TEXT,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS executor_runs_task_id_idx ON executor_runs(task_id)`,
      `CREATE INDEX IF NOT EXISTS executor_runs_device_id_status_idx ON executor_runs(device_id, status)`,
      // 执行步骤记录
      `CREATE TABLE IF NOT EXISTS executor_steps (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done',
        detail JSONB,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS executor_steps_run_id_idx ON executor_steps(run_id)`,
      `CREATE INDEX IF NOT EXISTS executor_steps_task_id_step_index_idx ON executor_steps(task_id, step_index)`,
      // 平台账号实体（发送前确认登录账号）
      `CREATE TABLE IF NOT EXISTS platform_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        nickname TEXT,
        login_status TEXT NOT NULL DEFAULT 'unknown',
        bound_device_id TEXT,
        risk_status TEXT NOT NULL DEFAULT 'normal',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform, account_id)
      )`,
      `CREATE INDEX IF NOT EXISTS platform_accounts_user_id_idx ON platform_accounts(user_id)`,
      // ===== 4.4 多工作区标签壳 + Agent Gateway 九实体（2026-08-24 P0 补齐：
      //  此前仅存在于 prisma/migrations，未进运行时 DDL → 已装用户库缺表，
      //  GET /api/workspaces 500「内部错误」。DDL 与 prisma/migrations/
      //  20260823*_agent_gateway_* / 20260824000000_workspaces 对齐。=====）
      // workspaces 表
      `CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'agent_default',
        settings JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS workspaces_tenant_id_user_id_idx ON workspaces(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces(status)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS workspaces_tenant_id_user_id_name_key ON workspaces(tenant_id, user_id, name)`,
      // agent-gateway 会话
      `CREATE TABLE IF NOT EXISTS agent_gateway_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workspace_id TEXT,
        octop_session_id TEXT,
        mode TEXT NOT NULL DEFAULT 'business',
        status TEXT NOT NULL DEFAULT 'active',
        last_event_id TEXT NOT NULL DEFAULT '',
        last_sequence INTEGER NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_sessions_tenant_id_user_id_idx ON agent_gateway_sessions(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_sessions_expires_at_idx ON agent_gateway_sessions(expires_at)`,
      // agent-gateway 任务
      `CREATE TABLE IF NOT EXISTS agent_gateway_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workspace_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        plan_json JSONB NOT NULL DEFAULT '{}',
        checkpoint_json JSONB NOT NULL DEFAULT '{}',
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tasks_session_id_idx ON agent_gateway_tasks(session_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tasks_tenant_id_user_id_idx ON agent_gateway_tasks(tenant_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tasks_status_idx ON agent_gateway_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tasks_workspace_id_idx ON agent_gateway_tasks(workspace_id)`,
      // agent-gateway 工具调用（幂等键防重复）
      `CREATE TABLE IF NOT EXISTS agent_gateway_tool_calls (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT,
        tool_name TEXT NOT NULL,
        risk TEXT NOT NULL DEFAULT 'low',
        input_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        idempotency_key TEXT NOT NULL,
        request_json TEXT,
        usage_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tool_calls_task_id_idx ON agent_gateway_tool_calls(task_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_tool_calls_usage_id_idx ON agent_gateway_tool_calls(usage_id)`,
      // agent-gateway 审批
      `CREATE TABLE IF NOT EXISTS agent_gateway_approvals (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        preview_hash TEXT NOT NULL,
        approved_by TEXT,
        consumed BOOLEAN NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_approvals_task_id_idx ON agent_gateway_approvals(task_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_approvals_tool_call_id_idx ON agent_gateway_approvals(tool_call_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_approvals_status_expires_at_idx ON agent_gateway_approvals(status, expires_at)`,
      // agent-gateway 产物
      `CREATE TABLE IF NOT EXISTS agent_gateway_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        uri TEXT NOT NULL,
        checksum TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        metadata_json JSONB NOT NULL DEFAULT '{}',
        expires_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_artifacts_task_id_idx ON agent_gateway_artifacts(task_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_artifacts_tenant_id_idx ON agent_gateway_artifacts(tenant_id)`,
      // agent-gateway 证据
      `CREATE TABLE IF NOT EXISTS agent_gateway_evidence (
        id TEXT PRIMARY KEY NOT NULL,
        tool_call_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        uri TEXT NOT NULL,
        captured_at DATETIME NOT NULL,
        redaction_version INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_evidence_tool_call_id_idx ON agent_gateway_evidence(tool_call_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_evidence_tenant_id_captured_at_idx ON agent_gateway_evidence(tenant_id, captured_at)`,
      // agent-gateway 用量事件（与 Kaypal 回执对账锚点 usage_id 唯一）
      `CREATE TABLE IF NOT EXISTS agent_gateway_usage_events (
        id TEXT PRIMARY KEY NOT NULL,
        request_id TEXT NOT NULL,
        usage_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT,
        task_id TEXT,
        tool_call_id TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        compute_units INTEGER NOT NULL DEFAULT 0,
        cost NUMERIC,
        status TEXT NOT NULL DEFAULT 'ok',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_usage_events_request_id_idx ON agent_gateway_usage_events(request_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_usage_events_tenant_id_created_at_idx ON agent_gateway_usage_events(tenant_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_usage_events_user_id_idx ON agent_gateway_usage_events(user_id)`,
      // agent-gateway 记忆 outbox
      `CREATE TABLE IF NOT EXISTS agent_gateway_memory_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        memory_event_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workspace_id TEXT,
        scope TEXT NOT NULL,
        namespace TEXT NOT NULL,
        content TEXT,
        item_id TEXT,
        operation TEXT NOT NULL DEFAULT 'add',
        payload_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_memory_outbox_status_next_retry_at_idx ON agent_gateway_memory_outbox(status, next_retry_at)`,
      // agent-gateway 设备租约
      `CREATE TABLE IF NOT EXISTS agent_gateway_device_leases (
        id TEXT PRIMARY KEY NOT NULL,
        device_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        heartbeat_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_device_leases_device_id_idx ON agent_gateway_device_leases(device_id)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_device_leases_tenant_id_idx ON agent_gateway_device_leases(tenant_id)`,
      // agent-gateway 事件流（eventId 按 session 作用域唯一）
      `CREATE TABLE IF NOT EXISTS agent_gateway_events (
        id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        task_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        occurred_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, event_id)
      )`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_events_session_id_sequence_idx ON agent_gateway_events(session_id, sequence)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_events_tenant_id_occurred_at_idx ON agent_gateway_events(tenant_id, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS agent_gateway_events_user_id_idx ON agent_gateway_events(user_id)`,
    ];

    for (const statement of statements) {
      if (this.isSqliteIndexStatement(statement)) {
        continue;
      }
      await this.$executeRawUnsafe(statement);
    }

    for (const column of [
      ['leads', 'comment_ref', 'TEXT'],
      ['leads', 'source_account_id', 'TEXT'],
      ['leads', 'last_error', 'TEXT'],
      ['leads', 'video_title', 'TEXT'],
      ['leads', 'video_url', 'TEXT'],
      ['leads', 'comment_time', 'TEXT'],
      ['leads', 'notes', "JSONB NOT NULL DEFAULT '[]'"],
      ['leads', 'source_article_id', 'TEXT'],
      ['leads', 'source_publish_record_id', 'TEXT'],
      ['leads', 'source_interaction_event_id', 'TEXT'],
      ['crm_customers', 'actor_user_id', 'TEXT'],
      ['crm_companies', 'actor_user_id', 'TEXT'],
      ['crm_opportunities', 'actor_user_id', 'TEXT'],
      ['crm_tasks', 'actor_user_id', 'TEXT'],
      ['crm_notes', 'actor_user_id', 'TEXT'],
      ['crm_timeline_events', 'actor_user_id', 'TEXT'],
      ['growth_strategies', 'actor_user_id', 'TEXT'],
      ['growth_acquisition_configs', 'actor_user_id', 'TEXT'],
      ['growth_acquisition_runs', 'actor_user_id', 'TEXT'],
      ['app_install_states', 'tenant_id', 'TEXT'],
      ['app_install_states', 'actor_user_id', 'TEXT'],
      ['crm_companies', 'tenant_id', 'TEXT'],
      ['crm_customers', 'tenant_id', 'TEXT'],
      ['crm_customers', 'company_id', 'TEXT'],
      ['crm_customers', 'title', 'TEXT'],
      ['crm_customers', 'email', 'TEXT'],
      ['crm_customers', 'phone', 'TEXT'],
      ['crm_customers', 'wechat', 'TEXT'],
      // CrmCustomer P2 归因主键链（2026-08-20 新增；drift 口径对齐）
      ['crm_customers', 'source_article_id', 'TEXT'],
      ['crm_customers', 'source_publish_record_id', 'TEXT'],
      ['crm_customers', 'source_interaction_event_id', 'TEXT'],
      ['crm_customers', 'source_task_id', 'TEXT'],
      ['crm_customers', 'source_run_id', 'TEXT'],
      ['crm_opportunities', 'tenant_id', 'TEXT'],
      // 赢单/输单原因（报告 16.3 第 19 项）
      ['crm_opportunities', 'win_reason', 'TEXT'],
      ['crm_opportunities', 'lose_reason', 'TEXT'],
      // Sprint 4 T4.2：下次跟进时间（schema 有但旧库缺列 → CRM 商机查询 500）
      ['crm_opportunities', 'next_action_at', 'DATETIME'],
      ['crm_tasks', 'tenant_id', 'TEXT'],
      ['crm_notes', 'tenant_id', 'TEXT'],
      ['crm_timeline_events', 'tenant_id', 'TEXT'],
      ['crm_timeline_events', 'company_id', 'TEXT'],
      ['crm_timeline_events', 'opportunity_id', 'TEXT'],
      ['crm_timeline_events', 'task_id', 'TEXT'],
      ['crm_timeline_events', 'note_id', 'TEXT'],
      ['articles', 'tenant_id', "TEXT NOT NULL DEFAULT 'legacy-local-desktop'"],
      ['articles', 'user_id', "TEXT NOT NULL DEFAULT 'legacy-local-user'"],
      ['articles', 'wechat_data', 'JSONB'],
      ['articles', 'workspace_brief', 'JSONB'],
      ['articles', 'workspace_outline', 'JSONB'],
      ['articles', 'workspace_step', "TEXT NOT NULL DEFAULT 'brief'"],
      ['articles', 'workspace_revision', 'INTEGER NOT NULL DEFAULT 1'],
      // 内容父子关系（报告 16.3 第 9 项）：同一选题多平台变体的 parent 关联
      ['articles', 'parent_id', 'TEXT'],
      [
        'publish_accounts',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'publish_accounts',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      ['publish_accounts', 'status', "TEXT NOT NULL DEFAULT 'ready'"],
      [
        'publish_records',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'publish_records',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      ['publish_records', 'durable_record_id', 'TEXT'],
      ['publish_records', 'source_identity', 'JSONB'],
      ['publish_records', 'body_snapshot', 'TEXT'],
      ['publish_records', 'payload_json', 'JSONB'],
      ['publish_records', 'result_json', 'JSONB'],
      ['publish_records', 'readback_state', "TEXT NOT NULL DEFAULT 'pending'"],
      // 归因主键（报告 10.6）：内容版本→发布→互动→线索→CRM→复盘 的稳定主键
      ['publish_records', 'content_version_id', 'TEXT'],
      ['publish_records', 'publish_intent_id', 'TEXT'],
      ['publish_records', 'correlation_id', 'TEXT'],
      [
        'local_engine_reply_rules',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'local_engine_reply_rules',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      ['local_engine_reply_rules', 'bot_key', "TEXT NOT NULL DEFAULT ''"],
      [
        'local_engine_reply_rules',
        'config_version',
        'INTEGER NOT NULL DEFAULT 1',
      ],
      ['local_engine_reply_rules', 'revision', 'INTEGER NOT NULL DEFAULT 1'],
      ['local_engine_reply_rules', 'created_at', 'DATETIME'],
      ['local_engine_reply_rules', 'name', 'TEXT'],
      ['local_engine_reply_rules', 'industry', 'TEXT'],
      ['local_engine_reply_rules', 'tone', 'TEXT'],
      ['local_engine_reply_rules', 'send_mode', 'TEXT'],
      ['local_engine_reply_rules', 'keywords', "JSONB NOT NULL DEFAULT '[]'"],
      [
        'local_engine_reply_rules',
        'forbidden_words',
        "JSONB NOT NULL DEFAULT '[]'",
      ],
      ['local_engine_reply_rules', 'highlights', "JSONB NOT NULL DEFAULT '[]'"],
      ['local_engine_reply_rules', 'closing_text', 'TEXT'],
      ['local_engine_reply_rules', 'escalation_rules', 'JSONB'],
      ['local_engine_reply_rules', 'enabled', 'BOOLEAN NOT NULL DEFAULT true'],
      // User.avatar 是 schema.prisma 新增列，旧库/全新空库建表 SQL 都可能缺失：
      // 缺列会直接导致登录等查询抛 PrismaClientKnownRequestError（column does not exist）
      ['users', 'avatar', 'TEXT'],
      [
        'local_engine_agent_sessions',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'local_engine_agent_sessions',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      ['local_engine_agent_sessions', 'scope', 'TEXT'],
      ['local_engine_agent_sessions', 'target_app', 'TEXT'],
      ['local_engine_agent_sessions', 'instruction', 'TEXT'],
      ['local_engine_agent_sessions', 'risk_level', 'TEXT'],
      ['local_engine_agent_sessions', 'events', "JSONB DEFAULT '[]'"],
      ['local_engine_agent_sessions', 'confirmations', "JSONB DEFAULT '[]'"],
      ['local_engine_agent_sessions', 'evidence', "JSONB DEFAULT '[]'"],
      [
        'local_engine_agent_confirmations',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'local_engine_agent_confirmations',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      [
        'local_engine_agent_confirmations',
        'action',
        "TEXT NOT NULL DEFAULT ''",
      ],
      ['local_engine_agent_confirmations', 'target', 'TEXT'],
      ['local_engine_agent_confirmations', 'target_label', 'TEXT'],
      ['local_engine_agent_confirmations', 'content', 'TEXT'],
      ['local_engine_agent_confirmations', 'reply_text', 'TEXT'],
      ['local_engine_agent_confirmations', 'operator', 'TEXT'],
      ['local_engine_agent_confirmations', 'note', 'TEXT'],
      [
        'interaction_tasks',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'interaction_tasks',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      [
        'runtime_executions',
        'tenant_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-desktop'",
      ],
      [
        'runtime_executions',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      ['runtime_executions', 'idempotency_key', 'TEXT'],
      ['runtime_executions', 'request_hash', 'TEXT'],
      ['runtime_executions', 'confirmation_id', 'TEXT'],
      ['runtime_executions', 'auth_session_id', 'TEXT'],
      ['runtime_executions', 'claim_token', 'TEXT'],
      ['runtime_executions', 'claimed_at', 'DATETIME'],
      ['runtime_executions', 'lease_expires_at', 'DATETIME'],
      ['runtime_executions', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['runtime_executions', 'updated_at', 'DATETIME'],
      ['interaction_tasks', 'claimedBy', 'TEXT'],
      ['growth_workflows', 'industry', 'TEXT'],
      ['growth_workflows', 'scenario', 'TEXT'],
      // P1-6 知识库归属与可见性（爬虫素材=public，本地知识=private）
      ['materials', 'owner_id', 'TEXT'],
      ['materials', 'tenant_id', 'TEXT'],
      ['materials', 'visibility', "TEXT NOT NULL DEFAULT 'private'"],
      // 归因链（阶段 B）：互动归因到内容/某次发布
      ['interaction_tasks', 'sourceArticleId', 'TEXT'],
      ['interaction_tasks', 'publishRecordId', 'TEXT'],
      ['interaction_tasks', 'sourceUrl', 'TEXT'],
      // 互动承接 SLA + 转人工（报告 16.3 第 15 项）
      ['interaction_tasks', 'slaDueAt', 'DATETIME'],
      ['interaction_tasks', 'handoffState', "TEXT NOT NULL DEFAULT 'normal'"],
      ['interaction_tasks', 'handoffReason', 'TEXT'],
      // Topic 归属（逐页体验报告 10.5 P0：Topic 无 owner/tenant scope）
      ['topics', 'tenant_id', "TEXT NOT NULL DEFAULT 'legacy-local-desktop'"],
      ['topics', 'user_id', "TEXT NOT NULL DEFAULT 'legacy-local-user'"],
      // 六步闭环：互动事件补齐统一侧事实层字段（身份/内容/父事件/证据）
      ['interaction_events', 'comment_ref', 'TEXT'],
      ['interaction_events', 'identity_id', 'TEXT'],
      ['interaction_events', 'content_id', 'TEXT'],
      ['interaction_events', 'parent_event_id', 'TEXT'],
      ['interaction_events', 'evidence_url', 'TEXT'],
      ['interaction_events', 'raw_hash', 'TEXT'],
      // S0-P1-10 定时任务按用户隔离：旧库 schedule_configs 缺 user_id，索引却引用它（schema drift 兜底）
      [
        'schedule_configs',
        'user_id',
        "TEXT NOT NULL DEFAULT 'legacy-local-user'",
      ],
      // schema drift 兜底：以下 3 列 schema 有但旧库缺
      ['ai_tool_call_logs', 'cost_points', 'INTEGER NOT NULL DEFAULT 0'],
      ['exposure_accounts', 'user_id', "TEXT NOT NULL DEFAULT ''"],
      ['entitlement_snapshots', 'planMode', 'TEXT'],
      // P1-11 复核：统一 Lead 桥接/评分状态 + 身份置信度 + 缺失字段清单（旧库缺列）
      ['leads', 'enrichment_status', 'TEXT'],
      ['leads', 'identity_confidence', 'INTEGER NOT NULL DEFAULT 0'],
      ['leads', 'missing_fields', "TEXT NOT NULL DEFAULT '[]'"],
      // P1-14 复核：RPA 记录来源审计语义（旧库缺列）
      ['rpa_executions', 'source', "TEXT NOT NULL DEFAULT 'driver'"],
    ] as const) {
      await this.ensureSqliteColumn(column[0], column[1], column[2]);
    }

    // P1-6 回填：爬虫素材（非本地知识）是系统公共，visibility 应为 public
    await this.$executeRawUnsafe(
      `UPDATE materials
       SET visibility = 'public'
       WHERE platform != 'LocalKnowledge'
         AND (visibility IS NULL OR visibility = 'private')`,
    );

    await this.$executeRawUnsafe(
      `UPDATE local_engine_reply_rules
       SET bot_key = id
       WHERE bot_key IS NULL OR TRIM(bot_key) = ''`,
    );
    await this.$executeRawUnsafe(
      `UPDATE local_engine_reply_rules
       SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP)
       WHERE created_at IS NULL`,
    );

    // v1.1.111（云电脑真机 2026-08-31）：旧库（platform_id 可空时代）遗留
    // platform_id IS NULL 的 ai_models 行与现 schema（NOT NULL）不符 →
    // Prisma include platform 抛 "Field platform is required to return data,
    // got null instead"（KaypalModelSyncService 启动同步失败降级）。
    // 回填到 Kaypal 模型台（无则第一个平台）；仍无可绑定平台时删除孤儿行。
    await this.$executeRawUnsafe(
      `UPDATE ai_models
       SET platform_id = COALESCE(
         (SELECT id FROM ai_platforms WHERE name = 'Kaypal 模型台' LIMIT 1),
         (SELECT id FROM ai_platforms ORDER BY created_at LIMIT 1)
       )
       WHERE platform_id IS NULL`,
    );
    await this.$executeRawUnsafe(
      `DELETE FROM ai_models WHERE platform_id IS NULL`,
    );

    await this.repairSqliteNullTimestamps();
    await this.repairUnsupportedSqliteTimestampColumns();
    await this.repairRpaEvidenceStepIds();

    for (const statement of statements) {
      if (!this.isSqliteIndexStatement(statement)) {
        continue;
      }
      await this.$executeRawUnsafe(statement);
    }
  }

  /**
   * 桌面端 SQLite 列级收敛（2026-08-22 真机 500 根因修复）：
   * 新 schema 加列后，已装用户的旧库不自动加列 → Prisma 查询报
   * "column does not exist"。启动时对已知演进列做 PRAGMA 检查 + ALTER ADD。
   */
  private async ensureSqliteSchemaColumns(): Promise<void> {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) {
      return;
    }
    // 表 → 需保证存在的列（含类型声明；ADD COLUMN 不支持默认值表达式外复杂约束，保持简单）
    const columnMigrations: Array<{
      table: string;
      column: string;
      ddl: string;
    }> = [
      // CrmCustomer P2 归因主键链（2026-08-20 新增）
      { table: 'crm_customers', column: 'source_article_id', ddl: 'TEXT' },
      {
        table: 'crm_customers',
        column: 'source_publish_record_id',
        ddl: 'TEXT',
      },
      {
        table: 'crm_customers',
        column: 'source_interaction_event_id',
        ddl: 'TEXT',
      },
      { table: 'crm_customers', column: 'source_task_id', ddl: 'TEXT' },
      { table: 'crm_customers', column: 'source_run_id', ddl: 'TEXT' },
      // v1.1.104（真机 P0，8/30 15827）：旧库 mobile_devices 缺 device_token_hash，
      // 缺列时 ensureSqliteCoreTables 的 CREATE INDEX 崩（P2010 no such column）
      { table: 'mobile_devices', column: 'device_token_hash', ddl: 'TEXT' },
    ];
    for (const mig of columnMigrations) {
      try {
        // 表不存在则跳过（ensureSqliteCoreTables 会建核心表，业务表由各自模块懒建）
        const rowsRaw: unknown = await this.$queryRawUnsafe(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=$1`,
          mig.table,
        );
        const rows = rowsRaw as Array<{ name: string }>;
        if (!rows.length) continue;
        const colsRaw: unknown = await this.$queryRawUnsafe(
          `PRAGMA table_info(${mig.table})`,
        );
        const cols = colsRaw as Array<{ name: string }>;
        if (cols.some((col) => col.name === mig.column)) continue;
        await this.$executeRawUnsafe(
          `ALTER TABLE ${mig.table} ADD COLUMN ${mig.column} ${mig.ddl}`,
        );
        this.logger.log(
          `SQLite 列收敛：${mig.table}.${mig.column} 已补（旧库升级）`,
        );
      } catch (error) {
        this.logger.warn(
          `SQLite 列收敛失败 ${mig.table}.${mig.column}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private isSqliteIndexStatement(statement: string) {
    return /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement);
  }

  private async ensureSqliteColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ) {
    const columns = await this.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info(${tableName})`,
    );
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    await this.$executeRawUnsafe(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }

  /**
   * P1 复核：rpa_evidence.step_id 历史数据回填（SQLite 桌面版）。
   * 旧版写入的是 sequence_no 的字符串形式；回填为同执行下对应步骤记录的真实 id，
   * 回填不到的（孤儿）置 NULL。幂等：纯数字回填后不再命中；已是真实 id 的不受影响。
   */
  private async repairRpaEvidenceStepIds() {
    try {
      // 1) 纯数字 step_id（旧 sequenceNo 语义）→ 真实步骤记录 id
      //    CAST 回读对比是 SQLite 判定整数字符串的惯用法（'12abc'→12 不等于原串即排除）
      await this.$executeRawUnsafe(`
        UPDATE rpa_evidence
        SET step_id = s.id
        FROM rpa_execution_steps s
        WHERE s.execution_id = rpa_evidence.execution_id
          AND rpa_evidence.step_id <> ''
          AND CAST(rpa_evidence.step_id AS INTEGER) > 0
          AND CAST(CAST(rpa_evidence.step_id AS INTEGER) AS TEXT) = rpa_evidence.step_id
          AND s.sequence_no = CAST(rpa_evidence.step_id AS INTEGER)
      `);
      // 2) 孤儿清理：仍不指向任何步骤记录的 step_id → NULL
      await this.$executeRawUnsafe(`
        UPDATE rpa_evidence
        SET step_id = NULL
        WHERE step_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM rpa_execution_steps s WHERE s.id = rpa_evidence.step_id
          )
      `);
    } catch (error) {
      this.logger.warn(
        `rpa_evidence.step_id 回填失败（不阻断启动）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async repairSqliteNullTimestamps() {
    const tables = await this.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );

    for (const table of tables) {
      const tableName = this.quoteSqliteIdentifier(table.name);
      const columns = await this.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info(${tableName})`,
      );
      const names = new Set(columns.map((column) => column.name));
      const updatedColumn = names.has('updatedAt')
        ? 'updatedAt'
        : names.has('updated_at')
          ? 'updated_at'
          : null;
      if (!updatedColumn) continue;

      const createdColumn = names.has('createdAt')
        ? 'createdAt'
        : names.has('created_at')
          ? 'created_at'
          : null;
      const fallback = createdColumn
        ? `COALESCE("${createdColumn}", CURRENT_TIMESTAMP)`
        : 'CURRENT_TIMESTAMP';
      await this.$executeRawUnsafe(
        `UPDATE ${tableName} SET "${updatedColumn}" = ${fallback} WHERE "${updatedColumn}" IS NULL`,
      );
    }
  }

  private async repairUnsupportedSqliteTimestampColumns() {
    const tables = await this.$queryRawUnsafe<
      Array<{ name: string; sql: string | null }>
    >(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%TIMESTAMP(3)%'`,
    );
    for (const table of tables) {
      if (!table.sql || table.name.startsWith('sqlite_')) {
        continue;
      }
      await this.rebuildSqliteTableWithDatetimeColumns(table.name, table.sql);
    }
  }

  private async rebuildSqliteTableWithDatetimeColumns(
    tableName: string,
    createSql: string,
  ) {
    const tempTable = `${tableName}__datetime_repair`;
    const quotedTable = this.quoteSqliteIdentifier(tableName);
    const quotedTempTable = this.quoteSqliteIdentifier(tempTable);
    const columns = await this.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info(${quotedTable})`,
    );
    const columnList = columns
      .map((column) => this.quoteSqliteIdentifier(column.name))
      .join(', ');
    if (!columnList) {
      return;
    }

    const indexes = await this.$queryRawUnsafe<Array<{ sql: string | null }>>(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
      tableName,
    );
    const repairedCreateSql = createSql
      .replace(
        /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\S+)/i,
        `CREATE TABLE ${quotedTempTable}`,
      )
      .replace(/TIMESTAMP\(3\)/gi, 'DATETIME');

    this.logger.warn(
      `修复 SQLite 表 ${tableName} 的 TIMESTAMP(3) 列类型为 DATETIME`,
    );
    await this.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    try {
      await this.$executeRawUnsafe(`DROP TABLE IF EXISTS ${quotedTempTable}`);
      await this.$executeRawUnsafe(repairedCreateSql);
      await this.$executeRawUnsafe(
        `INSERT INTO ${quotedTempTable} (${columnList}) SELECT ${columnList} FROM ${quotedTable}`,
      );
      await this.$executeRawUnsafe(`DROP TABLE ${quotedTable}`);
      await this.$executeRawUnsafe(
        `ALTER TABLE ${quotedTempTable} RENAME TO ${quotedTable}`,
      );
      for (const index of indexes) {
        if (index.sql) {
          await this.$executeRawUnsafe(index.sql);
        }
      }
    } finally {
      await this.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    }
  }

  private quoteSqliteIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
