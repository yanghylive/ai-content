#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CONTRACT_VERSION = '2026-06-26.wechat-native-v1';
const RUNNER_NAME = 'kaypal-wechat-native-uia-runner';
const RUNNER_VERSION = '0.3.0';
const COMMANDS = new Set([
  'group-broadcast',
  'contact-add',
  'friend-accept',
  'moments-publish',
  'moments-marketing',
  'chat-history',
  'auto-reply',
]);

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function uniqueText(values) {
  return [...new Set(values.map(compactText).filter(Boolean))];
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function isDryRunContext(context) {
  const safety = asRecord(context.safety);
  return Boolean(safety.dryRun) || booleanValue(process.env.AI_CONTENT_WECHAT_DRY_RUN);
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || '').trim() || '{}');
  } catch (error) {
    return {
      ...fallback,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function emit(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(exitCode);
}

function fail(command, errorCode, message, extra = {}, exitCode = 2) {
  emit(
    {
      ok: false,
      contractVersion: CONTRACT_VERSION,
      command,
      runner: RUNNER_NAME,
      runnerVersion: RUNNER_VERSION,
      status: extra.status || 'blocked',
      errorCode,
      error: message,
      message,
      nextAction: extra.nextAction || '请检查微信窗口、权限、输入内容和 runner 诊断后重试。',
      output: extra.output || emptyOutput(command),
      diagnostics: {
        command,
        runner: RUNNER_NAME,
        runnerVersion: RUNNER_VERSION,
        stage: extra.stage || `${command}-runner-blocked`,
        warnings: uniqueText(extra.warnings || []),
        ...(extra.diagnostics || {}),
      },
      raw: {
        realWechatActionAttempted: false,
        ...(extra.raw || {}),
      },
    },
    exitCode,
  );
}

function emptyOutput(command) {
  if (command === 'chat-history') {
    return {
      source: 'empty',
      sessions: [],
      messages: [],
      count: 0,
      syncedAt: new Date().toISOString(),
    };
  }
  if (command === 'moments-publish') {
    return {
      status: 'blocked',
      contentText: '',
      assetPaths: [],
      evidence: [],
      readback: { matched: false, actualText: '' },
    };
  }
  return {
    summary: {
      total: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
    },
    results: [],
  };
}

function targetName(target, index) {
  const record = asRecord(target);
  return compactText(
    record.displayName ||
      record.remark ||
      record.nickname ||
      record.targetName ||
      record.searchText ||
      record.wxid ||
      record.id ||
      (typeof target === 'string' ? target : '') ||
      `target-${index + 1}`,
  );
}

function targetSelector(target) {
  const record = asRecord(target);
  return compactText(
    record.searchText ||
      record.wxid ||
      record.id ||
      record.displayName ||
      record.remark ||
      record.nickname ||
      record.targetName ||
      (typeof target === 'string' ? target : ''),
  );
}

function commandTargets(command, input) {
  if (command === 'group-broadcast' || command === 'contact-add') {
    return Array.isArray(input.targets) ? input.targets : [];
  }
  if (command === 'moments-marketing') {
    if (Array.isArray(input.targets)) return input.targets;
    if (Array.isArray(input.contacts)) return input.contacts;
  }
  return [];
}

function assetPathsFromInput(command, input) {
  if (command === 'group-broadcast') {
    const message = asRecord(input.message);
    return (Array.isArray(message.attachments) ? message.attachments : [])
      .map((asset) => compactText(asRecord(asset).path || asset))
      .filter(Boolean);
  }
  if (command === 'moments-publish') {
    const content = asRecord(input.content);
    return (Array.isArray(content.assets) ? content.assets : [])
      .map((asset) => compactText(asRecord(asset).path || asset))
      .filter(Boolean);
  }
  return [];
}

function buildPlan(command, input, context) {
  const safety = asRecord(context.safety);
  const sendMode = compactText(safety.sendMode || 'approval');
  const dryRun = isDryRunContext(context);
  if (command === 'group-broadcast') {
    const targets = commandTargets(command, input);
    const text = compactText(asRecord(input.message).text);
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const messageByTarget = new Map();
    for (const item of messages) {
      const record = asRecord(item);
      const targetKey = compactText(record.targetId || record.targetName);
      if (!targetKey) continue;
      messageByTarget.set(targetKey, {
        text: compactText(asRecord(record.message).text),
        assets: (Array.isArray(asRecord(record.message).attachments)
          ? asRecord(record.message).attachments
          : [])
          .map((asset) => compactText(asRecord(asset).path || asset))
          .filter(Boolean),
      });
    }
    return {
      command,
      sendMode,
      dryRun,
      targets: targets.map((target, index) => {
        const id = compactText(asRecord(target).id || asRecord(target).wxid);
        const name = targetName(target, index);
        const personalized = messageByTarget.get(id) || messageByTarget.get(name) || {};
        return {
          id,
          name,
          selector: targetSelector(target),
          searchText: compactText(asRecord(target).searchText) || name,
          text: compactText(personalized.text) || text,
          assets: personalized.assets && personalized.assets.length
            ? personalized.assets
            : assetPathsFromInput(command, input),
        };
      }),
      text,
      assets: assetPathsFromInput(command, input),
      expectedText: text,
    };
  }
  if (command === 'contact-add') {
    const targets = commandTargets(command, input);
    const verifyMessage = compactText(input.verifyMessage);
    return {
      command,
      sendMode,
      dryRun,
      targets: targets.map((target, index) => ({
        id: compactText(asRecord(target).id || asRecord(target).wxid),
        name: targetName(target, index),
        selector: targetSelector(target),
        searchText:
          compactText(asRecord(target).searchText) ||
          targetName(target, index),
        verifyMessage: compactText(asRecord(target).verifyMessage) || verifyMessage,
      })),
      verifyMessage,
      remark: asRecord(input.remark),
      tags: Array.isArray(input.tags) ? input.tags.map(compactText).filter(Boolean) : [],
      expectedText: verifyMessage,
    };
  }
  if (command === 'friend-accept') {
    return {
      command,
      sendMode,
      dryRun,
      remark: {
        strategy: compactText(asRecord(input.remark).strategy || 'request_name'),
        value: compactText(asRecord(input.remark).value),
      },
      welcomeMessage: compactText(input.welcomeMessage),
      matchKeywords: uniqueText(Array.isArray(input.matchKeywords) ? input.matchKeywords : []),
      dailyLimit: boundedInteger(input.dailyLimit, 20, 1, 100),
      expectedText: compactText(input.welcomeMessage),
    };
  }
  if (command === 'moments-publish') {
    const content = asRecord(input.content);
    return {
      command,
      sendMode,
      dryRun,
      text: compactText(content.text),
      assets: assetPathsFromInput(command, input),
      firstComment: compactText(content.firstComment),
      expectedText: compactText(content.text),
    };
  }
  if (command === 'moments-marketing') {
    const targets = commandTargets(command, input);
    const actions = asRecord(input.actions);
    const comment = asRecord(input.comment);
    const rawBrowseLimit = input.browseLimit === undefined ? targets.length || 1 : input.browseLimit;
    return {
      command,
      sendMode,
      dryRun,
      mode: compactText(input.mode || 'random'),
      actions: {
        browse: actions.browse !== false,
        like: actions.like === true,
        comment: actions.comment === true,
      },
      targets: targets.map((target, index) => ({
        id: compactText(asRecord(target).id),
        name: targetName(asRecord(target).contact || target, index),
        selector: targetSelector(asRecord(target).contact || target),
        searchText:
          compactText(asRecord(asRecord(target).contact).searchText) ||
          targetName(asRecord(target).contact || target, index),
        ordinal: Number(asRecord(target).ordinal || index + 1) || index + 1,
        momentText: compactText(asRecord(target).momentText),
      })),
      browseLimitRaw: rawBrowseLimit,
      browseLimit: boundedInteger(rawBrowseLimit, 1, 1, 100),
      comment: {
        mode: compactText(comment.mode || 'none'),
        fixedText: compactText(comment.fixedText),
        targetComments: Array.isArray(comment.targetComments)
          ? comment.targetComments.map((item) => asRecord(item))
          : [],
      },
      expectedText: compactText(comment.fixedText),
    };
  }
  if (command === 'auto-reply') {
    const targetRecord = asRecord(input.target);
    const targetNameValue =
      compactText(targetRecord.displayName || targetRecord.name) ||
      compactText(input.targetName);
    const replyText = compactText(input.replyText);
    return {
      command,
      sendMode,
      dryRun,
      action: compactText(input.action || (replyText ? 'send' : 'read-latest')),
      target: {
        id: compactText(targetRecord.id || targetRecord.wxid),
        name: targetNameValue,
        selector: targetSelector(targetRecord),
        searchText: compactText(targetRecord.searchText) || targetNameValue,
      },
      replyText,
      sourceText: compactText(input.sourceText),
      expectedText: replyText,
    };
  }
  return {
    command,
    dryRun,
    action: compactText(input.action || 'sync'),
    sessionId: compactText(input.sessionId),
    limitRaw: input.limit === undefined ? 100 : input.limit,
    limit: boundedInteger(input.limit === undefined ? 100 : input.limit, Number.NaN, 1, 500),
  };
}

function validatePlan(command, plan) {
  if (command === 'group-broadcast') {
    if (!plan.targets.length) return ['target_missing', '缺少群发目标。'];
    if (plan.targets.some((target) => !target.selector)) return ['target_missing', '群发目标缺少可搜索的微信号、昵称、备注或展示名。'];
    if (plan.targets.some((target) => !target.text && !target.assets.length)) {
      return ['content_invalid', '每个群发目标都必须有专属消息或附件。'];
    }
    const missing = uniqueText(plan.targets.flatMap((target) => target.assets)).filter((item) => !fs.existsSync(item));
    if (missing.length) return ['media_missing', `群发附件不存在：${missing.join('；')}`];
  }
  if (command === 'contact-add') {
    if (!plan.targets.length) return ['target_missing', '缺少加好友目标。'];
    if (plan.targets.some((target) => !target.selector)) return ['target_missing', '加好友目标缺少可搜索的微信号、昵称、备注或展示名。'];
    if (plan.targets.some((target) => !target.verifyMessage)) return ['content_invalid', '缺少好友验证消息。'];
  }
  if (command === 'friend-accept') {
    if (!plan.matchKeywords.length) {
      return ['content_invalid', '自动通过好友必须配置明确的测试申请筛选关键词。'];
    }
    if (!['request_name', 'phone_wechat', 'manual'].includes(plan.remark.strategy)) {
      return ['content_invalid', '通过好友备注策略不受支持。'];
    }
  }
  if (command === 'moments-publish') {
    if (!plan.text && !plan.assets.length) return ['content_invalid', '朋友圈文案和素材不能同时为空。'];
    const missing = plan.assets.filter((item) => !fs.existsSync(item));
    if (missing.length) return ['media_missing', `朋友圈素材不存在：${missing.join('；')}`];
  }
  if (command === 'moments-marketing') {
    const browseLimitNumber = Number(plan.browseLimitRaw);
    if (!Number.isFinite(browseLimitNumber) || browseLimitNumber < 1 || browseLimitNumber > 100) {
      return ['content_invalid', '朋友圈营销 browseLimit 必须是 1-100 之间的数字。'];
    }
    if (!plan.actions.browse && !plan.actions.like && !plan.actions.comment) {
      return ['content_invalid', '朋友圈营销至少要选择浏览、点赞或评论之一。'];
    }
    if (plan.targets.some((target) => !target.selector)) return ['target_missing', '朋友圈营销目标缺少可搜索的微信号、昵称、备注或展示名。'];
    if (plan.actions.comment && !plan.comment.fixedText) {
      return ['content_invalid', '当前 Windows runner 需要固定评论内容 fixedText，不能发送空评论。'];
    }
  }
  if (command === 'chat-history') {
    const limitNumber = Number(plan.limitRaw);
    if (!['sync', 'sessions', 'messages', 'visible'].includes(plan.action)) {
      return ['content_invalid', '会话历史 action 仅支持 sync、sessions、messages 或 visible。'];
    }
    if (plan.action === 'messages' && !plan.sessionId) {
      return ['target_missing', '读取指定会话消息时缺少 sessionId。'];
    }
    if (!Number.isFinite(limitNumber) || limitNumber < 1 || limitNumber > 500) {
      return ['content_invalid', '会话历史 limit 必须是 1-500 之间的数字。'];
    }
  }
  if (command === 'auto-reply') {
    if (!plan.target || !plan.target.searchText) {
      return ['target_missing', '自动回复缺少目标会话（搜索关键字）。'];
    }
    if (plan.action === 'send' && !plan.replyText) {
      return ['content_invalid', '自动回复发送模式缺少回复内容 replyText。'];
    }
    if (!['read-latest', 'draft', 'send'].includes(plan.action)) {
      return ['content_invalid', '自动回复 action 仅支持 read-latest、draft 或 send。'];
    }
  }
  return null;
}

function dryRunEvidence(label, value) {
  return {
    type: 'text',
    label,
    value: compactText(value),
    trusted: true,
    createdAt: new Date().toISOString(),
  };
}

function dryRunTargets(plan) {
  if (plan.command === 'friend-accept') {
    return [{ name: '新的好友申请扫描', id: 'friend-request-scan', selector: '新的朋友' }];
  }
  if (plan.command === 'moments-marketing' && !plan.targets.length) {
    return Array.from({ length: plan.browseLimit }, (_, index) => ({
      name: `朋友圈第 ${index + 1} 条`,
      id: '',
      selector: '',
    }));
  }
  return plan.targets || [];
}

function dryRunOutput(command, plan) {
  const now = new Date().toISOString();
  if (command === 'chat-history') {
    return {
      source: 'dry-run',
      sessions: [],
      messages: [],
      sessionId: plan.sessionId,
      count: 0,
      syncedAt: now,
      evidence: [dryRunEvidence('dry-run-plan', `${plan.action}:${plan.sessionId || 'visible'}`)],
      readback: {
        expectedText: plan.sessionId || plan.action,
        actualText: '',
        matched: false,
        capturedAt: now,
      },
    };
  }
  if (command === 'moments-publish') {
    return {
      status: 'dry_run',
      contentText: plan.text,
      assetPaths: plan.assets,
      evidence: [
        dryRunEvidence('dry-run-plan', `朋友圈发布：${plan.text || `${plan.assets.length} 个素材`}`),
      ],
      readback: {
        expectedText: plan.text,
        actualText: '',
        matched: false,
        capturedAt: now,
      },
    };
  }
  if (command === 'auto-reply') {
    return {
      ok: true,
      status: 'skipped',
      readText: '',
      sourceText: plan.sourceText || '',
      replyText: plan.replyText,
      targetName: plan.target?.name || plan.target?.searchText || '',
      sent: false,
      drafted: false,
      screenshotPath: '',
      message: `dry-run 自动回复：${plan.action} → ${plan.target?.searchText || ''}`,
      evidence: [dryRunEvidence('dry-run-plan', `${plan.action}:${plan.target?.searchText || ''}`)],
      readback: {
        expectedText: plan.replyText,
        actualText: '',
        matched: false,
        capturedAt: now,
      },
    };
  }
  const targets = dryRunTargets(plan);
  const results = targets.map((target, index) => ({
    targetId: compactText(target.id || target.selector),
    targetName: target.name || `target-${index + 1}`,
    ok: true,
    status: 'skipped',
    action: command === 'contact-add'
      ? 'add-contact'
      : command === 'friend-accept'
        ? 'accept-friend'
        : command === 'moments-marketing'
          ? 'moments-marketing'
          : 'send',
    message: 'dry-run 仅校验输入和生成执行计划，没有触碰微信窗口。',
    evidence: [
      dryRunEvidence('dry-run-plan', `${command}:${target.name || `target-${index + 1}`}`),
      dryRunEvidence('send-mode', plan.sendMode),
    ],
    readback: {
      expectedText: compactText(target.text) || plan.expectedText || '',
      actualText: '',
      matched: false,
      targetName: target.name || `target-${index + 1}`,
      capturedAt: now,
    },
    raw: {
      dryRun: true,
      realWechatActionAttempted: false,
    },
  }));
  return {
    summary: {
      total: results.length,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      skipped: results.length,
    },
    results,
  };
}

function emitDryRun(command, plan, envelope) {
  emit({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    command,
    runner: RUNNER_NAME,
    runnerVersion: RUNNER_VERSION,
    status: 'skipped',
    errorCode: 'success',
    message: 'dry-run 已完成输入校验和执行计划生成，未执行真实微信动作。',
    nextAction: '可在 Windows 真机取消 dry-run 后执行；真实成功仍必须返回读回和证据字段。',
    output: dryRunOutput(command, plan),
    diagnostics: {
      command,
      runner: RUNNER_NAME,
      runnerVersion: RUNNER_VERSION,
      stage: `${command}-runner-dry-run`,
      plan,
      requestRunId: compactText(asRecord(asRecord(envelope).context).runId),
      raw: {
        dryRun: true,
        realWechatActionAttempted: false,
      },
      warnings: [],
    },
    raw: {
      dryRun: true,
      realWechatActionAttempted: false,
    },
  }, 0);
}

function writeWindowsPowerShellScript(scriptPath, scriptText) {
  // Windows PowerShell 5.1 treats UTF-8 without BOM as the local ANSI codepage.
  // The runner contains Chinese risk words and diagnostics, so write UTF-16LE
  // with BOM to keep parsing stable on Windows 10/11.
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(String(scriptText || '').replace(/\n/g, '\r\n'), 'utf16le');
  fs.writeFileSync(scriptPath, Buffer.concat([bom, body]));
}

function runPowerShell(plan, envelope) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaypal-wechat-runner-'));
  const payloadPath = path.join(tempRoot, 'payload.json');
  const scriptPath = path.join(tempRoot, 'runner.ps1');
  fs.writeFileSync(
    payloadPath,
    JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      runner: RUNNER_NAME,
      runnerVersion: RUNNER_VERSION,
      plan,
      envelope,
    }),
    'utf8',
  );
  writeWindowsPowerShellScript(scriptPath, POWERSHELL_RUNNER);
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-PayloadPath',
        payloadPath,
      ],
      {
        encoding: 'utf8',
        timeout: Number(asRecord(envelope.context).timeoutMs) || 180000,
        windowsHide: true,
      },
    );
    const json = parseLastJson(result.stdout);
    if (!json) {
      return {
        ok: false,
        command: plan.command,
        status: result.error && result.error.code === 'ETIMEDOUT' ? 'failed' : 'blocked',
        errorCode: result.error && result.error.code === 'ETIMEDOUT' ? 'timeout' : 'runtime_unavailable',
        error: compactText(result.stderr || result.stdout || (result.error && result.error.message) || 'PowerShell runner 没有输出 JSON。'),
        nextAction: '检查 Windows PowerShell、微信窗口和自动化权限。',
        output: emptyOutput(plan.command),
        diagnostics: {
          command: plan.command,
          runner: RUNNER_NAME,
          runnerVersion: RUNNER_VERSION,
          stage: `${plan.command}-powershell-no-json`,
          stderrTail: String(result.stderr || '').slice(-2000),
          stdoutTail: String(result.stdout || '').slice(-2000),
        },
        raw: { realWechatActionAttempted: false },
      };
    }
    return json;
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

function parseLastJson(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // keep looking
    }
  }
  return null;
}

function main(defaultCommand) {
  const argvCommand = COMMANDS.has(process.argv[2]) ? process.argv[2] : '';
  const command = argvCommand || defaultCommand;
  if (!COMMANDS.has(command)) {
    fail(command || 'unknown', 'unknown', `未知微信 runner 命令：${command || '<empty>'}`, {}, 64);
  }

  const raw = readStdin();
  const envelope = parseJson(raw, { command });
  if (envelope.parseError) {
    fail(command, 'content_invalid', `runner 请求 JSON 解析失败：${envelope.parseError}`);
  }
  const input = asRecord(envelope.input);
  const context = asRecord(envelope.context);
  const plan = buildPlan(command, input, context);
  const validation = validatePlan(command, plan);
  if (validation) {
    fail(command, validation[0], validation[1], {
      stage: `${command}-runner-input-blocked`,
      diagnostics: { plan },
    });
  }
  if (plan.dryRun) {
    emitDryRun(command, plan, envelope);
  }
  if (command === 'friend-accept' && plan.sendMode !== 'auto-send') {
    fail(
      command,
      'approval_required',
      '通过好友是不可草稿化的真实写入动作，确认前不会点击任何好友申请。',
      {
        nextAction: '仅对明确的测试好友申请确认自动执行后重试。',
        stage: 'friend-accept-approval-blocked',
        diagnostics: { plan },
      },
    );
  }
  if (process.platform !== 'win32') {
    fail(command, 'unsupported_platform', 'Kaypal 微信真实 runner 只能在 Windows 10/11 桌面微信环境执行。', {
      nextAction: '请在 Windows 真机或 Windows 模拟器内运行安装包并打开桌面微信。',
      stage: `${command}-runner-platform-blocked`,
      diagnostics: { platform: process.platform, plan },
    });
  }

  const result = runPowerShell(plan, envelope);
  emit(result, result.ok === true ? 0 : 2);
}

const POWERSHELL_RUNNER = String.raw`
param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Read-Payload {
  $json = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8
  return $json | ConvertFrom-Json
}

$payload = Read-Payload
$contractVersion = [string]$payload.contractVersion
$plan = $payload.plan
$command = [string]$plan.command
$runner = [string]$payload.runner
$runnerVersion = [string]$payload.runnerVersion
$script:RealWechatActionAttempted = $false
$script:InitialWindowText = ""

function To-JsonLine($value, [int]$exitCode = 0) {
  $dict = $value -as [System.Collections.IDictionary]
  if ($null -ne $dict) {
    if (-not $dict.Contains("contractVersion")) { $dict["contractVersion"] = $contractVersion }
    if (-not $dict.Contains("runner")) { $dict["runner"] = $runner }
    if (-not $dict.Contains("runnerVersion")) { $dict["runnerVersion"] = $runnerVersion }
    if (-not $dict.Contains("completedAt")) { $dict["completedAt"] = (Get-Date).ToUniversalTime().ToString("o") }
  }
  $json = $value | ConvertTo-Json -Depth 32 -Compress
  [Console]::Out.WriteLine($json)
  exit $exitCode
}

function New-EmptyOutput {
  param([string]$Command)
  if ($Command -eq "chat-history") {
    return [ordered]@{ source = "empty"; sessions = @(); messages = @(); count = 0; syncedAt = (Get-Date).ToUniversalTime().ToString("o") }
  }
  if ($Command -eq "moments-publish") {
    return [ordered]@{ status = "blocked"; contentText = ""; assetPaths = @(); evidence = @(); readback = @{ matched = $false; actualText = "" } }
  }
  if ($Command -eq "auto-reply") {
    return [ordered]@{ ok = $false; status = "blocked"; readText = ""; sourceText = ""; replyText = ""; sent = $false; drafted = $false; readback = @{ matched = $false; actualText = "" } }
  }
  return [ordered]@{ summary = @{ total = 0; succeeded = 0; failed = 0; blocked = 0; skipped = 0 }; results = @() }
}

function New-Failure {
  param(
    [string]$ErrorCode,
    [string]$Message,
    [string]$Stage,
    [string]$Status = "blocked",
    [bool]$Attempted = $false,
    [object]$Output = $null,
    [object]$Diagnostics = @{},
    [string]$NextAction = ""
	  )
	  if ($null -eq $Output) { $Output = New-EmptyOutput $command }
  if ([string]::IsNullOrWhiteSpace($NextAction)) {
    $NextAction = "请检查微信窗口、权限、风控提示和 runner 诊断。"
  }
	  return [ordered]@{
	    ok = $false
	    contractVersion = $contractVersion
	    command = $command
	    runner = $runner
	    runnerVersion = $runnerVersion
    status = $Status
    errorCode = $ErrorCode
    error = $Message
    message = $Message
    nextAction = $NextAction
    output = $Output
    diagnostics = [ordered]@{
      command = $command
      runner = $runner
      runnerVersion = $runnerVersion
      stage = $Stage
      raw = $Diagnostics
    }
	    raw = @{ realWechatActionAttempted = ($Attempted -or $script:RealWechatActionAttempted) }
	  }
	}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $nativeWin32Source = @'
using System;
using System.Runtime.InteropServices;
public class NativeWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
}
'@
  Add-Type -TypeDefinition $nativeWin32Source -Language CSharp
} catch {
  To-JsonLine (New-Failure "permission_missing" ("Windows UIAutomation 初始化失败：" + $_.Exception.Message) ($command + "-uia-init-failed")) 2
}

function Get-WeChatProcess {
  $items = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ProcessName -match "^(WeChat|Weixin|微信)$" -or $_.MainWindowTitle -match "微信|WeChat") -and $_.MainWindowHandle -ne 0
  } | Sort-Object @{Expression={if ($_.ProcessName -match "^(WeChat|Weixin|微信)$") { 2 } elseif ($_.ProcessName -match "^WeChatAppEx$") { 0 } else { 1 }}; Descending=$true}, @{Expression={$_.MainWindowTitle -match "微信|WeChat"}; Descending=$true}, Id
  return $items | Select-Object -First 1
}

function Get-AnyWeChatProcess {
  $items = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match "^(WeChat|Weixin|微信)$" -or $_.MainWindowTitle -match "微信|WeChat"
  } | Sort-Object @{Expression={if ($_.ProcessName -match "^(WeChat|Weixin|微信)$") { 2 } elseif ($_.ProcessName -match "^WeChatAppEx$") { 0 } else { 1 }}; Descending=$true}, @{Expression={$_.MainWindowHandle -ne 0}; Descending=$true}, Id
  return $items | Select-Object -First 1
}

function Activate-WeChat {
  $proc = Get-WeChatProcess
  if ($null -eq $proc) {
    $anyProc = Get-AnyWeChatProcess
    if ($null -ne $anyProc) {
      throw ("微信进程存在，但当前执行器拿不到可控主窗口；请确认 Kaypal、本地助手和微信运行在同一个 Windows 桌面用户会话，并避免服务会话、管理员/非管理员混合会话。进程=" + $anyProc.ProcessName + "#" + $anyProc.Id)
    }
    throw "没有找到正在运行的 Windows 桌面微信主窗口。"
  }
  [NativeWin32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 150
  [NativeWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 450
  $element = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  if ($null -eq $element) {
    throw "微信窗口 UIAutomation 句柄不可读。"
  }
  return @{ process = $proc; element = $element }
}

function Get-ElementText {
  param([System.Windows.Automation.AutomationElement]$Element, [int]$Limit = 1500)
  $values = New-Object System.Collections.Generic.List[string]
  try {
    $nodes = $Element.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    $max = [Math]::Min($nodes.Count, $Limit)
    for ($i = 0; $i -lt $max; $i++) {
      $node = $nodes.Item($i)
      try {
        $name = [string]$node.Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) { $values.Add($name.Trim()) }
      } catch {}
      try {
        $value = $node.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty, $true)
        if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) { $values.Add($value.Trim()) }
      } catch {}
    }
  } catch {}
  return (($values | Select-Object -Unique) -join [Environment]::NewLine)
}

function Save-WindowScreenshot {
  param([System.Windows.Automation.AutomationElement]$Element)
  $dir = Join-Path $env:TEMP "kaypal-wechat-runner-evidence"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir ("wechat-" + $command + "-" + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + ".png")
  try {
    $rect = $Element.Current.BoundingRectangle
    $width = [Math]::Max(100, [int]$rect.Width)
    $height = [Math]::Max(100, [int]$rect.Height)
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, $bmp.Size)
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
    return $file
  } catch {
    return ""
  }
}

function Get-FileSha256 {
  param([string]$Path)
  try {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return "" }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  } catch {
    return ""
  }
}

function Invoke-ClipboardAction {
  param([scriptblock]$Action, [string]$Label = "剪贴板操作")
  $lastError = ""
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    try {
      & $Action
      return
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds (120 + ($attempt * 90))
    }
  }
  throw ($Label + "失败：" + $lastError)
}

function Send-KeyText {
  param([string]$Text)
  Invoke-ClipboardAction -Label "写入剪贴板" -Action {
    [System.Windows.Forms.Clipboard]::SetText($Text)
  }
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 260
}

function Send-KeyCombo {
  param([string]$Keys, [int]$Delay = 300)
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $Delay
}

function Find-FirstElementByName {
  param([System.Windows.Automation.AutomationElement]$Element, [string[]]$Names)
  try {
    $nodes = $Element.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $nodes.Count; $i++) {
      $node = $nodes.Item($i)
      $name = ""
      try { $name = [string]$node.Current.Name } catch {}
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($wanted in $Names) {
        if ($name -like ("*" + $wanted + "*")) { return $node }
      }
    }
  } catch {}
  return $null
}

function Find-AllElementsByName {
  param([System.Windows.Automation.AutomationElement]$Element, [string[]]$Names)
  $matches = @()
  try {
    $nodes = $Element.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $nodes.Count; $i++) {
      $node = $nodes.Item($i)
      $name = ""
      try { $name = [string]$node.Current.Name } catch {}
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($wanted in $Names) {
        if ($name -eq $wanted -or $name -like ($wanted + " *")) {
          $matches += $node
          break
        }
      }
    }
  } catch {}
  return @($matches)
}

function Get-ElementContextText {
  param([System.Windows.Automation.AutomationElement]$Element)
  $current = $Element
  for ($depth = 0; $depth -lt 4 -and $null -ne $current; $depth++) {
    $text = Get-ElementText $current 120
    if (-not [string]::IsNullOrWhiteSpace($text) -and ([regex]::Split($text, "\r?\n")).Count -gt 1) {
      return $text
    }
    try {
      $current = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($current)
    } catch {
      $current = $null
    }
  }
  return ""
}

function Get-FriendRequestTargetName {
  param([string]$Text, [int]$Index)
  $ignored = @("接受", "通过", "新的朋友", "朋友验证", "添加好友", "已接受")
  foreach ($line in @([regex]::Split($Text, "\r?\n"))) {
    $candidate = [string]$line
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    $candidate = $candidate.Trim()
    if ($ignored -contains $candidate) { continue }
    if ($candidate.Length -gt 80) { continue }
    return $candidate
  }
  return ("好友申请-" + ($Index + 1))
}

function Test-FriendRequestKeywords {
  param([string]$Text)
  if (@($plan.matchKeywords).Count -eq 0) { return $false }
  foreach ($keyword in @($plan.matchKeywords)) {
    if ($Text -like ("*" + [string]$keyword + "*")) { return $true }
  }
  return $false
}

function Click-Element {
  param([System.Windows.Automation.AutomationElement]$Element)
  if ($null -eq $Element) { return $false }
  try {
    $invoke = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
      $invoke.Invoke()
      Start-Sleep -Milliseconds 500
      return $true
    }
  } catch {}
  try {
    $rect = $Element.Current.BoundingRectangle
    if ($rect.Width -gt 1 -and $rect.Height -gt 1) {
      $x = [int]($rect.X + $rect.Width / 2)
      $y = [int]($rect.Y + $rect.Height / 2)
      [NativeWin32]::SetCursorPos($x, $y) | Out-Null
      [NativeWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [NativeWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 500
      return $true
    }
  } catch {}
  return $false
}

function Detect-RiskText {
  param([string]$Text)
  foreach ($word in @("验证码", "频繁", "风险", "账号异常", "账号限制", "操作过快", "安全验证", "稍后再试", "无法发送", "发送失败", "被限制", "登录过期")) {
    if ($Text -like ("*" + $word + "*")) { return ("微信出现" + $word + "提示，已停止。") }
  }
  return ""
}

function Get-WeChatFailureProfile {
  param([string]$Message, [string]$Text = "", [bool]$Attempted = $false)
  $combined = (($Message + [Environment]::NewLine + $Text) -replace "\s+", " ")
  if ($combined -match "扫码登录|二维码|登录微信|请在手机上确认|手机确认登录|切换账号|更多登录选项") {
    return [ordered]@{
      code = "wechat_not_logged_in"
      status = "blocked"
      nextAction = "微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。"
      layer = "wechat-session"
    }
  }
  if ($combined -match "进程存在.*拿不到可控主窗口|同一个.*桌面用户会话|服务会话|管理员/非管理员混合会话|not interact with the desktop") {
    return [ordered]@{
      code = "permission_missing"
      status = "blocked"
      nextAction = "微信进程存在，但当前执行器拿不到可控窗口；请确认 Kaypal、本地助手和微信运行在同一个 Windows 桌面用户会话，并保持微信主窗口可见。"
      layer = "permission"
    }
  }
  if ($combined -match "没有找到.*微信.*主窗口|未找到.*微信.*主窗口|WeChat.*not.*running|Weixin.*not.*running") {
    return [ordered]@{
      code = "wechat_not_running"
      status = "blocked"
      nextAction = "请先启动并登录 Windows 桌面微信，保持主窗口可见后重试。"
      layer = "wechat-window"
    }
  }
  if ($combined -match "UIAutomation|UIA|权限|句柄不可读|Access is denied|拒绝访问|administrator|管理员|not interact with the desktop") {
    return [ordered]@{
      code = "permission_missing"
      status = "blocked"
      nextAction = "请确认 Kaypal、本地助手和微信运行在同一个 Windows 桌面用户会话，并授予自动化/屏幕读取权限；不要用服务会话启动微信。"
      layer = "permission"
    }
  }
  if ($combined -match "验证码|频繁|风险|账号异常|账号限制|操作过快|安全验证|稍后再试|无法发送|发送失败|被限制|登录过期") {
    return [ordered]@{
      code = "risk_prompt_detected"
      status = "blocked"
      nextAction = "微信出现风控或安全提示，已停止执行；请先处理微信提示，降低频率后再试。"
      layer = "wechat-risk"
    }
  }
  if ($combined -match "未找到朋友圈入口|未找到添加好友按钮|未找到评论按钮|未找到.*按钮|搜索结果不是|目标可能已是联系人|not-wechat|不是通讯录|不是微信") {
    return [ordered]@{
      code = "target_not_found"
      status = "blocked"
      nextAction = "当前微信窗口或目标页面不符合任务要求；请把微信切到正确页面、确认目标可搜索后重试。"
      layer = "target"
    }
  }
  if ($combined -match "没有读回|读回不到|未读回|readback|文件名.*拒绝标记成功|没有读到可用") {
    return [ordered]@{
      code = "readback_failed"
      status = "failed"
      nextAction = "动作已尝试但结果没有读回确认；请打开失败证据截图确认是否真的发送/写入，再决定重试。"
      layer = "readback"
    }
  }
  if ($combined -match "timeout|timed out|超时") {
    return [ordered]@{
      code = "timeout"
      status = "failed"
      nextAction = "微信响应超时；请确认窗口未卡死、网络正常，再重试。"
      layer = "timeout"
    }
  }
  return [ordered]@{
    code = $(if ($Attempted) { "send_failed" } else { "runtime_unavailable" })
    status = $(if ($Attempted) { "failed" } else { "blocked" })
    nextAction = "请导出诊断，查看截图、UIA 文本和 runner 原始错误后排查。"
    layer = "unknown"
  }
}

function Search-WeChat {
  param([string]$Text)
  Send-KeyCombo "^f" 250
  Send-KeyText $Text
  Start-Sleep -Milliseconds 650
  Send-KeyCombo "{ENTER}" 800
}

function New-Readback {
  param([string]$Expected, [string]$Actual, [string]$Target = "")
  $matched = $false
  if ([string]::IsNullOrWhiteSpace($Expected)) {
    $matched = -not [string]::IsNullOrWhiteSpace($Actual)
  } else {
    $matched = $Actual -like ("*" + $Expected + "*")
  }
  return [ordered]@{
    expectedText = $Expected
    actualText = $(if ($Actual.Length -gt 4000) { $Actual.Substring(0, 4000) } else { $Actual })
    matched = $matched
    targetName = $Target
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function New-Evidence {
  param([string]$Label, [string]$Value)
  return [ordered]@{ type = "text"; label = $Label; value = $Value; trusted = $true; createdAt = (Get-Date).ToUniversalTime().ToString("o") }
}

function New-ScreenshotEvidence {
  param([string]$Label, [string]$Path, [object]$Window = $null)
  $processId = ""
  $title = ""
  $rectInfo = @{}
  try {
    if ($null -ne $Window) {
      $processId = [string]$Window.process.Id
      $title = [string]$Window.process.MainWindowTitle
      $rect = $Window.element.Current.BoundingRectangle
      $rectInfo = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
    }
  } catch {}
  return [ordered]@{
    type = "desktop_screenshot"
    label = $Label
    path = $Path
    sha256 = (Get-FileSha256 $Path)
    trusted = $true
    processId = $processId
    windowTitle = $title
    rect = $rectInfo
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function New-ReadbackEvidence {
  param([string]$Label, [object]$Readback)
  return [ordered]@{
    type = "readback_text"
    label = $Label
    matched = [bool]$Readback.matched
    expectedText = [string]$Readback.expectedText
    actualText = [string]$Readback.actualText
    targetName = [string]$Readback.targetName
    trusted = $true
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function New-StageEvidence {
  param([string]$Stage, [string]$Message)
  return [ordered]@{ type = "stage_log"; label = $Stage; value = $Message; trusted = $true; createdAt = (Get-Date).ToUniversalTime().ToString("o") }
}

function Assert-AssetReadback {
  param([string[]]$Paths, [string]$Actual, [string]$Target = "")
  if ($Paths.Count -eq 0) {
    return [ordered]@{ matched = $true; actualText = ""; expectedFiles = @(); matchedFiles = @(); targetName = $Target; capturedAt = (Get-Date).ToUniversalTime().ToString("o") }
  }
  $expectedNames = @($Paths | ForEach-Object { [System.IO.Path]::GetFileName([string]$_) } | Where-Object { $_ })
  $matchedNames = @()
  foreach ($name in $expectedNames) {
    if ($Actual -like ("*" + $name + "*")) { $matchedNames += $name }
  }
  return [ordered]@{
    matched = ($expectedNames.Count -gt 0 -and $matchedNames.Count -eq $expectedNames.Count)
    expectedFiles = $expectedNames
    matchedFiles = $matchedNames
    actualText = $(if ($Actual.Length -gt 4000) { $Actual.Substring(0, 4000) } else { $Actual })
    targetName = $Target
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function Invoke-GroupBroadcast {
  param($Window)
  $results = @()
  $succeeded = 0
  $failed = 0
  $blocked = 0
  $attempted = $false
  foreach ($target in @($plan.targets)) {
    $targetName = [string]$target.name
    $targetText = [string]$target.text
    $targetAssets = @($target.assets)
    try {
      Search-WeChat ([string]$target.searchText)
      if ($targetAssets.Count -gt 0) {
        Set-ClipboardFiles $targetAssets
        Send-KeyCombo "^v" 1200
      }
      if (-not [string]::IsNullOrWhiteSpace($targetText)) {
        Send-KeyText $targetText
      }
      $attempted = $true
      $script:RealWechatActionAttempted = $true
      if ([string]$plan.sendMode -eq "auto-send") { Send-KeyCombo "{ENTER}" 900 }
      $text = Get-ElementText $Window.element
      $risk = Detect-RiskText $text
      if ($risk) { throw $risk }
      $readback = New-Readback $targetText $text $targetName
      $assetReadback = Assert-AssetReadback $targetAssets $text $targetName
      if (-not $readback.matched -and -not [string]::IsNullOrWhiteSpace($targetText)) { throw "群发后没有读回到该对象的专属内容或聊天记录。" }
      if ($targetAssets.Count -gt 0 -and -not $assetReadback.matched) { throw "群发附件没有读回到文件名，已拒绝标记成功。" }
      $targetScreenshot = Save-WindowScreenshot $Window.element
      $succeeded += 1
      $results += [ordered]@{
        targetId = [string]$target.id
        targetName = $targetName
        ok = $true
        status = "success"
        action = $(if ([string]$plan.sendMode -eq "auto-send") { "send" } else { "draft" })
        message = $(if ([string]$plan.sendMode -eq "auto-send") { "群发内容已发送并读回。" } else { "群发内容已写入草稿并读回。" })
        sentText = $targetText
        screenshotPath = $targetScreenshot
        readback = $readback
        assetReadback = $assetReadback
        evidence = @(
          (New-StageEvidence "wechat-group-broadcast" ("target=" + $targetName + "; mode=" + [string]$plan.sendMode))
          (New-Evidence "wechat-window-readback" $targetName)
          (New-ReadbackEvidence "wechat-window-readback" $readback)
          (New-Evidence "wechat-asset-readback" (($assetReadback.expectedFiles) -join ", "))
          (New-ScreenshotEvidence "wechat-group-broadcast-screenshot" $targetScreenshot $Window)
        )
      }
    } catch {
      $failureProfile = Get-WeChatFailureProfile $_.Exception.Message (Get-ElementText $Window.element) $attempted
      if ($failureProfile.status -eq "blocked") { $blocked += 1 } else { $failed += 1 }
      $failureScreenshot = Save-WindowScreenshot $Window.element
      $results += [ordered]@{
        targetName = $targetName
        ok = $false
        status = $failureProfile.status
        errorCode = $failureProfile.code
        message = $_.Exception.Message
        screenshotPath = $failureScreenshot
        readback = New-Readback $targetText (Get-ElementText $Window.element) $targetName
        evidence = @(
          (New-Evidence "wechat-runner-failure" $failureScreenshot)
          (New-ScreenshotEvidence "wechat-runner-failure-screenshot" $failureScreenshot $Window)
          (New-StageEvidence "wechat-failure-classification" ([string]$failureProfile.code))
        )
      }
    }
  }
  $screenshot = Save-WindowScreenshot $Window.element
  return [ordered]@{
    ok = ($succeeded -gt 0 -and $failed -eq 0)
    command = $command
    status = $(if ($succeeded -gt 0 -and $failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($succeeded -gt 0) { "partial" } elseif ($blocked -gt 0 -and $failed -eq 0) { "blocked" } else { "failed" })
    errorCode = $(if ($failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($blocked -gt 0 -and $failed -eq 0) { "target_not_found" } else { "send_failed" })
    message = "微信群发 runner 完成。"
    screenshotPath = $screenshot
    output = [ordered]@{ summary = @{ total = @($plan.targets).Count; succeeded = $succeeded; failed = $failed; blocked = $blocked; skipped = 0 }; results = $results; readback = $(if ($results.Count -gt 0) { $results[0].readback } else { @{ matched = $false } }) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "group-broadcast-uia-completed"; screenshotPath = $screenshot; batch = @{ requestedTargets = @($plan.targets).Count; attemptedTargets = $succeeded + $failed + $blocked; succeededTargets = $succeeded; failedTargets = $failed; blockedTargets = $blocked } }
    raw = @{ realWechatActionAttempted = $attempted }
  }
}

function Invoke-FriendAccept {
  param($Window)
  $results = @()
  $succeeded = 0
  $failed = 0
  $blocked = 0
  $skipped = 0
  $attempted = $false

  $contactsButton = Find-FirstElementByName $Window.element @("通讯录", "Contacts")
  if ($null -ne $contactsButton) { Click-Element $contactsButton | Out-Null }
  Start-Sleep -Milliseconds 500
  $newFriendsButton = Find-FirstElementByName $Window.element @("新的朋友", "New Friends", "朋友验证")
  if ($null -eq $newFriendsButton) { throw "未找到新的朋友入口，请先打开微信通讯录。" }
  Click-Element $newFriendsButton | Out-Null
  Start-Sleep -Milliseconds 800

  $acceptButtons = @(Find-AllElementsByName $Window.element @("接受", "通过"))
  $limit = [Math]::Min([int]$plan.dailyLimit, $acceptButtons.Count)
  for ($index = 0; $index -lt $limit; $index++) {
    $button = $acceptButtons[$index]
    $contextText = Get-ElementContextText $button
    $targetName = Get-FriendRequestTargetName $contextText $index
    if (-not (Test-FriendRequestKeywords $contextText)) {
      $skipped += 1
      $results += [ordered]@{
        targetName = $targetName
        ok = $false
        status = "skipped"
        errorCode = "keyword_not_matched"
        action = "skip"
        message = "好友申请未命中筛选关键词，已跳过。"
        readback = New-Readback $targetName $contextText $targetName
        evidence = @((New-StageEvidence "wechat-friend-accept-skipped" ("target=" + $targetName)))
      }
      continue
    }
    try {
      $attempted = $true
      $script:RealWechatActionAttempted = $true
      if (-not (Click-Element $button)) { throw "好友申请接受按钮不可点击。" }
      Start-Sleep -Milliseconds 650
      $confirm = Find-FirstElementByName $Window.element @("完成", "确定", "确认")
      if ($null -ne $confirm) { Click-Element $confirm | Out-Null }
      Start-Sleep -Milliseconds 450
      if (-not [string]::IsNullOrWhiteSpace([string]$plan.welcomeMessage)) {
        Search-WeChat $targetName
        Send-KeyText ([string]$plan.welcomeMessage)
        if ([string]$plan.sendMode -eq "auto-send") { Send-KeyCombo "{ENTER}" 700 }
      }
      $after = Get-ElementText $Window.element
      $risk = Detect-RiskText $after
      if ($risk) { throw $risk }
      $expected = $(if (-not [string]::IsNullOrWhiteSpace([string]$plan.welcomeMessage)) { [string]$plan.welcomeMessage } else { $targetName })
      $readback = New-Readback $expected $after $targetName
      if (-not $readback.matched) { throw "通过好友后没有读回到目标或欢迎语。" }
      $targetScreenshot = Save-WindowScreenshot $Window.element
      $succeeded += 1
      $results += [ordered]@{
        targetName = $targetName
        ok = $true
        status = "success"
        action = "accept-friend"
        message = $(if ([string]::IsNullOrWhiteSpace([string]$plan.welcomeMessage)) { "好友申请已通过并读回。" } else { "好友申请已通过，欢迎语已处理并读回。" })
        screenshotPath = $targetScreenshot
        readback = $readback
        evidence = @(
          (New-StageEvidence "wechat-friend-accept" ("target=" + $targetName + "; mode=" + [string]$plan.sendMode))
          (New-ReadbackEvidence "wechat-friend-accept-readback" $readback)
          (New-ScreenshotEvidence "wechat-friend-accept-screenshot" $targetScreenshot $Window)
        )
      }
    } catch {
      $failureProfile = Get-WeChatFailureProfile $_.Exception.Message (Get-ElementText $Window.element) $attempted
      if ($failureProfile.status -eq "blocked") { $blocked += 1 } else { $failed += 1 }
      $failureScreenshot = Save-WindowScreenshot $Window.element
      $results += [ordered]@{
        targetName = $targetName
        ok = $false
        status = $failureProfile.status
        errorCode = $failureProfile.code
        action = "accept-friend"
        message = $_.Exception.Message
        screenshotPath = $failureScreenshot
        readback = New-Readback $targetName (Get-ElementText $Window.element) $targetName
        evidence = @(
          (New-Evidence "wechat-runner-failure" $failureScreenshot)
          (New-ScreenshotEvidence "wechat-runner-failure-screenshot" $failureScreenshot $Window)
          (New-StageEvidence "wechat-failure-classification" ([string]$failureProfile.code))
        )
      }
    }
  }

  $screenshot = Save-WindowScreenshot $Window.element
  $noRequests = ($acceptButtons.Count -eq 0)
  return [ordered]@{
    ok = ($failed -eq 0 -and $blocked -eq 0)
    command = $command
    status = $(if ($noRequests) { "success" } elseif ($succeeded -gt 0 -and $failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($succeeded -gt 0) { "partial" } elseif ($blocked -gt 0 -and $failed -eq 0) { "blocked" } else { "failed" })
    errorCode = $(if ($noRequests -or ($failed -eq 0 -and $blocked -eq 0)) { "success" } elseif ($blocked -gt 0 -and $failed -eq 0) { "target_not_found" } else { "send_failed" })
    message = $(if ($noRequests) { "当前没有待处理的好友申请。" } else { "自动通过好友 runner 完成。" })
    screenshotPath = $screenshot
    output = [ordered]@{ summary = @{ total = $acceptButtons.Count; succeeded = $succeeded; failed = $failed; blocked = $blocked; skipped = $skipped }; results = $results; noTarget = $noRequests; readback = $(if ($results.Count -gt 0) { $results[0].readback } else { @{ matched = $true; actualText = "当前没有待处理的好友申请。" } }) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "friend-accept-uia-completed"; screenshotPath = $screenshot; batch = @{ requestedTargets = $acceptButtons.Count; attemptedTargets = $succeeded + $failed + $blocked; succeededTargets = $succeeded; failedTargets = $failed; blockedTargets = $blocked; skippedTargets = $skipped } }
    raw = @{ realWechatActionAttempted = $attempted }
  }
}

function Invoke-ContactAdd {
  param($Window)
  $results = @()
  $succeeded = 0
  $failed = 0
  $blocked = 0
  $attempted = $false
  foreach ($target in @($plan.targets)) {
    $targetName = [string]$target.name
    try {
      Search-WeChat ([string]$target.searchText)
      $text = Get-ElementText $Window.element
      $button = Find-FirstElementByName $Window.element @("添加到通讯录", "添加朋友", "发送好友申请", "添加")
      if ($null -eq $button) { throw "未找到添加好友按钮，目标可能已是联系人或搜索结果不是个人资料页。" }
      Click-Element $button | Out-Null
      Start-Sleep -Milliseconds 800
      Send-KeyText ([string]$target.verifyMessage)
      $attempted = $true
      $script:RealWechatActionAttempted = $true
      if ([string]$plan.sendMode -eq "auto-send") {
        $send = Find-FirstElementByName $Window.element @("发送", "确定")
        if ($null -ne $send) { Click-Element $send | Out-Null } else { Send-KeyCombo "{ENTER}" 800 }
      }
      $after = Get-ElementText $Window.element
      $risk = Detect-RiskText $after
      if ($risk) { throw $risk }
      $readback = New-Readback ([string]$target.verifyMessage) $after $targetName
      if (-not $readback.matched -and [string]$plan.sendMode -ne "auto-send") { throw "好友申请页没有读回验证消息。" }
      $succeeded += 1
      $results += [ordered]@{
        targetName = $targetName
        ok = $true
        status = "success"
        action = $(if ([string]$plan.sendMode -eq "auto-send") { "send" } else { "draft" })
        message = "加好友动作已执行并完成读回。"
        readback = $readback
        evidence = @(
          (New-StageEvidence "wechat-contact-add" ("target=" + $targetName + "; mode=" + [string]$plan.sendMode))
          (New-Evidence "wechat-contact-add" $targetName)
          (New-ReadbackEvidence "wechat-contact-add-readback" $readback)
        )
      }
    } catch {
      $failureProfile = Get-WeChatFailureProfile $_.Exception.Message (Get-ElementText $Window.element) $attempted
      if ($failureProfile.status -eq "blocked") { $blocked += 1 } else { $failed += 1 }
      $failureScreenshot = Save-WindowScreenshot $Window.element
      $results += [ordered]@{
        targetName = $targetName
        ok = $false
        status = $failureProfile.status
        errorCode = $failureProfile.code
        message = $_.Exception.Message
        screenshotPath = $failureScreenshot
        readback = New-Readback ([string]$target.verifyMessage) (Get-ElementText $Window.element) $targetName
        evidence = @(
          (New-Evidence "wechat-runner-failure" $failureScreenshot)
          (New-ScreenshotEvidence "wechat-runner-failure-screenshot" $failureScreenshot $Window)
          (New-StageEvidence "wechat-failure-classification" ([string]$failureProfile.code))
        )
      }
    }
  }
  $screenshot = Save-WindowScreenshot $Window.element
  return [ordered]@{
    ok = ($succeeded -gt 0 -and $failed -eq 0)
    command = $command
    status = $(if ($succeeded -gt 0 -and $failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($succeeded -gt 0) { "partial" } elseif ($blocked -gt 0 -and $failed -eq 0) { "blocked" } else { "failed" })
    errorCode = $(if ($failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($blocked -gt 0 -and $failed -eq 0) { "target_not_found" } else { "send_failed" })
    message = "加好友 runner 完成。"
    screenshotPath = $screenshot
    output = [ordered]@{ summary = @{ total = @($plan.targets).Count; succeeded = $succeeded; failed = $failed; blocked = $blocked; skipped = 0 }; results = $results; readback = $(if ($results.Count -gt 0) { $results[0].readback } else { @{ matched = $false } }) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "contact-add-uia-completed"; screenshotPath = $screenshot; batch = @{ requestedTargets = @($plan.targets).Count; attemptedTargets = $succeeded + $failed + $blocked; succeededTargets = $succeeded; failedTargets = $failed; blockedTargets = $blocked } }
    raw = @{ realWechatActionAttempted = $attempted }
  }
}

function Set-ClipboardFiles {
  param([string[]]$Paths)
  $collection = New-Object System.Collections.Specialized.StringCollection
  foreach ($item in $Paths) { [void]$collection.Add($item) }
  Invoke-ClipboardAction -Label "写入剪贴板文件" -Action {
    [System.Windows.Forms.Clipboard]::SetFileDropList($collection)
  }
}

function Open-MomentsWindow {
  param($Window)
  $button = Find-FirstElementByName $Window.element @("朋友圈")
  if ($null -ne $button) {
    Click-Element $button | Out-Null
    Start-Sleep -Milliseconds 1000
    return $true
  }
  return $false
}

function Invoke-MomentsPublish {
  param($Window)
  $attempted = $false
  if (-not (Open-MomentsWindow $Window)) { throw "未找到朋友圈入口，请先把微信切到可见主窗口。" }
  $textBefore = Get-ElementText $Window.element
  $openEditor = Find-FirstElementByName $Window.element @("发表", "相机", "拍照", "从手机相册选择")
  if ($null -ne $openEditor) { Click-Element $openEditor | Out-Null; Start-Sleep -Milliseconds 800 }
  if ($plan.assets.Count -gt 0) {
    Set-ClipboardFiles @($plan.assets)
    Send-KeyCombo "^v" 1200
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$plan.text)) {
    Send-KeyText ([string]$plan.text)
  }
  $attempted = $true
  $script:RealWechatActionAttempted = $true
  if ([string]$plan.sendMode -eq "auto-send") {
    $send = Find-FirstElementByName $Window.element @("发表", "发布", "发送")
    if ($null -eq $send) { throw "未找到朋友圈发表按钮。" }
    Click-Element $send | Out-Null
    Start-Sleep -Milliseconds 1300
  }
  $after = Get-ElementText $Window.element
  $risk = Detect-RiskText $after
  if ($risk) { throw $risk }
  $readback = New-Readback ([string]$plan.text) ($textBefore + [Environment]::NewLine + $after) "朋友圈"
  if (-not $readback.matched -and -not [string]::IsNullOrWhiteSpace([string]$plan.text)) { throw "朋友圈编辑器没有读回文案。" }
  $screenshot = Save-WindowScreenshot $Window.element
  return [ordered]@{
    ok = $true
    command = $command
    status = "success"
    errorCode = "success"
    message = $(if ([string]$plan.sendMode -eq "auto-send") { "朋友圈已发布并读回。" } else { "朋友圈内容已写入草稿并读回。" })
    screenshotPath = $screenshot
    output = [ordered]@{ status = $(if ([string]$plan.sendMode -eq "auto-send") { "published" } else { "draft_filled" }); contentText = [string]$plan.text; assetPaths = @($plan.assets); evidence = @((New-StageEvidence "wechat-moments-publish" ("mode=" + [string]$plan.sendMode)); (New-Evidence "wechat-moments-publish" ([string]$plan.text)); (New-ReadbackEvidence "wechat-moments-publish-readback" $readback); (New-ScreenshotEvidence "wechat-moments-publish-screenshot" $screenshot $Window)); readback = $readback }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "moments-publish-uia-completed"; screenshotPath = $screenshot; momentsPublish = @{ assetCount = @($plan.assets).Count; assetPaths = @($plan.assets); publishButtonDetected = $true; publishResultDetected = $readback.matched } }
    raw = @{ realWechatActionAttempted = $attempted }
  }
}

function Invoke-MomentsMarketing {
  param($Window)
  $attempted = $false
  if (-not (Open-MomentsWindow $Window)) { throw "未找到朋友圈入口，请先把微信切到可见主窗口。" }
  $results = @()
  $limit = [int]$plan.browseLimit
  for ($i = 1; $i -le $limit; $i++) {
    Send-KeyCombo "{PGDN}" 500
    $attempted = $true
    $script:RealWechatActionAttempted = $true
    $text = Get-ElementText $Window.element
    $targetName = "朋友圈第 $i 条"
    try {
      if ($plan.actions.like) {
        $like = Find-FirstElementByName $Window.element @("赞", "点赞", "Like")
        if ($null -ne $like) { Click-Element $like | Out-Null }
      }
      if ($plan.actions.comment) {
        $commentButton = Find-FirstElementByName $Window.element @("评论", "Comment")
        if ($null -eq $commentButton) { throw "未找到评论按钮。" }
        Click-Element $commentButton | Out-Null
        Start-Sleep -Milliseconds 300
        Send-KeyText ([string]$plan.comment.fixedText)
        if ([string]$plan.sendMode -eq "auto-send") { Send-KeyCombo "{ENTER}" 700 }
      }
      $after = Get-ElementText $Window.element
      $risk = Detect-RiskText $after
      if ($risk) { throw $risk }
      $expected = $(if ($plan.actions.comment) { [string]$plan.comment.fixedText } else { $targetName })
      $readback = New-Readback $expected ($text + [Environment]::NewLine + $after) $targetName
      if ($plan.actions.comment -and -not $readback.matched) { throw "朋友圈评论后没有读回评论内容。" }
      $results += [ordered]@{ targetName = $targetName; ok = $true; status = "success"; action = "moments-marketing"; message = "朋友圈营销动作已执行。"; readback = $readback; evidence = @((New-Evidence "wechat-moments-marketing" $targetName)) }
    } catch {
      $failureProfile = Get-WeChatFailureProfile $_.Exception.Message (Get-ElementText $Window.element) $attempted
      $failureScreenshot = Save-WindowScreenshot $Window.element
      $results += [ordered]@{ targetName = $targetName; ok = $false; status = $failureProfile.status; errorCode = $failureProfile.code; message = $_.Exception.Message; screenshotPath = $failureScreenshot; readback = New-Readback ([string]$plan.comment.fixedText) (Get-ElementText $Window.element) $targetName; evidence = @((New-Evidence "wechat-runner-failure" $failureScreenshot); (New-ScreenshotEvidence "wechat-runner-failure-screenshot" $failureScreenshot $Window); (New-StageEvidence "wechat-failure-classification" ([string]$failureProfile.code))) }
    }
  }
  $succeeded = @($results | Where-Object { $_.ok -eq $true }).Count
  $blocked = @($results | Where-Object { $_.status -eq "blocked" }).Count
  $failed = @($results | Where-Object { $_.ok -ne $true -and $_.status -ne "blocked" }).Count
  $screenshot = Save-WindowScreenshot $Window.element
  return [ordered]@{
    ok = ($succeeded -gt 0 -and $failed -eq 0)
    command = $command
    status = $(if ($succeeded -gt 0 -and $failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($succeeded -gt 0) { "partial" } elseif ($blocked -gt 0 -and $failed -eq 0) { "blocked" } else { "failed" })
    errorCode = $(if ($failed -eq 0 -and $blocked -eq 0) { "success" } elseif ($blocked -gt 0 -and $failed -eq 0) { "target_not_found" } else { "send_failed" })
    message = "朋友圈营销 runner 完成。"
    screenshotPath = $screenshot
    output = [ordered]@{ summary = @{ total = $limit; succeeded = $succeeded; failed = $failed; blocked = $blocked; skipped = 0 }; results = $results; readback = $(if ($results.Count -gt 0) { $results[0].readback } else { @{ matched = $false } }) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "moments-marketing-uia-completed"; screenshotPath = $screenshot; batch = @{ requestedTargets = $limit; attemptedTargets = $results.Count; succeededTargets = $succeeded; failedTargets = $failed; blockedTargets = $blocked } }
    raw = @{ realWechatActionAttempted = $attempted }
  }
}

function Invoke-ChatHistory {
  param($Window)
  $text = Get-ElementText $Window.element 2500
  $screenshot = Save-WindowScreenshot $Window.element
  $lines = @($text -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_.Length -ge 2 } | Select-Object -First ([int]$plan.limit))
  if ($lines.Count -eq 0) {
    return New-Failure "readback_failed" "未从当前微信窗口读到可用会话或消息文本。" "chat-history-uia-empty" "blocked" $false (New-EmptyOutput "chat-history") @{ screenshotPath = $screenshot }
  }
  $sessionId = $(if ([string]::IsNullOrWhiteSpace([string]$plan.sessionId)) { "visible-wechat-session-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() } else { [string]$plan.sessionId })
  $session = [ordered]@{ id = $sessionId; title = $lines[0]; contactName = $lines[0]; unreadCount = 0; lastMessage = $lines[-1]; source = "windows-wechat-uia"; updatedAt = (Get-Date).ToUniversalTime().ToString("o") }
  $messages = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $messages += [ordered]@{ id = ($sessionId + "-" + ($i + 1)); sessionId = $sessionId; direction = "unknown"; content = $lines[$i]; contentType = "text"; source = "windows-wechat-uia"; sentAt = (Get-Date).ToUniversalTime().ToString("o") }
  }
  return [ordered]@{
    ok = $true
    command = $command
    status = "success"
    errorCode = "success"
    message = "已从当前微信窗口读取会话文本。"
    screenshotPath = $screenshot
    output = [ordered]@{ source = "windows-wechat-uia"; sessions = @($session); messages = $messages; count = $messages.Count; syncedAt = (Get-Date).ToUniversalTime().ToString("o"); screenshotPath = $screenshot; evidence = @((New-Evidence "wechat-chat-history" $sessionId); (New-ScreenshotEvidence "wechat-chat-history-screenshot" $screenshot $Window)); readback = (New-Readback $session.title $text $session.title) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "chat-history-uia-completed"; screenshotPath = $screenshot }
    raw = @{ realWechatActionAttempted = $false }
  }
}

function Invoke-AutoReply {
  param($Window)
  $searchText = [string]$plan.target.searchText
  $replyText = [string]$plan.replyText
  $action = [string]$plan.action
  if ([string]::IsNullOrWhiteSpace($searchText)) {
    return (New-Failure "target_missing" "自动回复缺少目标会话搜索关键字。" "auto-reply-target-missing" "blocked" $false (New-EmptyOutput "auto-reply") @{})
  }
  try {
    Search-WeChat $searchText
  } catch {
    return (New-Failure "target_not_found" ("无法定位微信会话：" + $_.Exception.Message) "auto-reply-search-failed" "blocked" $false (New-EmptyOutput "auto-reply") @{ searchText = $searchText })
  }
  $text = Get-ElementText $Window.element 2500
  $screenshot = Save-WindowScreenshot $Window.element

  if ($action -eq "read-latest") {
    if ([string]::IsNullOrWhiteSpace($text)) {
      return (New-Failure "readback_failed" "未从目标会话读到文本内容。" "auto-reply-read-empty" "blocked" $false (New-EmptyOutput "auto-reply") @{ screenshotPath = $screenshot })
    }
    return [ordered]@{
      ok = $true
      command = $command
      status = "success"
      errorCode = "success"
      message = "已读取目标会话最新文本。"
      screenshotPath = $screenshot
      output = [ordered]@{ ok = $true; status = "success"; readText = $text; sourceText = $text; targetName = $searchText; sent = $false; drafted = $false; screenshotPath = $screenshot; readback = (New-Readback $searchText $text $searchText); evidence = @((New-Evidence "wechat-auto-reply-read" $searchText); (New-ScreenshotEvidence "wechat-auto-reply-read-screenshot" $screenshot $Window)) }
      diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "auto-reply-read-completed"; screenshotPath = $screenshot; autoReply = @{ action = $action; targetName = $searchText; sourceText = $text; sent = $false; screenshotPath = $screenshot } }
      raw = @{ realWechatActionAttempted = $false }
    }
  }

  if ([string]::IsNullOrWhiteSpace($replyText)) {
    return (New-Failure "content_invalid" "自动回复缺少回复内容 replyText。" "auto-reply-content-missing" "blocked" $false (New-EmptyOutput "auto-reply") @{ screenshotPath = $screenshot })
  }

  $script:RealWechatActionAttempted = $true
  Send-KeyText $replyText
  if ($action -eq "send" -and [string]$plan.sendMode -eq "auto-send") {
    Send-KeyCombo "{ENTER}" 900
  }
  Start-Sleep -Milliseconds 600
  $afterText = Get-ElementText $Window.element 2500
  $afterScreenshot = Save-WindowScreenshot $Window.element
  $risk = Detect-RiskText $afterText
  if ($risk) { throw $risk }
  $readback = New-Readback $replyText $afterText $searchText
  if ($action -eq "send" -and -not $readback.matched) {
    throw "自动回复后没有读回到回复内容，已拒绝标记成功。"
  }
  return [ordered]@{
    ok = $true
    command = $command
    status = "success"
    errorCode = "success"
    message = $(if ($action -eq "send") { "自动回复已发送并读回。" } else { "自动回复已写入草稿。" })
    screenshotPath = $afterScreenshot
    output = [ordered]@{ ok = $true; status = "success"; readText = $afterText; sourceText = $text; replyText = $replyText; targetName = $searchText; sent = ($action -eq "send"); drafted = ($action -eq "draft"); screenshotPath = $afterScreenshot; readback = $readback; evidence = @((New-Evidence "wechat-auto-reply" $searchText); (New-StageEvidence "wechat-auto-reply-send" ("target=" + $searchText + "; action=" + $action)); (New-ScreenshotEvidence "wechat-auto-reply-screenshot" $afterScreenshot $Window)) }
    diagnostics = [ordered]@{ command = $command; runner = $runner; runnerVersion = $runnerVersion; stage = "auto-reply-completed"; screenshotPath = $afterScreenshot; autoReply = @{ action = $action; targetName = $searchText; replyText = $replyText; sent = ($action -eq "send"); screenshotPath = $afterScreenshot } }
    raw = @{ realWechatActionAttempted = $true }
  }
}

try {
  $window = Activate-WeChat
  $initialText = Get-ElementText $window.element
  $script:InitialWindowText = $initialText
  $loginProfile = Get-WeChatFailureProfile "" $initialText $false
  if ($loginProfile.code -eq "wechat_not_logged_in") {
    To-JsonLine (New-Failure $loginProfile.code "微信当前未登录或停在二维码登录页。" ($command + "-wechat-not-logged-in") $loginProfile.status $false (New-EmptyOutput $command) @{ initialText = $initialText; failureLayer = $loginProfile.layer } $loginProfile.nextAction) 2
  }
  $risk = Detect-RiskText $initialText
  if ($risk) {
    To-JsonLine (New-Failure "risk_prompt_detected" $risk ($command + "-risk-detected") "blocked" $false (New-EmptyOutput $command) @{ initialText = $initialText }) 2
  }
  switch ($command) {
    "group-broadcast" { To-JsonLine (Invoke-GroupBroadcast $window) 0 }
    "contact-add" { To-JsonLine (Invoke-ContactAdd $window) 0 }
    "friend-accept" { To-JsonLine (Invoke-FriendAccept $window) 0 }
    "moments-publish" { To-JsonLine (Invoke-MomentsPublish $window) 0 }
    "moments-marketing" { To-JsonLine (Invoke-MomentsMarketing $window) 0 }
    "chat-history" { To-JsonLine (Invoke-ChatHistory $window) 0 }
    "auto-reply" { To-JsonLine (Invoke-AutoReply $window) 0 }
    default { To-JsonLine (New-Failure "unknown" ("未知命令：" + $command) "unknown-command") 64 }
  }
} catch {
  $message = $_.Exception.Message
  $attemptedOnFailure = $script:RealWechatActionAttempted
  $failureProfile = Get-WeChatFailureProfile $message $script:InitialWindowText $attemptedOnFailure
  To-JsonLine (New-Failure $failureProfile.code $message ($command + "-uia-failed") $failureProfile.status $attemptedOnFailure (New-EmptyOutput $command) @{ exception = $message; initialText = $script:InitialWindowText; failureLayer = $failureProfile.layer } $failureProfile.nextAction) 2
}
`;

module.exports = { main };

if (require.main === module) {
  main(COMMANDS.has(process.argv[2]) ? process.argv[2] : '');
}
