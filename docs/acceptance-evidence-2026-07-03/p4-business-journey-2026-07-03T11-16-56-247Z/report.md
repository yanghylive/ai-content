# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-03T11:16:56.247Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-53a88bc2-f5be-46d4-81b2-57a48a98fcd2
- contentDraftId: draft-ef9f2d6c-b7e6-4c59-9c7b-a5e286ac499f
- complianceCheckId: compliance-1783077416343-qxhcy0
- publishIntentId: publish-d45b3bd3-a929-4845-956e-1ee8691dee37
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-16-56-247Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 57ms |  |
| PASS | 创作优化：版本已保存 | version=version-53a88bc2-f5be-46d4-81b2-57a48a98fcd2; draft=draft-ef9f2d6c-b7e6-4c59-9c7b-a5e286ac499f; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 9ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 10ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 10ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 10ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-03T11:16:56.370Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 9ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-d45b3bd3-a929-4845-956e-1ee8691dee37; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 10ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 10ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-c1950d40-8c87-4c85-9c3b-3fce0eb73164 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 9ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-16-56-247Z/crm-phase1 |  |

