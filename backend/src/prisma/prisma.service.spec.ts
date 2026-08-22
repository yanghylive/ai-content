import { PrismaService } from './prisma.service';

type TestablePrismaService = {
  ensureSqliteCoreTables(): Promise<void>;
  $executeRawUnsafe: jest.Mock<Promise<number>, [string, ...unknown[]]>;
  $queryRawUnsafe: jest.Mock<Promise<unknown[]>, [string, ...unknown[]]>;
};

describe('PrismaService SQLite startup safety', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSqliteDatabaseUrl = process.env.SQLITE_DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalSqliteDatabaseUrl === undefined) {
      delete process.env.SQLITE_DATABASE_URL;
    } else {
      process.env.SQLITE_DATABASE_URL = originalSqliteDatabaseUrl;
    }
    jest.restoreAllMocks();
  });

  function createService() {
    const service = new PrismaService() as unknown as TestablePrismaService;
    service.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
    service.$queryRawUnsafe = jest.fn(async (sql: string) => {
      if (/sqlite_master WHERE type = 'table'.*TIMESTAMP\(3\)/.test(sql)) {
        return [];
      }
      if (/^PRAGMA table_info/.test(sql)) {
        return [];
      }
      return [];
    });
    return service;
  }

  function executedSql(service: TestablePrismaService) {
    return service.$executeRawUnsafe.mock.calls.map(([sql]) => sql).join('\n');
  }

  it('creates current tenant-scoped publishing, task, Agent, and runtime tables for an empty database', async () => {
    process.env.SQLITE_DATABASE_URL = 'file:./empty.sqlite';
    const service = createService();

    await service.ensureSqliteCoreTables();

    const sql = executedSql(service);
    for (const table of [
      'articles',
      'publish_accounts',
      'publish_records',
      'interaction_tasks',
      'local_engine_agent_sessions',
      'local_engine_agent_confirmations',
      'runtime_executions',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop'[\\s\\S]*user_id TEXT NOT NULL DEFAULT 'legacy-local-user'`,
        ),
      );
    }
    expect(sql).toContain(
      'runtime_executions_tenant_id_user_id_taskType_createdAt_idx',
    );
    expect(sql).toContain('interaction_tasks_tenant_id_user_id_createdAt_idx');
    expect(sql).toContain('articles_tenant_id_user_id_created_at_idx');
    expect(sql).toContain(
      'publish_accounts_tenant_id_user_id_platform_status_idx',
    );
    expect(sql).toContain(
      'publish_records_tenant_id_user_id_durable_record_id_idx',
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS publish_records \([\s\S]*durable_record_id TEXT[\s\S]*source_identity JSONB[\s\S]*body_snapshot TEXT[\s\S]*payload_json JSONB[\s\S]*result_json JSONB/,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS articles \([\s\S]*workspace_brief JSONB[\s\S]*workspace_outline JSONB[\s\S]*workspace_step TEXT NOT NULL DEFAULT 'brief'[\s\S]*workspace_revision INTEGER NOT NULL DEFAULT 1/,
    );

    // 架构性补齐：ensureSqliteCoreTables 必须覆盖 schema.prisma 全部表（含此前缺失的 59 张）
    for (const table of [
      'ai_usage_quotas',
      'ai_chat_logs',
      'ai_tool_call_logs',
      'growth_acquisition_configs',
      'growth_acquisition_runs',
      'content_strategies',
      'billing_subscriptions',
      'wecom_group_msg_tasks',
      'mobile_devices',
      'user_memories',
      'cps_orders',
      'savings_checkins',
    ]) {
      expect(sql).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`),
      );
    }
  });

  it('upgrades older SQLite tables with the recent tenant columns and rule fields', async () => {
    process.env.SQLITE_DATABASE_URL = 'file:./upgrade.sqlite';
    const service = createService();

    await service.ensureSqliteCoreTables();

    const sql = executedSql(service);
    for (const table of [
      'articles',
      'publish_accounts',
      'publish_records',
      'interaction_tasks',
      'local_engine_agent_sessions',
      'local_engine_agent_confirmations',
      'runtime_executions',
    ]) {
      expect(sql).toContain(
        `ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'legacy-local-desktop'`,
      );
      expect(sql).toContain(
        `ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy-local-user'`,
      );
    }
    expect(sql).toContain(
      "ALTER TABLE local_engine_reply_rules ADD COLUMN bot_key TEXT NOT NULL DEFAULT ''",
    );
    expect(sql).toContain(
      'ALTER TABLE local_engine_reply_rules ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1',
    );
    expect(sql).toContain(
      "ALTER TABLE publish_accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
    );
    expect(sql).toContain('ALTER TABLE articles ADD COLUMN wechat_data JSONB');
    expect(sql).toContain(
      'ALTER TABLE articles ADD COLUMN workspace_brief JSONB',
    );
    expect(sql).toContain(
      'ALTER TABLE articles ADD COLUMN workspace_outline JSONB',
    );
    expect(sql).toContain(
      "ALTER TABLE articles ADD COLUMN workspace_step TEXT NOT NULL DEFAULT 'brief'",
    );
    expect(sql).toContain(
      'ALTER TABLE articles ADD COLUMN workspace_revision INTEGER NOT NULL DEFAULT 1',
    );
    for (const column of [
      'durable_record_id TEXT',
      'source_identity JSONB',
      'body_snapshot TEXT',
      'payload_json JSONB',
      'result_json JSONB',
    ]) {
      expect(sql).toContain(`ALTER TABLE publish_records ADD COLUMN ${column}`);
    }
    expect(sql).toContain('SET bot_key = id');
    expect(sql).toContain(
      'SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP)',
    );
  });

  it('keeps current publishing columns intact and only reapplies idempotent indexes', async () => {
    process.env.SQLITE_DATABASE_URL = 'file:./current.sqlite';
    const service = createService();
    const currentColumns: Record<string, string[]> = {
      articles: [
        'tenant_id',
        'user_id',
        'wechat_data',
        'workspace_brief',
        'workspace_outline',
        'workspace_step',
        'workspace_revision',
        'parent_id',
      ],
      publish_accounts: ['tenant_id', 'user_id', 'status'],
      publish_records: [
        'tenant_id',
        'user_id',
        'durable_record_id',
        'source_identity',
        'body_snapshot',
        'payload_json',
        'result_json',
        'readback_state',
        'content_version_id',
        'publish_intent_id',
        'correlation_id',
      ],
    };
    service.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      const table = sql.match(/^PRAGMA table_info\(([^)]+)\)/)?.[1];
      if (table) {
        return (currentColumns[table] || []).map((name) => ({ name }));
      }
      return [];
    });

    await service.ensureSqliteCoreTables();

    const sql = executedSql(service);
    expect(sql).not.toMatch(
      /ALTER TABLE (articles|publish_accounts|publish_records) ADD COLUMN/,
    );
    expect(sql).toContain('articles_tenant_id_user_id_created_at_idx');
    expect(sql).toContain(
      'publish_records_tenant_id_user_id_durable_record_id_idx',
    );
  });

  it('backfills null updated timestamps from created timestamps on legacy tables', async () => {
    process.env.SQLITE_DATABASE_URL = 'file:./legacy.sqlite';
    const service = createService();
    service.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (/sqlite_master WHERE type = 'table' AND name NOT LIKE/.test(sql)) {
        return [{ name: 'interaction_tasks' }];
      }
      if (/^PRAGMA table_info/.test(sql)) {
        return [{ name: 'createdAt' }, { name: 'updatedAt' }];
      }
      return [];
    });

    await service.ensureSqliteCoreTables();

    expect(executedSql(service)).toContain(
      'UPDATE "interaction_tasks" SET "updatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL',
    );
  });

  it('does not run SQLite bootstrap for a server database', async () => {
    process.env.SQLITE_DATABASE_URL = '';
    process.env.DATABASE_URL = 'postgresql://localhost/kaypal';
    const service = createService();

    await service.ensureSqliteCoreTables();

    expect(service.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(service.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('PrismaService SQLite 列级收敛（真机 500 修复）', () => {
  it('ensureSqliteSchemaColumns：缺列时补列，已存在跳过', async () => {
    const { PrismaService } = require('./prisma.service');
    const svc = Object.create(PrismaService.prototype) as any;
    // mock raw 查询：每次迭代都返回 表存在 + PRAGMA 旧列（缺归因列）
    let rawCall = 0;
    svc.$queryRawUnsafe = jest.fn().mockImplementation(async () => {
      rawCall += 1;
      // 奇数次 = sqlite_master 表检查；偶数次 = PRAGMA table_info
      return rawCall % 2 === 1
        ? [{ name: 'crm_customers' }]
        : [
            { name: 'id' },
            { name: 'owner_id' },
            { name: 'source_url' },
          ];
    });
    svc.$executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    svc.logger = { log: jest.fn(), warn: jest.fn() };
    process.env.SQLITE_DATABASE_URL = 'file:./test.sqlite';
    await svc.ensureSqliteSchemaColumns();
    // 5 个归因列应触发 ADD COLUMN
    expect(svc.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE crm_customers ADD COLUMN source_article_id'),
    );
    expect(svc.$executeRawUnsafe.mock.calls.length).toBe(5);
    delete process.env.SQLITE_DATABASE_URL;
  });

  it('ensureSqliteSchemaColumns：非 SQLite 跳过', async () => {
    const { PrismaService } = require('./prisma.service');
    const svc = Object.create(PrismaService.prototype) as any;
    svc.$queryRawUnsafe = jest.fn();
    svc.$executeRawUnsafe = jest.fn();
    process.env.DATABASE_URL = 'postgres://x';
    await svc.ensureSqliteSchemaColumns();
    expect(svc.$executeRawUnsafe).not.toHaveBeenCalled();
    delete process.env.DATABASE_URL;
  });
});
