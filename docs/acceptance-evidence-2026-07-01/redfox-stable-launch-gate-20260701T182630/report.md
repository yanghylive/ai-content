# RedFox Stable Launch Gate Report

Generated at: 2026-07-01T18:26:30.240Z

API base: http://localhost:3011/api

Live read-only smoke: skipped

## Status Counts

| Status | Count |
| --- | --- |
| PASS | 13 |
| WARN | 1 |

## Results

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | plan-doc-exists | docs/redfox-skills-integration-stable-launch-plan-2026-06-29.md |  |
| PASS | gate-matrix-doc-exists | docs/redfox-stable-launch-gate-matrix-2026-06-29.md |  |
| PASS | gate-01-matrix-fragments | Gate 1 - RedFox 连接 matrix fragments are present. |  |
| PASS | gate-02-matrix-fragments | Gate 2 - Skill 同步 matrix fragments are present. |  |
| PASS | gate-03-matrix-fragments | Gate 3 - 情报导入 matrix fragments are present. |  |
| PASS | gate-04-matrix-fragments | Gate 4 - 内容联动 matrix fragments are present. |  |
| PASS | gate-05-matrix-fragments | Gate 5 - 合规审核 matrix fragments are present. |  |
| PASS | gate-06-matrix-fragments | Gate 6 - 评论洞察 matrix fragments are present. |  |
| PASS | gate-07-matrix-fragments | Gate 7 - 成本控制 matrix fragments are present. |  |
| PASS | gate-08-matrix-fragments | Gate 8 - 权限安全 matrix fragments are present. |  |
| PASS | gate-09-matrix-fragments | Gate 9 - 降级兜底 matrix fragments are present. |  |
| PASS | gate-10-matrix-fragments | Gate 10 - 运营可用 matrix fragments are present. |  |
| PASS | global-security-fragments | Global security fragments are present. |  |
| WARN | live-read-only-smoke-skipped | Live API smoke was skipped. Set REDFOX_GATE_LIVE=1 or pass --live after RedFox API routes land. | Run with a test tenant and auth cookie before release candidate signoff. |

