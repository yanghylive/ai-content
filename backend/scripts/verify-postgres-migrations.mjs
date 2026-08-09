import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv();

const sourceUrl = (
  process.env.COMMERCIAL_MIGRATION_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ''
).trim();

if (
  !sourceUrl.startsWith('postgresql://') &&
  !sourceUrl.startsWith('postgres://')
) {
  throw new Error(
    'PostgreSQL migration verification requires DATABASE_URL or COMMERCIAL_MIGRATION_DATABASE_URL.',
  );
}

const schemaName = `commercial_migration_smoke_${Date.now()}_${randomBytes(3).toString('hex')}`;
const schemaUrl = new URL(sourceUrl);
schemaUrl.searchParams.set('schema', schemaName);

const admin = new PrismaClient({
  datasources: { db: { url: sourceUrl } },
});
const isolated = new PrismaClient({
  datasources: { db: { url: schemaUrl.toString() } },
});

let schemaCreated = false;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;

  const prismaCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const migration = spawnSync(
    prismaCommand,
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: schemaUrl.toString(),
      },
    },
  );

  if (migration.status !== 0) {
    const details = [migration.stdout, migration.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(`Isolated migration deploy failed.\n${details}`);
  }

  const [migrationRows, tableRows] = await Promise.all([
    isolated.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "${schemaName}"."_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ),
    isolated.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      schemaName,
    ),
  ]);

  const migrationCount = Number(migrationRows[0]?.count || 0);
  const tableCount = Number(tableRows[0]?.count || 0);
  if (migrationCount === 0 || tableCount === 0) {
    throw new Error(
      `Isolated migration verification produced an empty schema (${migrationCount} migrations, ${tableCount} tables).`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        migrationCount,
        tableCount,
        cleanup: 'pending',
      },
      null,
      2,
    ),
  );
} finally {
  await isolated.$disconnect();
  if (schemaCreated) {
    await admin.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
  }
  await admin.$disconnect();
}

console.log(JSON.stringify({ cleanup: 'complete' }));
