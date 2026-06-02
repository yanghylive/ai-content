import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

  constructor(private readonly configService: ConfigService) {}

  getProfileRootDir(): string {
    const engineRoot = this.configService.get<string>(
      'AUTO_UPLOAD_ENGINE_ROOT',
    );
    const baseDir = engineRoot || join(homedir(), 'auto-upload');
    return join(baseDir, 'browser-profiles');
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
    const profileDir = this.getProfileDir(platform, accountId);
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
      this.logger.log(`Created profile directory: ${profileDir}`);
    }
    return profileDir;
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
