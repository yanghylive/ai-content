import type { RuntimeExecutionResult } from '../runtime/executor.interface';

export interface RuntimeCompletionEvaluation {
  complete: boolean;
  message: string;
  reasonCode: RuntimeExecutionResult['reasonCode'];
}

export function evaluateRuntimeCompletion(
  result: RuntimeExecutionResult,
  options: {
    requireReadback: boolean;
    ignoredEvidenceLabels?: string[];
  },
): RuntimeCompletionEvaluation {
  if (!result.ok || result.status !== 'success') {
    return {
      complete: false,
      message: result.userMessage,
      reasonCode: result.reasonCode,
    };
  }

  const ignoredLabels = new Set(options.ignoredEvidenceLabels ?? []);
  const hasEvidence = result.evidence.some(
    (item) =>
      !ignoredLabels.has(item.label) &&
      Boolean(item.path || item.value || item.raw),
  );
  if (!hasEvidence) {
    return {
      complete: false,
      message: '执行器没有返回可核验的执行证据，本次任务未标记完成。',
      reasonCode: 'readback_failed',
    };
  }

  if (options.requireReadback && result.readback?.matched !== true) {
    return {
      complete: false,
      message: '执行器没有返回匹配的结果回读，本次任务未标记完成。',
      reasonCode: 'readback_failed',
    };
  }

  return {
    complete: true,
    message: result.userMessage,
    reasonCode: result.reasonCode,
  };
}
