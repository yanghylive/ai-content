import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/auth.utils';

function readArg(name: string) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

async function main() {
  const identifier = (readArg('identifier') || readArg('username') || readArg('phone') || readArg('email')).trim().toLowerCase();
  const newPassword = readArg('password');

  if (!identifier || !newPassword) {
    throw new Error('用法: ts-node -r tsconfig-paths/register scripts/reset-user-password.ts --identifier <username|phone|email> --password <新密码>');
  }

  if (newPassword.length < 8) {
    throw new Error('密码长度不能少于 8 位');
  }

  const prisma = new PrismaClient();

  const isPhone = /^\d{6,}$/.test(identifier);
  const phoneEmail = `phone-${identifier}@kaypal.invalid`;

  const orFilters: Array<Record<string, string>> = [{ username: identifier }];
  if (identifier.includes('@')) {
    orFilters.push({ email: identifier });
  } else if (isPhone) {
    orFilters.push({ email: phoneEmail });
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: orFilters,
    },
  });

  if (!user) {
    throw new Error(`未找到匹配账号: ${identifier}`);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, status: 'active' },
  });

  console.log(`已重置账号密码:`);
  console.log(`  id:        ${user.id}`);
  console.log(`  username:  ${user.username}`);
  console.log(`  email:     ${user.email}`);
  console.log(`  name:      ${user.name}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
