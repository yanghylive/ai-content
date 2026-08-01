import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { chromium } from 'playwright';

export type PlaywrightBrowserRuntimeSource =
  | 'explicit'
  | 'bundled'
  | 'playwright-cache'
  | 'system-fallback';

export type PlaywrightBrowserRuntimeInfo = {
  executablePath: string;
  source: PlaywrightBrowserRuntimeSource;
  exists: boolean;
  message: string;
};

@Injectable()
export class PlaywrightBrowserRuntimeService {
  constructor(private readonly config: ConfigService) {}

  resolve(): PlaywrightBrowserRuntimeInfo {
    const explicit = this.config.get<string>('LOCAL_BROWSER_CHROME_PATH');
    if (explicit) {
      return this.info(explicit, 'explicit');
    }

    for (const root of this.browserRoots()) {
      const executable = this.findChromiumExecutable(root);
      if (executable) {
        return this.info(executable, 'bundled');
      }
    }

    try {
      const executable = chromium.executablePath();
      if (executable && existsSync(executable)) {
        return this.info(executable, 'playwright-cache');
      }
    } catch {
      // Playwright may throw when browsers are not installed. Continue to guarded fallback.
    }

    if (this.config.get<string>('KAYPAL_ALLOW_SYSTEM_CHROME') === '1') {
      const executable = this.findSystemChromeExecutable();
      if (executable) {
        return this.info(executable, 'system-fallback');
      }
    }

    const fallback = this.expectedBundledPath();
    return {
      executablePath: fallback,
      source: 'bundled',
      exists: false,
      message: `内置 Playwright Chromium 未找到：${fallback}`,
    };
  }

  private info(
    executablePath: string,
    source: PlaywrightBrowserRuntimeSource,
  ): PlaywrightBrowserRuntimeInfo {
    return {
      executablePath,
      source,
      exists: existsSync(executablePath),
      message: `${source} Playwright Chromium: ${executablePath}`,
    };
  }

  private browserRoots(): string[] {
    const configured = [
      this.config.get<string>('KAYPAL_PLAYWRIGHT_BROWSERS_PATH'),
      this.config.get<string>('PLAYWRIGHT_BROWSERS_PATH'),
      this.config.get<string>('LOCAL_PLAYWRIGHT_BROWSERS_PATH'),
      process.env.KAYPAL_PLAYWRIGHT_BROWSERS_PATH,
      process.env.PLAYWRIGHT_BROWSERS_PATH,
    ].filter(Boolean) as string[];

    return Array.from(
      new Set(
        [
          ...configured,
          join(process.cwd(), 'playwright-browsers'),
          join(process.cwd(), '..', 'playwright-browsers'),
        ].map((item) => resolve(item)),
      ),
    );
  }

  private expectedBundledPath(): string {
    const root =
      this.browserRoots()[0] || join(process.cwd(), 'playwright-browsers');
    return this.executableCandidates(root)[0] || root;
  }

  private findChromiumExecutable(root: string): string | null {
    if (!root || !existsSync(root)) return null;
    for (const candidate of this.executableCandidates(root)) {
      if (existsSync(candidate)) return candidate;
    }

    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(current, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (
          this.isExecutableFileName(entry) &&
          this.looksLikeChromiumPath(fullPath)
        ) {
          return fullPath;
        }
      }
    }

    return null;
  }

  private executableCandidates(root: string): string[] {
    if (process.platform === 'win32') {
      return [
        join(root, 'chromium', 'chrome-win', 'chrome.exe'),
        join(root, 'chrome-win', 'chrome.exe'),
        join(root, 'chrome.exe'),
      ];
    }

    if (process.platform === 'darwin') {
      return [
        join(
          root,
          'chromium',
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        ),
        join(
          root,
          'chromium',
          'chrome-mac',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        ),
        join(
          root,
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        ),
        join(
          root,
          'chrome-mac',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        ),
      ];
    }

    return [
      join(root, 'chromium', 'chrome-linux', 'chrome'),
      join(root, 'chrome-linux', 'chrome'),
      join(root, 'chrome'),
    ];
  }

  private isExecutableFileName(fileName: string): boolean {
    if (process.platform === 'win32') return fileName === 'chrome.exe';
    return fileName === 'chrome' || fileName === 'Google Chrome for Testing';
  }

  private looksLikeChromiumPath(filePath: string): boolean {
    return /chromium|chrome-(win|mac|linux)|Chrome for Testing/i.test(filePath);
  }

  private findSystemChromeExecutable(): string | null {
    const candidates =
      process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : process.platform === 'win32'
          ? [
              'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            ]
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/chromium-browser',
              '/usr/bin/chromium',
            ];

    return candidates.find((candidate) => existsSync(candidate)) || null;
  }
}
