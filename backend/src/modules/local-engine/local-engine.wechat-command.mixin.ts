// local-engine 微信桌面命令簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 WechatCommandHost 接口：
// getMacWechatCommandRoot（contact 簇）、normalizeReplyGeneratedBy（customer-service 簇）。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { InteractionReplyGeneratedBy } from './local-engine.types';
import {
  WechatDesktopCommandError,
  type WechatDesktopCommandResult,
} from './local-engine.wechat-command.utils';
import { optionalTrimmedText } from './local-engine.utils';

/** wechat 桌面命令簇的 host 接口：跨块访问的 service 成员 */
export interface WechatCommandHost {
  getMacWechatCommandRoot(): string;
  normalizeReplyGeneratedBy(
    value: unknown,
  ): InteractionReplyGeneratedBy | undefined;
  runWechatDesktopCommand(
    command:
      | 'wechat-auto-reply'
      | 'wechat-contact-add'
      | 'wechat-live-auto-reply'
      | 'wechat-moments-publish'
      | 'wechat-moments-marketing',
    args: string[],
    target: string,
    timeoutMs?: number,
  ): Promise<WechatDesktopCommandResult>;
  parseWechatDesktopCommandOutput(
    output: string,
    command: string,
  ): WechatDesktopCommandResult;
  toWechatDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult;
}

export function runWechatContactCommand(
  this: WechatCommandHost,
  command: 'wechat-auto-reply' | 'wechat-contact-add',
  target: string,
  message: string,
  mode: 'auto-send' | 'approval',
  options?: {
    remarkStrategy?: string;
    remarkContent?: string;
    attachmentPaths?: string[];
  },
): Promise<{ screenshotPath?: string }> {
  const extraArgs =
    command === 'wechat-contact-add'
      ? [options?.remarkStrategy || 'none', options?.remarkContent || '']
      : [options?.attachmentPaths?.join('\n') || ''];
  return this.runWechatDesktopCommand(
    command,
    [target, message, mode, ...extraArgs],
    target,
  );
}

export function runWechatDesktopCommand(
  this: WechatCommandHost,
  command:
    | 'wechat-auto-reply'
    | 'wechat-contact-add'
    | 'wechat-live-auto-reply'
    | 'wechat-moments-publish'
    | 'wechat-moments-marketing',
  args: string[],
  target: string,
  timeoutMs = 90000,
): Promise<WechatDesktopCommandResult> {
  return new Promise((resolve, reject) => {
    const configuredRoot = this.getMacWechatCommandRoot();
    const resolvedCommand =
      [
        configuredRoot ? join(configuredRoot, command) : '',
        join(homedir(), '.local', 'bin', command),
        join('/opt/homebrew/bin', command),
        join('/usr/local/bin', command),
      ].find((candidate) => candidate && existsSync(candidate)) || command;
    const child = spawn(resolvedCommand, args, {
      env: {
        ...process.env,
        AI_CONTENT_CLICLICK_PATH:
          process.env.AI_CONTENT_CLICLICK_PATH ||
          (configuredRoot ? join(configuredRoot, 'cliclick') : ''),
        AI_CONTENT_NODE_PATH:
          process.env.AI_CONTENT_NODE_PATH || process.execPath,
        PATH: [
          configuredRoot,
          process.env.PATH || '',
          join(homedir(), '.local', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
        ]
          .filter(Boolean)
          .join(':'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 执行超时：${target}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const output = stdout.trim();
        if (!output) {
          resolve({});
          return;
        }
        try {
          resolve(this.parseWechatDesktopCommandOutput(output, command));
        } catch (error) {
          if (error instanceof SyntaxError) {
            resolve({});
          } else if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error(String(error || '未知错误')));
          }
        }
        return;
      }
      reject(
        new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()),
      );
    });
  });
}

export function parseWechatDesktopCommandOutput(
  this: WechatCommandHost,
  output: string,
  command: string,
): WechatDesktopCommandResult {
  const parsed = JSON.parse(output) as Record<string, unknown>;
  const ok = parsed.ok;
  const status = (optionalTrimmedText(parsed.status || '') || '').toLowerCase();
  if (
    ok === false ||
    [
      'failed',
      'error',
      'blocked',
      'captcha_required',
      'risk_blocked',
      'send_failed',
      'draft_not_ready',
      'not_ready',
      'no_target',
    ].includes(status)
  ) {
    const message =
      optionalTrimmedText(parsed.error) ||
      optionalTrimmedText(parsed.message) ||
      optionalTrimmedText(parsed.reason) ||
      `${command} 返回失败`;
    throw new WechatDesktopCommandError(
      message,
      this.toWechatDesktopCommandResult(parsed),
    );
  }
  return this.toWechatDesktopCommandResult(parsed);
}

export function toWechatDesktopCommandResult(
  this: WechatCommandHost,
  parsed: Record<string, unknown>,
): WechatDesktopCommandResult {
  return {
    screenshotPath: optionalTrimmedText(
      parsed.screenshotPath ?? parsed.screenshot_path,
    ),
    reply: optionalTrimmedText(parsed.reply),
    readText: optionalTrimmedText(parsed.readText ?? parsed.read_text),
    sourceText: optionalTrimmedText(parsed.sourceText ?? parsed.source_text),
    generatedBy: this.normalizeReplyGeneratedBy(
      parsed.generatedBy ??
        parsed.generated_by ??
        parsed.replyGeneratedBy ??
        parsed.reply_generated_by,
    ),
    message: optionalTrimmedText(parsed.message),
    contact: optionalTrimmedText(parsed.contact),
    target: optionalTrimmedText(parsed.target),
    currentWechatId: optionalTrimmedText(
      parsed.currentWechatId ?? parsed.current_wechat_id,
    ),
    plannedWechatId: optionalTrimmedText(
      parsed.plannedWechatId ?? parsed.planned_wechat_id,
    ),
    mode: optionalTrimmedText(parsed.mode),
    status: optionalTrimmedText(parsed.status),
    errorCode: optionalTrimmedText(parsed.errorCode ?? parsed.error_code),
    nextAction: optionalTrimmedText(parsed.nextAction ?? parsed.next_action),
  };
}

export const wechatCommandMethods = {
  runWechatContactCommand,
  runWechatDesktopCommand,
  parseWechatDesktopCommandOutput,
  toWechatDesktopCommandResult,
};
