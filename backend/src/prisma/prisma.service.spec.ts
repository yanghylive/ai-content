import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PrismaService } from './prisma.service';
import { AuthRequestContextService } from '../common/auth-request-context.service';

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
    // P1（P5 门禁 2026-08-22）：growth_task_drafts 建表回归——
    // 字段映射对齐 schema.prisma GrowthTaskDraft，3 个索引齐全
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS growth_task_drafts \([\s\S]*intent TEXT NOT NULL[\s\S]*config_json JSONB NOT NULL DEFAULT '\{\}'[\s\S]*planned_actions JSONB NOT NULL DEFAULT '\[\]'[\s\S]*readiness TEXT NOT NULL DEFAULT 'needs-input'[\s\S]*draft_hash TEXT[\s\S]*status TEXT NOT NULL DEFAULT 'draft'[\s\S]*expires_at DATETIME NOT NULL/,
    );
    for (const index of [
      'growth_task_drafts_user_id_status_idx',
      'growth_task_drafts_tenant_id_status_idx',
      'growth_task_drafts_intent_status_idx',
    ]) {
      expect(sql).toContain(index);
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
    // 2026-09-01（#21）：还原 DATABASE_URL，防泄漏污染同 worker 后续 spec
    //（agent-gateway hasDb 判定会误读为 pg 可用 → 连本地 pg 失败）
    delete process.env.DATABASE_URL;
    delete process.env.SQLITE_DATABASE_URL;
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
        : [{ name: 'id' }, { name: 'owner_id' }, { name: 'source_url' }];
    });
    svc.$executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    svc.logger = { log: jest.fn(), warn: jest.fn() };
    process.env.SQLITE_DATABASE_URL = 'file:./test.sqlite';
    await svc.ensureSqliteSchemaColumns();
    // 5 个归因列应触发 ADD COLUMN
    expect(svc.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE crm_customers ADD COLUMN source_article_id',
      ),
    );
    // v1.1.104：mobile_devices.device_token_hash 补列加入（真机 P0）——mock 对
    // 所有迭代返回「表存在且缺列」，5 归因列 + 1 device_token_hash = 6 次 ALTER
    expect(svc.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE mobile_devices ADD COLUMN device_token_hash',
      ),
    );
    expect(svc.$executeRawUnsafe.mock.calls.length).toBe(6);
    delete process.env.SQLITE_DATABASE_URL;
  });

  it('ensureSqliteSchemaColumns：非 SQLite 跳过', async () => {
    const { PrismaService } = require('./prisma.service');
    const svc = Object.create(PrismaService.prototype) as any;
    svc.$queryRawUnsafe = jest.fn();
    svc.$executeRawUnsafe = jest.fn();
    // v1.1.104：清可能残留的 SQLITE_DATABASE_URL（前面测试/jest 环境污染）——
    // 否则优先取 SQLITE_DATABASE_URL（file: 开头）不会跳过，且 mock 的 queryRaw
    // 返回 undefined 会在 catch 里打 logger（未 mock 时 TypeError）
    delete process.env.SQLITE_DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://x';
    await svc.ensureSqliteSchemaColumns();
    expect(svc.$executeRawUnsafe).not.toHaveBeenCalled();
    // 2026-09-01（复核第四轮 P1-3）：还原 DATABASE_URL，防止 runInBand
    // 顺序下 delete 后毒化后续 spec 的 Prisma 构造（P1012 校验失败）
    process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
  });
});

/**
 * logout 换库负向用例（2026-09-01，审计 #1/#2/#6/#7/#9/#11 隔离总解）：
 *  - A 账号库写入的数据，B 账号切换后必须查不到（物理隔离）
 *  - 切回 A 数据必须完整保留
 *  - ensureAccountDatabase 首登清空业务表但保留认证表（users）
 * 真实 SQLite 临时库（node_modules/.prisma/client 为 sqlite client 时运行）。
 * 2026-09-01（#21）：client provider 双状态——dev 默认 postgres client 时本套件
 * 的 PRAGMA/sqlite_master 语法不适用，同步探测 client schema 决定 skip/run，
 * 避免与 agent-gateway 的 postgres 测试互相破坏。
 */
import { readFileSync } from 'node:fs';

const clientSchemaPath = join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '.prisma',
  'client',
  'schema.prisma',
);
let clientProvider = '';
try {
  clientProvider =
    readFileSync(clientSchemaPath, 'utf8').match(
      /provider\s*=\s*"(\w+)"/,
    )?.[1] ?? '';
} catch {
  // client schema 缺失时按 sqlite 跑（构建产物环境）
  clientProvider = 'sqlite';
}
const runSqliteIsolation = clientProvider === 'sqlite';
const describeIsolation = runSqliteIsolation ? describe : describe.skip;

describeIsolation('PrismaService 账号库隔离（logout 换库）', () => {
  let dir: string;
  let svc: PrismaService;
  const A = 'user-a';
  const B = 'user-b';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'prisma-acct-'));
    process.env.SQLITE_DATABASE_URL = `file:${join(dir, 'system.sqlite')}`;
    svc = new PrismaService();
    // 系统库：建核心表（users 等）
    await svc.onModuleInit();
    // 全量并发下建 164 张表可能超默认 5s hook 超时，放宽到 60s
    // (Jest hook timeout 由调用方指定：beforeAll(fn, timeout))
    // 业务表（raw 建表 + raw 读写，绕过 Prisma model 字段约束）
    await svc.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, title TEXT)',
    );
  }, 60_000);

  afterAll(async () => {
    await svc.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SQLITE_DATABASE_URL;
  });

  async function materialCount(): Promise<number> {
    const rows = await svc.$queryRawUnsafe<Array<{ c: number }>>(
      'SELECT count(*) as c FROM materials',
    );
    return Number(rows[0]?.c ?? 0);
  }

  it('A 账号库写入的素材，B 账号查不到；切回 A 数据保留', async () => {
    const aPath = await svc.ensureAccountDatabase(A);
    await svc.switchDatabase(aPath);
    await svc.$executeRawUnsafe(
      "INSERT INTO materials (id, title) VALUES ('m-1', 'A 的素材')",
    );
    expect(await materialCount()).toBe(1);

    // B 首登：独立库 + 清空业务表
    const bPath = await svc.ensureAccountDatabase(B);
    await svc.switchDatabase(bPath);
    expect(await materialCount()).toBe(0);

    // 切回 A：数据完整
    await svc.switchDatabase(aPath);
    expect(await materialCount()).toBe(1);
  });

  it('ensureAccountDatabase 保留认证表（users），系统库业务表模板净化', async () => {
    // 认证表结构保留（模板复制自系统库 users，不在清空清单内）
    const tables = await svc.system.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'users'",
    );
    expect(tables.length).toBe(1);
    // A 数据仍在
    expect(await materialCount()).toBe(1);
    // 切回系统库：业务表已净化（首登时清空）
    await svc.switchDatabase(null);
    expect(await materialCount()).toBe(0);
  });

  it('切换期间业务访问被切库闸拒绝（switching 标志）', async () => {
    (svc as unknown as { switching: boolean }).switching = true;
    await expect(Promise.resolve().then(() => svc.material)).rejects.toThrow(
      '数据正在切换',
    );
    (svc as unknown as { switching: boolean }).switching = false;
    expect(svc.material).toBeDefined();
  });

  it('账号库损坏自愈：quick_check 失败 → 带备份重建，可正常读写', async () => {
    const cPath = await svc.ensureAccountDatabase('user-c');
    await svc.switchDatabase(cPath);
    // 先写入一条正常数据
    await svc.$executeRawUnsafe(
      "INSERT INTO materials (id, title) VALUES ('m-c1', 'C 的数据')",
    );
    expect(await materialCount()).toBe(1);

    // 制造损坏：用垃圾字节覆盖库文件（先切回系统库释放连接）
    await svc.switchDatabase(null);
    (
      svc as unknown as {
        accountClients: Map<string, unknown>;
      }
    ).accountClients.delete(cPath);
    writeFileSync(cPath, 'this is not a sqlite database at all........');
    expect(existsSync(cPath)).toBe(true);

    // 再次 ensure：检测到损坏 → 备份 + 重建
    const healedPath = await svc.ensureAccountDatabase('user-c');
    expect(healedPath).toBe(cPath);
    // 备份文件存在
    const backups = readdirSync(dirname(cPath)).filter((f) =>
      f.includes('.corrupt-'),
    );
    expect(backups.length).toBeGreaterThan(0);
    // 重建后可正常读写（业务表空）
    await svc.switchDatabase(cPath);
    expect(await materialCount()).toBe(0);
  });
});

/**
 * 2026-09-01（复核 P1-A）：重启后请求级路由——映射缺失拒绝、guard 确保后恢复。
 * 独立套件（不依赖 sqlite client）：ensureAccountDatabase 打桩（只测路由逻辑）。
 */
describe('PrismaService 重启后请求级路由（复核 P1-A）', () => {
  it('已认证但映射缺失 → 拒绝业务访问，不回退全局；ensure 后恢复', async () => {
    const ctxService = {
      get: jest.fn(),
    } as unknown as AuthRequestContextService;
    const rebootSvc = new PrismaService(ctxService);
    // 打桩 ensureAccountDatabase（登记映射即可，不真实建库）
    rebootSvc.ensureAccountDatabase = jest.fn(async (userId: string) => {
      (
        rebootSvc as unknown as { accountPaths: Map<string, string> }
      ).accountPaths.set(userId, `/tmp/accounts/${userId}.sqlite`);
      return `/tmp/accounts/${userId}.sqlite`;
    });
    // 模拟进程重启：accountPaths 为空 + 无全局活跃库
    (ctxService.get as jest.Mock).mockReturnValue({
      user: { id: 'user-reboot' },
    });
    // 已认证但无账号库映射 → 拒绝（不回退全局/系统库）
    await expect(
      Promise.resolve().then(() => rebootSvc.material),
    ).rejects.toThrow('账号库尚未就绪');
    // guard 已确保账号库（登记映射）→ 请求级路由恢复
    await rebootSvc.ensureAccountDatabase('user-reboot');
    expect(rebootSvc.material).toBeDefined();
    // 切换另一用户：映射缺失同样拒绝（A/B 不串库）
    (ctxService.get as jest.Mock).mockReturnValue({
      user: { id: 'user-other' },
    });
    await expect(
      Promise.resolve().then(() => rebootSvc.material),
    ).rejects.toThrow('账号库尚未就绪');
    await rebootSvc.ensureAccountDatabase('user-other');
    expect(rebootSvc.material).toBeDefined();
  });
});

describe('PrismaService 当前账号库事务（复核 R2）', () => {
  it('在当前请求选中的 client 上连接并开启交互事务', async () => {
    const tx = { growthAcquisitionConfig: { upsert: jest.fn() } };
    const active = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = Object.create(PrismaService.prototype) as PrismaService & {
      resolveActiveClient: jest.Mock;
    };
    service.resolveActiveClient = jest.fn().mockReturnValue(active);

    const result = await service.runActiveTransaction(
      async (client) => client === tx,
      { timeout: 60_000 },
    );

    expect(result).toBe(true);
    expect(active.$connect).toHaveBeenCalledTimes(1);
    expect(active.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 60_000,
    });
  });
});

/**
 * 2026-09-03 P1 防回归：TARGET_ONLY 白名单完整性护栏。
 * 事故：syncTenantOrgTables 加进 ensureAccountDatabase 时漏登白名单 →
 * proxy 把它路由到账号库 PrismaClient（无此方法）→ 登录 500
 * "this.syncTenantOrgTables is not a function"。
 * 护栏不变量：控制面方法（ensureAccountDatabase 等）内部 `this.xxx(` 引用的
 * 方法/属性必须全部登记 TARGET_ONLY，否则经 proxy 路由串库/炸方法。
 * 静态扫源码实现——不依赖 client provider，加新方法自动被覆盖。
 */
describe('PrismaService TARGET_ONLY 白名单完整性护栏（2026-09-03 P1）', () => {
  it('控制面方法内部 this.* 调用必须全部在 TARGET_ONLY 白名单', () => {
    const { readFileSync: readSrc } = require('node:fs') as typeof import('node:fs');
    const src = readSrc(join(__dirname, 'prisma.service.ts'), 'utf8');

    // 1. 提取白名单成员
    const wlMatch = src.match(/TARGET_ONLY = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(wlMatch).toBeTruthy();
    const whitelist = new Set(
      (wlMatch![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)),
    );
    expect(whitelist.size).toBeGreaterThan(10);

    // 2. 提取每个控制面方法体（方法名 → 到下一个 `    async ` / `    xxx(` 顶层成员为止）
    const controlPlane = [
      'ensureAccountDatabase',
      'healAccountDatabaseIfCorrupt',
      'clearAccountBusinessTables',
      'copySqliteDatabaseWithSidecars',
      'syncTenantOrgTables',
      'switchDatabase',
    ];
    // 类成员起始：2 空格缩进（prettier），可带修饰符；方法体内的 if/for 是 4+ 空格不会误匹配
    const memberStart = /^  (?:private |readonly |static |async |get |set )*[A-Za-z_$][\w$]*\s*[(=]/gm;
    const members: Array<{ name: string; start: number }> = [];
    for (const m of src.matchAll(memberStart)) {
      const raw = m[0].trim();
      const name =
        raw.replace(/^(private\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+)+/, '').split(/[\s(=]/)[0] ?? '';
      members.push({ name, start: m.index });
    }
    members.sort((a, b) => a.start - b.start);

    // PrismaClient 基类自带成员（$ 前缀 + 少数白名单外合法访问）不要求登记
    const baseAllowed = (prop: string) =>
      prop.startsWith('$') ||
      ['constructor', 'if', 'for', 'while', 'return', 'catch'].includes(prop);

    for (const ctrl of controlPlane) {
      const idx = members.findIndex((m) => m.name === ctrl);
      expect(idx).toBeGreaterThanOrEqual(0);
      const end = idx + 1 < members.length ? members[idx + 1].start : src.length;
      const body = src.slice(members[idx].start, end);
      for (const call of body.matchAll(/this\.([A-Za-z_$][\w$]*)/g)) {
        const prop = call[1];
        if (baseAllowed(prop)) continue;
        expect({
          method: ctrl,
          thisProp: prop,
          inWhitelist: whitelist.has(prop),
        }).toEqual({
          method: ctrl,
          thisProp: prop,
          inWhitelist: true,
        });
      }
    }
  });
});
