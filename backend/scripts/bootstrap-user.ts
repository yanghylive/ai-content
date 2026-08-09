import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  DEFAULT_ADMIN_USERNAME,
} from '../src/modules/auth/auth.constants';
import { hashPassword } from '../src/modules/auth/auth.utils';

function readArg(name: string) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

async function main() {
  const prisma = new PrismaClient();
  const username = (readArg('username').trim().toLowerCase() || DEFAULT_ADMIN_USERNAME);
  const email = (readArg('email').trim().toLowerCase() || DEFAULT_ADMIN_EMAIL);
  const password = readArg('password');
  const name = readArg('name').trim() || DEFAULT_ADMIN_NAME;

  if (!password) {
    throw new Error('请显式传入 --password，例如：npm run db:bootstrap-admin -- --username admin --password <your-password> --email admin@example.com --name 管理员');
  }

  if (password.length < 8) {
    throw new Error('密码长度不能少于 8 位');
  }

  const totalUsers = await prisma.user.count();
  if (totalUsers > 0) {
    throw new Error('系统已存在账号，初始化脚本只允许在首次创建账号时使用');
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      username,
      email,
      name,
      passwordHash,
    },
  });

  console.log(`已创建后台账号：${user.username}`);
  console.log('请妥善保管初始化时使用的密码，系统不会自动生成默认管理员。');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
