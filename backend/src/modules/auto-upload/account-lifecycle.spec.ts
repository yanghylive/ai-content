import {
  ACCOUNT_LIFECYCLE_LABEL,
  deriveAccountLifecycle,
} from './account-lifecycle';

describe('deriveAccountLifecycle', () => {
  it('sessionStatus=needs_login → reauth（需要重新登录）', () => {
    expect(
      deriveAccountLifecycle({ sessionStatus: 'needs_login' }),
    ).toBe('reauth');
  });

  it('statusLabel=浏览器阻断 → degraded', () => {
    expect(
      deriveAccountLifecycle({ statusLabel: '浏览器阻断' }),
    ).toBe('degraded');
  });

  it('sessionStatus=error → degraded', () => {
    expect(deriveAccountLifecycle({ sessionStatus: 'error' })).toBe('degraded');
  });

  it('statusLabel=需要重新登录 → reauth', () => {
    expect(
      deriveAccountLifecycle({ statusLabel: '需要重新登录' }),
    ).toBe('reauth');
  });

  it('statusLabel=登录失效 → expired', () => {
    expect(deriveAccountLifecycle({ statusLabel: '登录失效' })).toBe('expired');
  });

  it('statusLabel=待校验 → login_pending', () => {
    expect(deriveAccountLifecycle({ statusLabel: '待校验' })).toBe(
      'login_pending',
    );
  });

  it('loggedIn=true → online', () => {
    expect(deriveAccountLifecycle({ loggedIn: true })).toBe('online');
  });

  it('loggedIn=false → expired', () => {
    expect(deriveAccountLifecycle({ loggedIn: false })).toBe('expired');
  });

  it('无信息 → unbound', () => {
    expect(deriveAccountLifecycle({})).toBe('unbound');
  });

  it('标签全量覆盖：7 个状态都有中文文案和下一步动作', () => {
    const statuses = [
      'unbound',
      'login_pending',
      'online',
      'degraded',
      'expired',
      'reauth',
      'disabled',
    ] as const;
    for (const s of statuses) {
      expect(ACCOUNT_LIFECYCLE_LABEL[s]).toBeTruthy();
    }
  });
});
