import { Client } from 'pg';

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const oldTables = await client.query(
    `SELECT tablename FROM pg_tables WHERE tablename LIKE 'local_engine_%' AND tablename NOT LIKE '%_backup'`,
  );

  if (oldTables.rows.length === 0) {
    console.log('No old tables found, nothing to migrate');
    await client.end();
    return;
  }

  const typeMap: Record<string, string> = {
    'douyin-comment-reply': 'DOUYIN_COMMENT_REPLY',
    'douyin-direct-message-reply': 'DOUYIN_DIRECT_MESSAGE_REPLY',
    'wechat-reply-draft': 'WECHAT_REPLY_DRAFT',
    'wechat-group-broadcast': 'WECHAT_GROUP_BROADCAST',
    'wechat-moments-publish': 'WECHAT_MOMENTS_PUBLISH',
    'customer-follow-up': 'CUSTOMER_FOLLOW_UP',
  };
  const statusMap: Record<string, string> = {
    queued: 'QUEUED',
    running: 'RUNNING',
    waiting_for_send_confirmation: 'WAITING_FOR_SEND_CONFIRMATION',
    completed: 'COMPLETED',
    failed: 'FAILED',
    blocked: 'BLOCKED',
    skipped: 'SKIPPED',
    no_target: 'NO_TARGET',
    paused: 'PAUSED',
  };

  try {
    const tasks = await client.query('SELECT id, task_json FROM local_engine_interaction_tasks');
    for (const row of tasks.rows) {
      const task = typeof row.task_json === 'string' ? JSON.parse(row.task_json) : row.task_json;
      await client.query(
        `INSERT INTO interaction_tasks (id, "taskType", "accountId", "sessionId", "ruleId", "sendMode", status, "riskLevel", stage, "currentTarget", "draftText", "processedCount", "failedCount", "skippedCount", "batchTargets", "batchSummary", events, evidence, config, "createdBy", "localTaskId", "requiresDoubleConfirmation", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          typeMap[task.type] || task.type,
          task.accountId || null,
          task.sessionId || null,
          task.ruleId || null,
          task.sendMode || 'approval-send',
          statusMap[task.status] || task.status,
          task.riskLevel || 'medium',
          task.diagnostics?.currentStep || null,
          task.targetName || null,
          task.replyText || null,
          task.processedCount || 0,
          task.failedCount || 0,
          task.skippedCount || 0,
          JSON.stringify(task.batchTargets || null),
          JSON.stringify(task.batchSummary || null),
          JSON.stringify(task.events || []),
          JSON.stringify(task.evidence || []),
          JSON.stringify(task),
          task.createdBy || null,
          task.localTaskId || null,
          task.requiresDoubleConfirmation || false,
          task.createdAt || new Date().toISOString(),
          task.updatedAt || new Date().toISOString(),
        ],
      );
    }
    console.log(`Migrated ${tasks.rows.length} tasks`);
  } catch (e: any) {
    console.error('Task migration error:', e.message);
  }

  try {
    const rules = await client.query('SELECT id, rule_json FROM local_engine_reply_rules');
    for (const row of rules.rows) {
      const rule = typeof row.rule_json === 'string' ? JSON.parse(row.rule_json) : row.rule_json;
      await client.query(
        `INSERT INTO interaction_reply_rules (id, name, platform, industry, goal, tone, "sendMode", "forbiddenWords", "escalationRules", keywords, highlights, "closingText", enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          'default',
          null,
          rule.industryName || null,
          null,
          rule.tone || null,
          rule.defaultSendMode || 'approval-send',
          JSON.stringify(rule.blockedKeywords || []),
          JSON.stringify(rule),
          JSON.stringify(rule.requireApprovalKeywords || []),
          JSON.stringify(rule.serviceHighlights || []),
          rule.closingText || null,
          true,
          new Date().toISOString(),
          rule.updatedAt || new Date().toISOString(),
        ],
      );
    }
    console.log(`Migrated ${rules.rows.length} reply rules`);
  } catch (e: any) {
    console.error('Reply rule migration error:', e.message);
  }

  try {
    const sessions = await client.query('SELECT id, session_json FROM local_engine_agent_sessions');
    for (const row of sessions.rows) {
      const session = typeof row.session_json === 'string' ? JSON.parse(row.session_json) : row.session_json;
      await client.query(
        `INSERT INTO agent_sessions (id, instruction, source, status, scope, "targetApp", "riskLevel", "riskAnalysis", events, confirmations, evidence, "createdBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          session.instruction || '',
          session.source || null,
          session.status || 'running',
          JSON.stringify(session),
          session.targetApp || null,
          session.riskLevel || null,
          null,
          JSON.stringify(session.events || []),
          JSON.stringify(session.confirmations || []),
          JSON.stringify([]),
          session.createdBy || null,
          session.createdAt || new Date().toISOString(),
          session.updatedAt || new Date().toISOString(),
        ],
      );
    }
    console.log(`Migrated ${sessions.rows.length} agent sessions`);
  } catch (e: any) {
    console.error('Agent session migration error:', e.message);
  }

  try {
    const confirmations = await client.query('SELECT id, confirmation_json FROM local_engine_agent_confirmations');
    for (const row of confirmations.rows) {
      const confirmation = typeof row.confirmation_json === 'string' ? JSON.parse(row.confirmation_json) : row.confirmation_json;
      await client.query(
        `INSERT INTO agent_confirmations (id, "sessionId", action, "riskLevel", target, content, status, operator, note, "riskPolicies", "safetyBoundaries", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          confirmation.sessionId || '',
          confirmation.actionLabel || '',
          confirmation.riskLevel || 'medium',
          JSON.stringify(confirmation),
          JSON.stringify(confirmation),
          confirmation.status || 'pending',
          confirmation.operator || null,
          confirmation.note || null,
          JSON.stringify(confirmation.riskPolicy || null),
          JSON.stringify(confirmation.safetyBoundary || null),
          confirmation.createdAt || new Date().toISOString(),
          confirmation.decidedAt || new Date().toISOString(),
        ],
      );
    }
    console.log(`Migrated ${confirmations.rows.length} agent confirmations`);
  } catch (e: any) {
    console.error('Agent confirmation migration error:', e.message);
  }

  for (const table of [
    'local_engine_interaction_tasks',
    'local_engine_reply_rules',
    'local_engine_agent_sessions',
    'local_engine_agent_confirmations',
  ]) {
    try {
      await client.query(`ALTER TABLE "${table}" RENAME TO "${table}_backup"`);
      console.log(`Renamed ${table} to ${table}_backup`);
    } catch (e: any) {
      console.log(`Could not rename ${table}:`, e.message);
    }
  }

  await client.end();
  console.log('Migration complete');
}

migrate().catch(console.error);
