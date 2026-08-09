# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-03T11:49:04.879Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-fdb64e8f-6585-41c8-a4b5-4ad247a16dea
- contentDraftId: draft-61ed79ba-f833-4b91-92c2-c57dc070aa31
- complianceCheckId: compliance-1783079344945-vbeu11
- publishIntentId: publish-2cd6117f-b7b9-4a82-b588-f770760be72b
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 37ms |  |
| PASS | 创作优化：版本已保存 | version=version-fdb64e8f-6585-41c8-a4b5-4ad247a16dea; draft=draft-61ed79ba-f833-4b91-92c2-c57dc070aa31; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 8ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 9ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 9ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 9ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-03T11:49:04.971Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 8ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-2cd6117f-b7b9-4a82-b588-f770760be72b; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 7ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 8ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-a683109e-5a5f-4452-9024-2545a60ffced |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 5ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-03/p4-business-journey-2026-07-03T11-49-04-879Z/crm-phase1 |  |

