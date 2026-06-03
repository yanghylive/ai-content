import { api } from './client';

export interface PublishAccountConfig {
    apiUrl?: string;
    openComment?: number;
    onlyFansCanComment?: number;
    categoryId?: string | number;
    source?: string;
    engineAccountId?: number | string;
    platformType?: number | string;
    filePath?: string;
    userName?: string;
    profileName?: string | null;
    avatarPath?: string | null;
    avatarUrl?: string | null;
    status?: string;
    statusLabel?: string;
    avatarUpdatedAt?: string | null;
    syncedAt?: string;
}

export interface PublishAccount {
    id: string;
    platform: string;
    name: string;
    appId?: string;
    apiToken?: string;
    config?: PublishAccountConfig;
    source?: string;
    engineAccountId?: number | string;
    filePath?: string;
    status?: string;
    statusLabel?: string;
    createdAt: string;
    updatedAt: string;
}

export interface PublishRecord {
    id: string;
    articleId: string;
    accountId: string;
    platform: string;
    status: 'pending' | 'success' | 'failed';
    publishUrl?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    account?: PublishAccount;
}

export const publishingApi = {
    getAccounts(options?: {
        validate?: boolean;
        force?: boolean;
        ids?: number[];
        source?: 'api' | 'local-engine';
        platform?: string;
    }) {
        const params = new URLSearchParams();
        if (options?.validate) {
            params.set('validate', '1');
        }
        if (options?.force) {
            params.set('force', '1');
        }
        if (options?.ids?.length) {
            params.set('ids', options.ids.join(','));
        }
        if (options?.source) {
            params.set('source', options.source);
        }
        if (options?.platform) {
            params.set('platform', options.platform);
        }

        return api.get<PublishAccount[]>(
            `/publishing/accounts${params.size ? `?${params.toString()}` : ''}`,
        );
    },

    createAccount(data: Partial<PublishAccount>) {
        return api.post<PublishAccount>('/publishing/accounts', data);
    },

    updateAccount(id: string, data: Partial<PublishAccount>) {
        return api.put<PublishAccount>(`/publishing/accounts/${id}`, data);
    },

    deleteAccount(id: string) {
        return api.delete(`/publishing/accounts/${id}`);
    },

    publishArticle(articleId: string, accountId: string) {
        return api.post<{ success: boolean; articleId: string }>('/publishing/publish', { articleId, accountId });
    },

    getRecords(articleId: string) {
        return api.get<PublishRecord[]>(`/publishing/records/${articleId}`);
    }
};
