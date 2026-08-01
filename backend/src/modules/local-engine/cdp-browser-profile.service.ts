import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProjectDataPath } from '../../common/project-paths';

export type CdpBrowserProfile = {
  platform: string;
  accountId: string;
  profileDir: string;
  exists: boolean;
  sizeBytes: number;
  lastModified: string | null;
};

export type CdpBrowserProfileListResult = {
  profiles: CdpBrowserProfile[];
  rootDir: string;
  totalSizeBytes: number;
  checkedAt: string;
};

@Injectable()
export class CdpBrowserProfileService {
  private readonly logger = new Logger(CdpBrowserProfileService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  getProfileRootDir(): string {
    const localProfileRoot = this.configService.get<string>(
      'LOCAL_BROWSER_PROFILE_ROOT',
    );
    return localProfileRoot || resolveProjectDataPath('browser-profiles');
  }

  getLegacyProfileRootDir(): string | null {
    const configured = this.configService.get<string>(
      'LEGACY_AUTO_UPLOAD_BROWSER_PROFILE_ROOT',
    );
    if (configured) return configured;

    const legacyRoot = this.configService.get<string>(
      'LEGACY_AUTO_UPLOAD_ROOT',
    );
    const candidates = [
      legacyRoot ? join(legacyRoot, 'browser-profiles') : null,
      join(process.cwd(), 'backend', 'data', 'browser-profiles'),
      join(homedir(), 'auto-upload', 'browser-profiles'),
    ].filter((value): value is string => Boolean(value));

    return candidates.find((candidate) => existsSync(candidate)) || null;
  }

  getProfileDir(platform: string, accountId: string): string {
    const sanitizedPlatform = this.sanitize(platform);
    const sanitizedAccountId = this.sanitize(accountId);
    return join(
      this.getProfileRootDir(),
      `${sanitizedPlatform}-${sanitizedAccountId}`,
    );
  }

  ensureProfileExists(platform: string, accountId: string): string {
    const sanitizedPlatform = this.sanitize(platform);
    const sanitizedAccountId = this.sanitize(accountId);
    const profileDir = this.getProfileDir(
      sanitizedPlatform,
      sanitizedAccountId,
    );
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
      this.logger.log(`Created profile directory: ${profileDir}`);
    }
    this.ensureLegacyProfileSnapshot(
      profileDir,
      sanitizedPlatform,
      sanitizedAccountId,
    );
    if (this.hasImportedLegacyBrowserProfile(profileDir)) {
      this.ensureLegacyLoginCookies(
        profileDir,
        sanitizedPlatform,
        sanitizedAccountId,
      );
      void this.ensureLegacyAccountCookieFile(
        profileDir,
        sanitizedPlatform,
        sanitizedAccountId,
        { onlyIfMissing: true },
      );
      return profileDir;
    }
    this.ensureLegacyLoginCookies(
      profileDir,
      sanitizedPlatform,
      sanitizedAccountId,
    );
    void this.ensureLegacyAccountCookieFile(
      profileDir,
      sanitizedPlatform,
      sanitizedAccountId,
    );
    return profileDir;
  }

  async ensureProfileCookiesCurrent(
    platform: string,
    accountId: string,
  ): Promise<void> {
    const sanitizedPlatform = this.sanitize(platform);
    const sanitizedAccountId = this.sanitize(accountId);
    const profileDir = this.getProfileDir(
      sanitizedPlatform,
      sanitizedAccountId,
    );
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    }
    if (this.hasImportedLegacyBrowserProfile(profileDir)) {
      await this.ensureLegacyAccountCookieFile(
        profileDir,
        sanitizedPlatform,
        sanitizedAccountId,
        { onlyIfMissing: true },
      );
      return;
    }
    await this.ensureLegacyAccountCookieFile(
      profileDir,
      sanitizedPlatform,
      sanitizedAccountId,
      { refreshExisting: true },
    );
  }

  restoreLegacyProfileSnapshot(
    platform: string,
    accountId: string,
  ): string | null {
    const sanitizedPlatform = this.sanitize(platform);
    const sanitizedAccountId = this.sanitize(accountId);
    const profileDir = this.getProfileDir(
      sanitizedPlatform,
      sanitizedAccountId,
    );
    const restored = this.ensureLegacyProfileSnapshot(
      profileDir,
      sanitizedPlatform,
      sanitizedAccountId,
      { force: true },
    );
    return restored ? profileDir : null;
  }

  listProfiles(): CdpBrowserProfileListResult {
    const rootDir = this.getProfileRootDir();
    const profiles: CdpBrowserProfile[] = [];
    let totalSizeBytes = 0;

    if (!existsSync(rootDir)) {
      return {
        profiles,
        rootDir,
        totalSizeBytes,
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      const entries = readdirSync(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        const match = dirName.match(/^([a-zA-Z0-9-]+)-([a-zA-Z0-9-]+)$/);
        if (!match) continue;

        const [, platform, accountId] = match;
        const profileDir = join(rootDir, dirName);
        const stats = this.getDirectoryStats(profileDir);

        profiles.push({
          platform,
          accountId,
          profileDir,
          exists: true,
          sizeBytes: stats.totalBytes,
          lastModified: stats.lastModified,
        });
        totalSizeBytes += stats.totalBytes;
      }
    } catch (error) {
      this.logger.error(`Failed to list profiles: ${error}`);
    }

    return {
      profiles,
      rootDir,
      totalSizeBytes,
      checkedAt: new Date().toISOString(),
    };
  }

  getProfile(platform: string, accountId: string): CdpBrowserProfile | null {
    const profileDir = this.getProfileDir(platform, accountId);
    if (!existsSync(profileDir)) {
      return null;
    }
    const stats = this.getDirectoryStats(profileDir);
    return {
      platform,
      accountId,
      profileDir,
      exists: true,
      sizeBytes: stats.totalBytes,
      lastModified: stats.lastModified,
    };
  }

  deleteProfile(
    platform: string,
    accountId: string,
  ): { deleted: boolean; profileDir: string } {
    const profileDir = this.getProfileDir(platform, accountId);
    if (!existsSync(profileDir)) {
      return { deleted: false, profileDir };
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
      this.logger.log(`Deleted profile directory: ${profileDir}`);
      return { deleted: true, profileDir };
    } catch (error) {
      this.logger.error(`Failed to delete profile ${profileDir}: ${error}`);
      return { deleted: false, profileDir };
    }
  }

  private sanitize(value: string): string {
    return (
      String(value || 'default')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '') || 'default'
    );
  }

  private getLegacyProfileDirCandidates(
    platform: string,
    accountId: string,
  ): string[] {
    const legacyProfileRoot = this.getLegacyProfileRootDir();
    if (!legacyProfileRoot) {
      return [];
    }
    const legacyRoots = [legacyProfileRoot];
    const platformType = this.resolveLegacyPlatformType(platform);
    const names = [
      join('interaction', platform, accountId),
      platformType
        ? join(
            'interaction',
            this.resolveLegacyPlatformKey(platformType),
            accountId,
          )
        : null,
      `${platform}-${accountId}`,
      platformType ? `platform-${platformType}-${accountId}` : null,
      platformType ? `platform-${platformType}-default` : null,
      `${platform}-default`,
    ].filter(Boolean) as string[];
    return legacyRoots.flatMap((legacyRoot) =>
      names.map((name) => join(legacyRoot, name)),
    );
  }

  private ensureLegacyLoginCookies(
    profileDir: string,
    platform: string,
    accountId: string,
  ): void {
    const targetCookiesPath = join(profileDir, '.login-cookies.json');
    if (
      existsSync(targetCookiesPath) &&
      this.storageStateMatchesPlatform(
        this.readStorageState(targetCookiesPath),
        platform,
      )
    ) {
      return;
    }

    const legacyCookieSource = this.getLegacyProfileDirCandidates(
      platform,
      accountId,
    )
      .map((candidate) => join(candidate, '.login-cookies.json'))
      .find((candidate) => existsSync(candidate));
    if (!legacyCookieSource) return;

    try {
      const filtered = this.readFilteredStorageState(
        legacyCookieSource,
        platform,
      );
      if (!filtered.cookies.length && !filtered.origins.length) return;

      mkdirSync(dirname(targetCookiesPath), { recursive: true });
      writeFileSync(targetCookiesPath, JSON.stringify(filtered, null, 2));
      this.logger.log(
        `Imported legacy login cookies for ${platform}-${accountId}: ${legacyCookieSource}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to import legacy login cookies for ${platform}-${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async ensureLegacyAccountCookieFile(
    profileDir: string,
    platform: string,
    accountId: string,
    options: {
      refreshExisting?: boolean;
      onlyIfMissing?: boolean;
      preserveExistingPlatformState?: boolean;
    } = {},
  ): Promise<void> {
    const source = await this.resolveLegacyAccountCookiePath(
      platform,
      accountId,
    );
    if (!source || !existsSync(source)) return;

    const targetCookiesPath = join(profileDir, '.login-cookies.json');
    const currentState = existsSync(targetCookiesPath)
      ? this.readStorageState(targetCookiesPath)
      : null;
    const currentMatchesPlatform = currentState
      ? this.storageStateMatchesPlatform(currentState, platform)
      : false;

    if (options.onlyIfMissing && currentMatchesPlatform) {
      return;
    }

    try {
      const filtered = this.readFilteredStorageState(source, platform);
      if (!filtered.cookies.length && !filtered.origins.length) return;

      if (existsSync(targetCookiesPath)) {
        if (options.preserveExistingPlatformState && currentMatchesPlatform) {
          return;
        }
        if (
          !this.isNewer(source, targetCookiesPath) &&
          currentMatchesPlatform
        ) {
          return;
        }
      }

      mkdirSync(dirname(targetCookiesPath), { recursive: true });
      writeFileSync(targetCookiesPath, JSON.stringify(filtered, null, 2));
      this.logger.log(
        `Imported legacy account cookies for ${platform}-${accountId}: ${source}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to import legacy account cookies for ${platform}-${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async resolveLegacyAccountCookiePath(
    platform: string,
    accountId: string,
  ): Promise<string | null> {
    const accountFile = await this.resolveAccountCookieFileName(
      platform,
      accountId,
    );
    if (!accountFile) return null;

    const roots = this.getLegacyAutoUploadRootCandidates();
    for (const root of roots) {
      const candidate = join(root, 'cookiesFile', accountFile);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private async resolveAccountCookieFileName(
    platform: string,
    accountId: string,
  ): Promise<string | null> {
    const numericAccountId = Number(accountId);
    const platformType = this.resolveLegacyPlatformType(platform);
    try {
      const rows = await this.prisma.publishAccount.findMany({
        where: { platform },
        orderBy: { createdAt: 'asc' },
      });
      for (const row of rows) {
        const config = (row.config ?? {}) as {
          engineAccountId?: number | string;
          filePath?: string;
          accountFile?: string;
          platformType?: number;
        };
        const engineId = config.engineAccountId;
        const matchesAccount =
          String(row.id) === accountId ||
          String(engineId ?? '') === accountId ||
          (Number.isFinite(numericAccountId) &&
            Number(engineId) === numericAccountId);
        const matchesPlatform =
          platformType == null || config.platformType == null
            ? true
            : Number(config.platformType) === platformType;
        if (!matchesAccount || !matchesPlatform) continue;
        const fileName = config.filePath || config.accountFile;
        if (fileName) return this.safeBasename(fileName);
      }
    } catch (error) {
      this.logger.warn(
        `Resolve publish account cookie file failed for ${platform}-${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }

  private getLegacyAutoUploadRootCandidates(): string[] {
    const explicitRoot = this.configService.get<string>(
      'LEGACY_AUTO_UPLOAD_ROOT',
    );
    const profileRoot = this.configService.get<string>(
      'LEGACY_AUTO_UPLOAD_BROWSER_PROFILE_ROOT',
    );
    const roots = [
      explicitRoot,
      profileRoot ? join(profileRoot, '..') : null,
      join(process.cwd(), 'backend', 'data'),
      join(homedir(), 'auto-upload'),
    ]
      .filter((value): value is string => Boolean(value))
      .filter((value) => existsSync(value))
      .map((value) => value.replace(/\/+$/, ''));
    return Array.from(new Set(roots));
  }

  private filterStorageStateForPlatform(
    state: { cookies?: unknown; origins?: unknown },
    platform: string,
  ): { cookies: unknown[]; origins: unknown[] } {
    const domains = this.resolvePlatformDomains(platform);
    if (!domains.length) {
      return {
        cookies: Array.isArray(state.cookies) ? state.cookies : [],
        origins: Array.isArray(state.origins) ? state.origins : [],
      };
    }
    const cookies = Array.isArray(state.cookies)
      ? state.cookies.filter((cookie) => {
          if (!cookie || typeof cookie !== 'object') return false;
          const domain = (cookie as { domain?: unknown }).domain;
          return this.domainMatches(String(domain || ''), domains);
        })
      : [];
    const origins = Array.isArray(state.origins)
      ? state.origins.filter((originState) => {
          if (!originState || typeof originState !== 'object') return false;
          const origin = (originState as { origin?: unknown }).origin;
          return this.originMatches(String(origin || ''), domains);
        })
      : [];
    return { cookies, origins };
  }

  private readStorageState(filepath: string): {
    cookies?: unknown;
    origins?: unknown;
  } {
    try {
      return JSON.parse(readFileSync(filepath, 'utf8')) as {
        cookies?: unknown;
        origins?: unknown;
      };
    } catch {
      return {};
    }
  }

  private readFilteredStorageState(
    filepath: string,
    platform: string,
  ): { cookies: unknown[]; origins: unknown[] } {
    return this.filterStorageStateForPlatform(
      this.readStorageState(filepath),
      platform,
    );
  }

  private rewriteLoginCookiesForPlatform(
    profileDir: string,
    platform: string,
  ): void {
    const targetCookiesPath = join(profileDir, '.login-cookies.json');
    if (!existsSync(targetCookiesPath)) return;

    const filtered = this.readFilteredStorageState(targetCookiesPath, platform);
    if (!filtered.cookies.length && !filtered.origins.length) {
      rmSync(targetCookiesPath, { force: true });
      return;
    }
    writeFileSync(targetCookiesPath, JSON.stringify(filtered, null, 2));
  }

  private storageStateMatchesPlatform(
    state: { cookies?: unknown; origins?: unknown },
    platform: string,
  ): boolean {
    const domains = this.resolvePlatformDomains(platform);
    if (!domains.length) return true;

    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const origins = Array.isArray(state.origins) ? state.origins : [];
    if (!cookies.length && !origins.length) return false;

    const hasWrongCookie = cookies.some((cookie) => {
      if (!cookie || typeof cookie !== 'object') return true;
      const domain = (cookie as { domain?: unknown }).domain;
      return !this.domainMatches(String(domain || ''), domains);
    });
    const hasWrongOrigin = origins.some((originState) => {
      if (!originState || typeof originState !== 'object') return true;
      const origin = (originState as { origin?: unknown }).origin;
      return !this.originMatches(String(origin || ''), domains);
    });
    return !hasWrongCookie && !hasWrongOrigin;
  }

  private resolvePlatformDomains(platform: string): string[] {
    const platformType = this.resolveLegacyPlatformType(platform);
    if (platformType === 2)
      return ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'];
    if (platformType === 3)
      return ['douyin.com', 'bytedance.com', 'iesdouyin.com'];
    if (platformType === 4) return ['kuaishou.com'];
    if (platformType === 1) return ['xiaohongshu.com'];
    if (platformType === 5) return ['bilibili.com'];
    return [];
  }

  private domainMatches(value: string, domains: string[]): boolean {
    const normalized = value.toLowerCase().replace(/^\./, '');
    return domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    );
  }

  private originMatches(origin: string, domains: string[]): boolean {
    try {
      const host = new URL(origin).hostname;
      return this.domainMatches(host, domains);
    } catch {
      return this.domainMatches(origin, domains);
    }
  }

  private safeBasename(value: string): string {
    return value.split(/[\\/]/).filter(Boolean).pop() || '';
  }

  private isNewer(source: string, target: string): boolean {
    try {
      return statSync(source).mtimeMs > statSync(target).mtimeMs;
    } catch {
      return true;
    }
  }

  private ensureLegacyProfileSnapshot(
    profileDir: string,
    platform: string,
    accountId: string,
    options: { force?: boolean } = {},
  ): boolean {
    const markerPath = join(profileDir, '.legacy-profile-imported.json');
    const legacyProfileSource = this.getLegacyProfileDirCandidates(
      platform,
      accountId,
    ).find(
      (candidate) =>
        existsSync(candidate) && this.isUsableChromeProfile(candidate),
    );
    if (!legacyProfileSource) return false;
    if (
      !options.force &&
      !this.shouldImportLegacyProfileSnapshot(
        profileDir,
        markerPath,
        legacyProfileSource,
      )
    ) {
      return false;
    }

    try {
      if (existsSync(profileDir)) {
        rmSync(profileDir, { recursive: true, force: true });
      }
      this.copyChromeProfileSnapshot(legacyProfileSource, profileDir);
    } catch (error) {
      this.logger.warn(
        `Failed to import legacy browser profile for ${platform}-${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }

    try {
      copyFileSync(
        join(legacyProfileSource, '.login-cookies.json'),
        join(profileDir, '.login-cookies.json'),
      );
      this.rewriteLoginCookiesForPlatform(profileDir, platform);
    } catch {
      // .login-cookies.json is optional; the browser profile itself is the real login source.
    }

    try {
      const metadata = JSON.stringify(
        {
          importedAt: new Date().toISOString(),
          source: legacyProfileSource,
          platform,
          accountId,
        },
        null,
        2,
      );
      writeFileSync(markerPath, metadata);
      this.logger.log(
        `Imported legacy browser profile for ${platform}-${accountId}: ${legacyProfileSource} -> ${profileDir}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to write legacy profile marker for ${platform}-${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return true;
  }

  private shouldImportLegacyProfileSnapshot(
    profileDir: string,
    markerPath: string,
    legacyProfileSource: string,
  ): boolean {
    if (!existsSync(markerPath) && !this.isUsableChromeProfile(profileDir)) {
      return true;
    }
    if (!existsSync(markerPath)) return false;

    const marker = this.readLegacyProfileMarker(markerPath);
    if (marker?.source && marker.source !== legacyProfileSource) return true;

    const markerTime = marker?.importedAt
      ? Date.parse(marker.importedAt)
      : this.safeMtimeMs(markerPath);
    const legacyTime = this.getDirectoryLastModifiedMs(legacyProfileSource);
    return legacyTime > markerTime;
  }

  private hasImportedLegacyBrowserProfile(profileDir: string): boolean {
    return existsSync(join(profileDir, '.legacy-profile-imported.json'));
  }

  private readLegacyProfileMarker(
    markerPath: string,
  ): { importedAt?: string; source?: string } | null {
    try {
      return JSON.parse(readFileSync(markerPath, 'utf8')) as {
        importedAt?: string;
        source?: string;
      };
    } catch {
      return null;
    }
  }

  private safeMtimeMs(filepath: string): number {
    try {
      return statSync(filepath).mtimeMs;
    } catch {
      return 0;
    }
  }

  private getDirectoryLastModifiedMs(dirPath: string): number {
    let lastModified = 0;
    const walk = (currentPath: string): void => {
      let entries;
      try {
        entries = readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        let stats;
        try {
          stats = statSync(fullPath);
        } catch {
          continue;
        }
        lastModified = Math.max(lastModified, stats.mtimeMs);
        if (entry.isDirectory()) walk(fullPath);
      }
    };
    walk(dirPath);
    return lastModified;
  }

  private copyChromeProfileSnapshot(
    sourceDir: string,
    targetDir: string,
  ): void {
    const skipNames = new Set([
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'BrowserMetrics',
      'Crashpad',
      'ShaderCache',
      'GrShaderCache',
      'GraphiteDawnCache',
      'GPUCache',
      'DawnCache',
      'Code Cache',
      'Cache',
      'blob_storage',
      'optimization_guide_model_store',
      'component_crx_cache',
      'Safe Browsing',
      'Subresource Filter',
      'CertificateRevocation',
      'Default/Cache',
      'Default/Code Cache',
      'Default/GPUCache',
    ]);
    const shouldSkip = (relativePath: string): boolean => {
      const normalized = relativePath.replace(/\\/g, '/');
      const name = normalized.split('/').pop() || normalized;
      return (
        skipNames.has(normalized) ||
        skipNames.has(name) ||
        /^Singleton/.test(name)
      );
    };
    const copyEntry = (relativePath: string): void => {
      if (shouldSkip(relativePath)) return;
      const sourcePath = join(sourceDir, relativePath);
      const targetPath = join(targetDir, relativePath);
      let stats;
      try {
        stats = statSync(sourcePath);
      } catch {
        return;
      }
      if (stats.isDirectory()) {
        mkdirSync(targetPath, { recursive: true });
        for (const entry of readdirSync(sourcePath)) {
          copyEntry(join(relativePath, entry));
        }
        return;
      }
      if (!stats.isFile()) return;
      mkdirSync(join(targetPath, '..'), { recursive: true });
      try {
        copyFileSync(sourcePath, targetPath);
      } catch {
        // Chrome profiles contain transient files; one failed file must not abort the login snapshot.
      }
    };

    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      copyEntry(entry);
    }
  }

  private resolveLegacyPlatformType(platform: string): number | null {
    const normalized = platform.toLowerCase();
    if (normalized === 'wechat-channel' || normalized === 'channel') return 2;
    if (normalized === 'douyin') return 3;
    if (normalized === 'kuaishou') return 4;
    if (normalized === 'xiaohongshu') return 1;
    if (normalized === 'bilibili') return 5;
    return null;
  }

  private resolveLegacyPlatformKey(platformType: number): string {
    if (platformType === 2) return 'wechat-channel';
    if (platformType === 3) return 'douyin';
    if (platformType === 4) return 'kuaishou';
    if (platformType === 1) return 'xiaohongshu';
    if (platformType === 5) return 'bilibili';
    return String(platformType);
  }

  private isUsableChromeProfile(profileDir: string): boolean {
    return (
      existsSync(join(profileDir, 'Local State')) &&
      existsSync(join(profileDir, 'Default', 'Preferences'))
    );
  }

  private getDirectoryStats(dirPath: string): {
    totalBytes: number;
    lastModified: string | null;
  } {
    let totalBytes = 0;
    let lastModified: string | null = null;

    try {
      const walk = (path: string) => {
        const entries = readdirSync(path, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(path, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            try {
              const stats = statSync(fullPath);
              totalBytes += stats.size;
              const mtime = stats.mtime.toISOString();
              if (!lastModified || mtime > lastModified) {
                lastModified = mtime;
              }
            } catch {
              // skip inaccessible files
            }
          }
        }
      };
      walk(dirPath);
    } catch {
      // directory not accessible
    }

    return { totalBytes, lastModified };
  }
}
