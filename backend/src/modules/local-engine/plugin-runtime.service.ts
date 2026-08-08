import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface SkillHubSkillStatus {
  slug: string;
  installed: boolean;
  directory: string;
  requiredCommands: string[];
  missingCommands: string[];
  ready: boolean;
}

export interface PluginRuntimeStatus {
  available: boolean;
  skillDirectory: string | null;
  skillhubDirectory: string | null;
  skillhubSkills: SkillHubSkillStatus[];
  installedSkillCount: number;
  skillNames: string[];
  runtimeApiAvailable: boolean;
  message: string;
}

@Injectable()
export class PluginRuntimeService {
  constructor(private readonly config: ConfigService) {}

  private getRuntimeUrl(): string {
    // 2026-06-04: 8001 (kaypal-runtime) 已下线. 默认 URL 改成空, fail-fast 触发
    // 显式设 KAYPAL_RUNTIME_URL 才会真用; 否则 getStatus 返 unavailable
    return (this.config.get<string>('KAYPAL_RUNTIME_URL') || '').replace(
      /\/$/,
      '',
    );
  }

  private getSkillsDir(): string | null {
    const envDir = this.config.get<string>('KAYPAL_SKILLS_DIR')?.trim();
    if (envDir && existsSync(envDir)) return envDir;
    const defaultDir = '/Users/yanghy/Documents/New project/kaypal-ai/skills';
    if (existsSync(defaultDir)) return defaultDir;
    return null;
  }

  private getSkillHubDir(): string | null {
    const envDir = this.config.get<string>('SKILLHUB_SKILLS_DIR')?.trim();
    if (envDir && existsSync(envDir)) return envDir;
    const defaultDir =
      '/Users/yanghy/Documents/New project/ai-content/skillhub-skills';
    if (existsSync(defaultDir)) return defaultDir;
    return null;
  }

  private commandExists(command: string) {
    const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 300,
    });
    return result.status === 0 && Boolean(result.stdout.trim());
  }

  private getSkillHubSkills(): SkillHubSkillStatus[] {
    const skillhubDir = this.getSkillHubDir();
    const knownSkills = [
      { slug: 'wechat-auto-reply', requiredCommands: ['wechat-auto-reply'] },
      { slug: 'wechat-sender', requiredCommands: ['wechat-moments-publish'] },
      { slug: 'wechat-contact-add', requiredCommands: ['wechat-contact-add'] },
      {
        slug: 'wechat-moments-marketing',
        requiredCommands: ['wechat-moments-marketing'],
      },
      { slug: 'desktop-guardian', requiredCommands: ['hs'] },
      { slug: 'browser-use', requiredCommands: ['browser-use'] },
    ];

    return knownSkills.map((skill) => {
      const directory = skillhubDir ? join(skillhubDir, skill.slug) : '';
      const installed = Boolean(
        skillhubDir && existsSync(join(directory, 'SKILL.md')),
      );
      const missingCommands = skill.requiredCommands.filter(
        (command) => !this.commandExists(command),
      );
      return {
        slug: skill.slug,
        installed,
        directory,
        requiredCommands: skill.requiredCommands,
        missingCommands,
        ready: installed && missingCommands.length === 0,
      };
    });
  }

  async getStatus(): Promise<PluginRuntimeStatus> {
    const skillsDir = this.getSkillsDir();
    const skillhubDir = this.getSkillHubDir();
    const skillhubSkills = this.getSkillHubSkills();
    let installedSkillCount = 0;
    const skillNames: string[] = [];

    if (skillsDir) {
      try {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = join(skillsDir, entry.name, 'SKILL.md');
            if (existsSync(skillMd)) {
              installedSkillCount++;
              skillNames.push(entry.name);
            }
          }
        }
      } catch {
        /* 容错：非关键路径失败忽略 */
      }
    }

    let runtimeApiAvailable = false;
    try {
      const response = await fetch(`${this.getRuntimeUrl()}/skills/health`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      });
      runtimeApiAvailable = response.ok;
    } catch {
      /* 容错：非关键路径失败忽略 */
    }

    const available =
      installedSkillCount > 0 ||
      skillhubSkills.some((skill) => skill.installed) ||
      runtimeApiAvailable;

    return {
      available,
      skillDirectory: skillsDir,
      skillhubDirectory: skillhubDir,
      skillhubSkills,
      installedSkillCount,
      skillNames,
      runtimeApiAvailable,
      message: available
        ? `插件运行时可用：${installedSkillCount} 个本地技能，${skillhubSkills.filter((skill) => skill.installed).length} 个 SkillHub 技能已安装${runtimeApiAvailable ? '，Runtime API 在线' : ''}`
        : '插件运行时不可用：未找到技能目录且 Runtime API 不可用',
    };
  }
}
