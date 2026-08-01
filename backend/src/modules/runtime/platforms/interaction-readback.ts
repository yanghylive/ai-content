import {
  type ExecutorTask,
  type RuntimeExecutionResult,
  rejectResult,
} from '../executor.interface';
import { type PlatformInteractionEngineResponse } from './platform-interaction.interface';

export function normalizeInteractionText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim();
}

export function hasMatchedReadback(
  result: Pick<PlatformInteractionEngineResponse, 'readbackText'>,
  expectedText?: string,
) {
  const expected = normalizeInteractionText(expectedText);
  if (!expected) return false;
  const actual = normalizeInteractionText(result.readbackText);
  if (actual && actual.includes(expected)) return true;
  return false;
}

export function requireAutoSendReadback(input: {
  task: ExecutorTask;
  result: PlatformInteractionEngineResponse;
  platformLabel: string;
  actionLabel: string;
}): RuntimeExecutionResult | null {
  const expectedText = (input.task.payload as { replyText?: string }).replyText;
  if (hasMatchedReadback(input.result, expectedText)) {
    return null;
  }

  return rejectResult(
    'readback_failed',
    `${input.platformLabel}${input.actionLabel}未通过回读确认`,
    [
      `engine status=${input.result.status}`,
      `message=${input.result.message ?? 'n/a'}`,
      `expected=${expectedText ?? ''}`,
      `readback=${input.result.readbackText ?? ''}`,
      `replyVisible=${String(input.result.replyVisible ?? false)}`,
      `nextAction=${input.result.nextAction ?? '请重新打开平台页面确认是否实际发送，并修复页面回读选择器。'}`,
    ].join('；'),
  );
}

export function buildMatchedReadback(input: {
  result: Pick<PlatformInteractionEngineResponse, 'readbackText'>;
  expectedText?: string;
}) {
  if (!input.result.readbackText) return undefined;
  return {
    expectedText: input.expectedText,
    actualText: input.result.readbackText,
    matched: hasMatchedReadback(input.result, input.expectedText),
  };
}
