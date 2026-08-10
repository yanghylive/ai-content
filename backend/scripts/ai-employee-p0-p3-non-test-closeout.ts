import { existsSync } from 'fs';
import { join } from 'path';
import {
  AI_EMPLOYEE_CAPABILITIES,
  AI_EMPLOYEE_PHASE0_SPIKES,
  type AiEmployeeCapabilityKey,
  listRouteableAiEmployeeCapabilities,
} from '../src/modules/runtime/ai-employee/ai-employee.contract';

const root = join(__dirname, '..', '..');

const requiredFiles = [
  'docs/liandao-style-ai-employee-platform-plan-2026-06-13.html',
  'docs/ai-employee-p0-p3-remaining-non-test-closeout-2026-06-15.md',
  'docs/ai-employee-p0-p3-evidence-pack-template-2026-06-15.md',
  'frontend/src/app/(dashboard)/apps/ai-employee/page.tsx',
  'frontend/src/lib/ops-workbench/interaction-skills.ts',
  'backend/src/modules/ai-employee/ai-employee.service.ts',
  'backend/src/modules/runtime/ai-employee/ai-employee.contract.ts',
  'vendor/skillhub/wechat-moments-publish/wechat-moments-publish.sh',
  'vendor/skillhub/wechat-moments-marketing/wechat-moments-marketing.sh',
  'vendor/skillhub/wechat-contact-add/wechat-contact-add.sh',
  'scripts/start-local-integration.sh',
];

function fileExists(relativePath: string) {
  return existsSync(join(root, relativePath));
}

function main() {
  const missingFiles = requiredFiles.filter((file) => !fileExists(file));
  const routeable = listRouteableAiEmployeeCapabilities();
  const routeableKeys = new Set(routeable.map((item) => item.key));
  const requiredRouteable: AiEmployeeCapabilityKey[] = [
    'douyin-link-exposure',
    'douyin-search-account-exposure',
    'douyin-hot-video-exposure',
    'wechat-session-reply',
    'wechat-group-broadcast',
    'wechat-contact-add',
    'wechat-moments-publish',
    'wechat-moments-marketing',
    'publish-douyin-video',
    'publish-xiaohongshu-video',
  ];
  const missingRouteable = requiredRouteable.filter((key) => !routeableKeys.has(key));
  const status =
    missingFiles.length === 0 &&
    missingRouteable.length === 0 &&
    AI_EMPLOYEE_PHASE0_SPIKES.length >= 5
      ? 'non_test_closeout_ready'
      : 'non_test_closeout_blocked';

  const result = {
    status,
    checkedAt: new Date().toISOString(),
    scope: 'P0-P3 non-test closeout only; real account acceptance is excluded.',
    totals: {
      capabilities: AI_EMPLOYEE_CAPABILITIES.length,
      routeableNow: routeable.length,
      phase0Spikes: AI_EMPLOYEE_PHASE0_SPIKES.length,
      requiredFiles: requiredFiles.length,
      missingFiles: missingFiles.length,
      missingRouteable: missingRouteable.length,
    },
    missingFiles,
    missingRouteable,
    nextAcceptanceStep:
      status === 'non_test_closeout_ready'
        ? '开始真实账号统一验收：P1 抖音闭环、P2 微信会话/群发/加好友、P3 朋友圈三链路。'
        : '先补齐 missingFiles 或 missingRouteable。',
  };

  console.log(JSON.stringify(result, null, 2));
  if (status !== 'non_test_closeout_ready') {
    process.exitCode = 1;
  }
}

main();
