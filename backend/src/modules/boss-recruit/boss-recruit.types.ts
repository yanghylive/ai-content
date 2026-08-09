// Boss 直聘获客（boss-recruit）：Playwright 自动化 Boss 直聘网页 + 候选人/职位管理
// 参考炼刀 boss_service：网页自动化 + 微信联系人联动触达

export type BossLoginStatus = 'unknown' | 'logged_in' | 'not_logged_in' | 'failed';

export interface BossRecruitState {
  accounts: Array<{
    id: string;
    name: string;
    loginStatus: BossLoginStatus;
    lastCheckedAt: string | null;
  }>;
  candidates: number;
  tasks: number;
  pendingTasks: number;
}

export interface BossLoginCheckResult {
  ok: boolean;
  status: BossLoginStatus;
  url?: string;
  title?: string;
}

export interface BossSyncPositionsInput {
  accountId: string;
  limit?: number;
}

export interface BossHelloInput {
  accountId: string;
  candidateName: string;
  message?: string;
}
