import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type CheckStatus = 'pass' | 'warn' | 'fail';

type CheckResult = {
  label: string;
  status: CheckStatus;
  detail: string;
  nextStep?: string;
};

const prisma = new PrismaClient();

const requiredDefaultPurposes = [
  { purpose: 'article_creation', label: '文章创作默认模型' },
  { purpose: 'topic_selection', label: '选题推荐默认模型' },
];

const recommendedDefaultPurposes = [
  { purpose: 'image_creation', label: '图片创作默认模型' },
  { purpose: 'x_collection', label: 'X 采集默认模型' },
];

function prefix(status: CheckStatus) {
  if (status === 'pass') {
    return '[PASS]';
  }

  if (status === 'warn') {
    return '[WARN]';
  }

  return '[FAIL]';
}

function printSection(title: string) {
  console.log('');
  console.log(`== ${title} ==`);
}

function printResult(result: CheckResult) {
  console.log(`${prefix(result.status)} ${result.label}: ${result.detail}`);
  if (result.nextStep) {
    console.log(`       下一步: ${result.nextStep}`);
  }
}

async function main() {
  const results: CheckResult[] = [];

  const [
    userCount,
    totalPlatforms,
    enabledPlatforms,
    totalModels,
    enabledModels,
    defaultConfigs,
    totalSources,
    enabledSources,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.aIPlatform.count(),
    prisma.aIPlatform.count({ where: { enabled: true } }),
    prisma.aIModel.count(),
    prisma.aIModel.count({ where: { enabled: true } }),
    prisma.defaultModelConfig.findMany(),
    prisma.source.count(),
    prisma.source.count({ where: { enabled: true } }),
  ]);

  const defaultConfigMap = new Map(defaultConfigs.map((item) => [item.purpose, item.modelId]));

  if (userCount > 0) {
    results.push({
      label: '管理员账号',
      status: 'pass',
      detail: `已存在 ${userCount} 个后台账号`,
    });
  } else {
    results.push({
      label: '管理员账号',
      status: 'fail',
      detail: '还没有初始化管理员账号',
      nextStep:
        "cd backend && npm run db:bootstrap-admin -- --username admin --password 'your-password' --email admin@example.com --name 管理员",
    });
  }

  if (enabledPlatforms > 0) {
    results.push({
      label: 'AI 平台',
      status: 'pass',
      detail: `已配置 ${totalPlatforms} 个平台，其中 ${enabledPlatforms} 个已启用`,
    });
  } else {
    results.push({
      label: 'AI 平台',
      status: 'fail',
      detail: '还没有启用的 AI 平台配置',
      nextStep: '登录后台后进入「配置管理 -> AI 平台」添加至少一个可用平台',
    });
  }

  if (enabledModels > 0) {
    results.push({
      label: 'AI 模型',
      status: 'pass',
      detail: `已配置 ${totalModels} 个模型，其中 ${enabledModels} 个已启用`,
    });
  } else {
    results.push({
      label: 'AI 模型',
      status: 'fail',
      detail: '还没有启用的 AI 模型配置',
      nextStep: '登录后台后进入「配置管理 -> AI 模型」添加至少一个文本模型',
    });
  }

  for (const item of requiredDefaultPurposes) {
    if (defaultConfigMap.get(item.purpose)) {
      results.push({
        label: item.label,
        status: 'pass',
        detail: `已分配模型 ${defaultConfigMap.get(item.purpose)}`,
      });
    } else {
      results.push({
        label: item.label,
        status: 'fail',
        detail: '尚未配置',
        nextStep: '登录后台后进入「配置管理 -> 默认模型」完成必需默认模型分配',
      });
    }
  }

  for (const item of recommendedDefaultPurposes) {
    if (defaultConfigMap.get(item.purpose)) {
      results.push({
        label: item.label,
        status: 'pass',
        detail: `已分配模型 ${defaultConfigMap.get(item.purpose)}`,
      });
    } else {
      results.push({
        label: item.label,
        status: 'warn',
        detail: '尚未配置，可选功能可能受限',
        nextStep: '如需图片生成或 X 采集，请在「配置管理 -> 默认模型」中补齐',
      });
    }
  }

  if (enabledSources > 0) {
    results.push({
      label: '信息源',
      status: 'pass',
      detail: `已配置 ${totalSources} 个信息源，其中 ${enabledSources} 个已启用`,
    });
  } else if (totalSources > 0) {
    results.push({
      label: '信息源',
      status: 'fail',
      detail: `已存在 ${totalSources} 个信息源，但当前没有启用项`,
      nextStep: '登录后台后进入「配置管理 -> 采集源配置」启用信息源，或点击“初始化默认渠道”',
    });
  } else {
    results.push({
      label: '信息源',
      status: 'fail',
      detail: '还没有任何信息源配置',
      nextStep: '登录后台后进入「配置管理 -> 采集源配置」，点击“初始化默认渠道”',
    });
  }

  const failedCount = results.filter((item) => item.status === 'fail').length;
  const warningCount = results.filter((item) => item.status === 'warn').length;

  printSection('首次安装检查结果');
  results.forEach(printResult);

  printSection('汇总');
  console.log(`必需项失败: ${failedCount}`);
  console.log(`建议项提醒: ${warningCount}`);

  if (failedCount > 0) {
    console.log('');
    console.log('当前系统还不能算“首次安装完成”。请先处理上面的 FAIL 项，再继续使用。');
    process.exitCode = 1;
    return;
  }

  if (warningCount > 0) {
    console.log('');
    console.log('必需项已经齐全，可以开始使用；但建议项还没配满，部分增强能力可能不可用。');
    return;
  }

  console.log('');
  console.log('首次安装关键项已全部就绪，可以继续采集素材、生成选题和创作内容。');
}

main()
  .catch((error) => {
    console.error('');
    console.error('[FAIL] 首次安装检查执行失败');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
