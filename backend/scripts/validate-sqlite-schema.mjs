#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  SQLITE_DATABASE_URL: process.env.SQLITE_DATABASE_URL || 'file:./kaypal-ai.sqlite',
};

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prisma', 'validate', '--schema', 'prisma/schema.sqlite.prisma'],
  {
    env,
    stdio: 'inherit',
  }
);

process.exit(result.status ?? 1);
