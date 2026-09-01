interface ElectronAPI {
  system?: {
    openExternal?: (url: string) => Promise<unknown>;
    writeClipboard?: (text: string) => Promise<unknown>;
    secureStoreGet?: (key: string) => Promise<unknown>;
    secureStoreSet?: (key: string, value: string) => Promise<unknown>;
    secureStoreDelete?: (key: string) => Promise<unknown>;
  };
  config: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<unknown>;
  };
  service: {
    restart: () => Promise<{ success: boolean }>;
    status: () => Promise<Record<string, unknown>>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPlatform: () => Promise<NodeJS.Platform>;
    getDataPath: () => Promise<string>;
    checkUpdate: () => Promise<{ success: boolean }>;
    installUpdate: () => Promise<unknown>;
    getUpdateStatus: () => Promise<Record<string, unknown>>;
    downloadUpdate: () => Promise<{ success: boolean }>;
    skipUpdate: (version: string | null) => Promise<{ success: boolean }>;
    getUpdateFeedInfo: () => Promise<Record<string, unknown>>;
  };
  shell: {
    openExternal: (url: string) => Promise<unknown>;
    showItemInFolder: (fullPath: string) => Promise<unknown>;
  };
  workspaceTabs: {
    open: (workspaceId?: string | null, title?: string) => Promise<unknown>;
    openOctop: (url?: string | null) => Promise<unknown>;
    switchTo: (tabId: string) => Promise<unknown>;
    switchBusiness: () => Promise<unknown>;
    close: (tabId: string) => Promise<unknown>;
    setWorkspaceId: (tabId: string, workspaceId: string | null) => Promise<unknown>;
    list: () => Promise<unknown[]>;
    getActive: () => Promise<unknown>;
  };
  onUpdateState: (callback: (state: Record<string, unknown>) => void) => string;
  onUpdateDownloadProgress: (callback: (progress: Record<string, number>) => void) => string;
  onUpdateAvailable: (callback: (info: Record<string, unknown>) => void) => string;
  onUpdateDownloaded: (callback: (info: Record<string, unknown>) => void) => string;
  onUpdateNotAvailable: (callback: () => void) => string;
  onUpdateError: (callback: (error: { message: string }) => void) => string;
  onUpdateChecking: (callback: () => void) => string;
  onServiceStatus: (callback: (status: Record<string, unknown>) => void) => string;
  on?: (channel: string, callback: (...args: unknown[]) => void) => string;
  removeListener: (key: string) => void;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
