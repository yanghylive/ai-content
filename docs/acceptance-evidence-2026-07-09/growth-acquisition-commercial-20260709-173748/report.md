# 增长获客 7 页商用验收结果

- 生成时间：2026-07-09T17:37:49.235Z
- 前端地址：http://127.0.0.1:3010
- API 地址：http://127.0.0.1:3011/api
- 视口：desktop 1440x1000 / laptop 1365x900 / narrow 768x1024
- 汇总：PASS=0 WARN=0 BLOCKED=0 FAILED=1

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| FAILED | unexpected error | Error: Command failed: sqlite3 /Users/yanghy/Documents/New project/ai-content/backend/prisma/ai-content-dev.db <br>    insert into user_sessions (<br>      id,<br>      user_id,<br>      token_hash,<br>      expires_at,<br>      last_used_at,<br>      metadata,<br>      created_at,<br>      updated_at<br>    ) values (<br>      'growth_acceptance_8b631e240c0ef594e77c7b20',<br>      'cmr7tb3k000038o8n0x5s0hts',<br>      'e5f33cabc6c0fb711e2a6be05ba4cc65106e97c27f86d18769fbe5078d3bd8a2',<br>      '2026-07-10T17:37:49.228Z',<br>      '2026-07-09T17:37:49.228Z',<br>      '{"source":"growth-acquisition-acceptance","localOnly":true,"kaypalDesktopAccessToken":"local-growth-access-a8b7129bead5fae1","kaypalDesktopRefreshToken":"local-growth-refresh-126b31b4cc124612","kaypalDesktopTokenExpiresAt":"2026-07-10T17:37:49.228Z","kaypalDesktopDeviceId":"local-growth-device-569efbbb","kaypalSubscriptionPlan":"ADVANCED","kaypalSubscriptionPeriodEnd":"2026-08-08T17:37:49.228Z","kaypalRole":"SUPER_ADMIN","kaypalPlatformRole":"SUPER_ADMIN","kaypalPermissionNames":["growth_acceptance"],"kaypalMetadataSyncedAt":"2026-07-09T17:37:49.228Z"}',<br>      '2026-07-09T17:37:49.228Z',<br>      '2026-07-09T17:37:49.228Z'<br>    );<br>  <br>Error: in prepare, database is locked (5)<br><br>    at genericNodeError (node:internal/errors:983:15)<br>    at wrappedFn (node:internal/errors:537:14)<br>    at checkExecSyncError (node:child_process:916:11)<br>    at execFileSync (node:child_process:952:15)<br>    at sqliteExec (file:///Users/yanghy/Documents/New%20project/ai-content/scripts/growth-acquisition-acceptance.mjs:636:3)<br>    at createLocalAcceptanceSessionIfRequested (file:///Users/yanghy/Documents/New%20project/ai-content/scripts/growth-acquisition-acceptance.mjs:554:3)<br>    at file:///Users/yanghy/Documents/New%20project/ai-content/scripts/growth-acquisition-acceptance.mjs:140:3 | 修复脚本异常、依赖或本地服务后重新执行。 | - |

