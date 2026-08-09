# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-09T11:25:27.924Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-8f693146-3279-4273-a905-8cf14e0e8829
- contentDraftId: draft-437fffe8-c2d2-45b2-8ea5-bf37d94363b3
- complianceCheckId: compliance-1786274727980-2untuj
- publishIntentId: publish-ff92d0ffa79189f23c7858e2
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/p4-business-journey-2026-08-09T11-25-27-924Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 27ms |  |
| PASS | 创作优化：版本已保存 | version=version-8f693146-3279-4273-a905-8cf14e0e8829; draft=draft-437fffe8-c2d2-45b2-8ea5-bf37d94363b3; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 6ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 8ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 10ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 8ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-08-09T11:25:28.005Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 7ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-ff92d0ffa79189f23c7858e2; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 8ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 5ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-cf5d8e08-00a7-450a-8688-f29733946e5f |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 4ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-09/p4-business-journey-2026-08-09T11-25-27-924Z/crm-phase1 |  |

