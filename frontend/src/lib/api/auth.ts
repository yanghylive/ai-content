import { api } from './client';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  name: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  kaypalUserId?: string | null;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
}

export interface SetupStatus {
  hasUsers: boolean;
  totalUsers: number;
}

export const authApi = {
  login(username: string, password: string) {
    return api.post<{ user: AuthUser; expiresAt: string }>('/auth/login', {
      username,
      password,
    });
  },

  logout() {
    return api.post<{ success: boolean }>('/auth/logout');
  },

  me() {
    return api.get<AuthUser>('/auth/me');
  },

  setupStatus() {
    return api.get<SetupStatus>('/auth/setup-status');
  },
};

export interface KaypalProfile {
  userId: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionPlan?: string | null;
  role?: string | null;
  platformRole?: string | null;
  platformRoleId?: string | null;
  platformRoleName?: string | null;
  permissions?: string[] | null;
}

export interface KaypalDevice {
  id: string;
  name: string;
  platform: 'mac' | 'windows' | 'linux' | 'web';
  lastActiveAt?: string;
  lastSeenAt?: string;
  current: boolean;
  status?: 'online' | 'offline' | string;
}

export interface KaypalSubscription {
  plan: 'free' | 'pro' | 'enterprise' | string;
  status: 'active' | 'expired' | 'cancelled' | string;
  renewsAt: string | null;
  periodEnd?: string | null;
  expired?: boolean;
  features: string[];
}

export const kaypalApi = {
  profile() {
    return api.get<KaypalProfile>('/kaypal/profile');
  },
  devices() {
    return api.get<KaypalDevice[]>('/kaypal/devices');
  },
  subscription() {
    return api.get<KaypalSubscription>('/kaypal/subscription');
  },
  linkKaypalAccount(kaypalUserId: string) {
    return api.post<{ ok: boolean; kaypalUserId: string }>(
      '/kaypal/link',
      { kaypalUserId },
    );
  },
  bindWithCredentials(identifier: string, password: string) {
    return api.post<{
      ok: boolean;
      kaypalUserId: string;
      email?: string;
      displayName?: string | null;
    }>('/kaypal/bind-with-credentials', { identifier, password });
  },
  unlinkKaypalAccount() {
    return api.post<{ ok: boolean }>('/kaypal/unlink');
  },
  startKaypalDeviceAuth(input: {
    deviceId: string;
    deviceName: string;
    platform: string;
  }) {
    return api.post<{
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresIn: number;
      interval: number;
    }>('/kaypal/desktop-auth/start', input);
  },
  pollKaypalDeviceAuth(input: { deviceCode: string; deviceId: string }) {
    return api.post<{
      status: 'pending' | 'denied' | 'authorized';
      user?: {
        id: string;
        username: string;
        name: string;
        email: string;
        kaypalUserId?: string | null;
      };
    }>('/kaypal/desktop-auth/poll', input);
  },
  openKaypalDeviceAuth(input: { verificationUrl: string }) {
    return api.post<{ ok: boolean }>('/kaypal/desktop-auth/open', input);
  },
};
