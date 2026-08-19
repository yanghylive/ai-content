/**
 * 统一任务状态（报告 16.3 第 14 项「统一任务中心」）。
 * 把 auto-upload / local-engine / video-workshop / interaction 四套
 * 各自为政的状态，归一成一套统一状态，供任务中心/报表/通知共用。
 */
export type UnifiedTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export const UNIFIED_TASK_STATUS_LABEL: Record<UnifiedTaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  waiting: '待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '卡住待处理',
};

export type TaskModuleName =
  'auto-upload' | 'local-engine' | 'video-workshop' | 'interaction';

/**
 * 各模块原始状态 → 统一状态。
 * 各模块状态命名不一致（completed/succeeded/COMPLETED），在此收敛。
 */
export function normalizeTaskStatus(
  module: TaskModuleName,
  status?: string | null,
): UnifiedTaskStatus {
  const s = (status || '').toLowerCase();
  switch (module) {
    case 'auto-upload':
      if (s === 'completed' || s === 'done') return 'completed';
      if (s === 'failed' || s === 'error') return 'failed';
      if (s === 'waiting') return 'waiting';
      if (s === 'claimed' || s === 'running' || s === 'publishing')
        return 'running';
      if (s === 'queued') return 'queued';
      return 'queued';
    case 'local-engine':
      if (s === 'completed' || s === 'done') return 'completed';
      if (s === 'failed' || s === 'error') return 'failed';
      if (s === 'running') return 'running';
      if (s === 'queued') return 'queued';
      return 'queued';
    case 'video-workshop':
      if (s === 'succeeded' || s === 'completed' || s === 'done')
        return 'completed';
      if (s === 'failed' || s === 'error') return 'failed';
      if (s === 'cancelled') return 'cancelled';
      if (s === 'running') return 'running';
      return 'queued';
    case 'interaction':
      if (s === 'completed') return 'completed';
      if (s === 'failed' || s === 'blocked') return 'failed';
      if (s === 'waiting_for_send_confirmation') return 'waiting';
      if (s === 'skipped' || s === 'no_target') return 'cancelled';
      if (s === 'running') return 'running';
      if (s === 'queued') return 'queued';
      return 'queued';
  }
}
