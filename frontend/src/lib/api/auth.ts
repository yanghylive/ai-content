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
}

export interface KaypalDevice {
  id: string;
  name: string;
  platform: 'mac' | 'windows' | 'linux' | 'web';
  lastActiveAt: string;
  current: boolean;
}

export interface KaypalSubscription {
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'cancelled';
  renewsAt: string | null;
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
};
