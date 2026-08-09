# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-08T21:20:26.438Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-d4c57184-9904-4d7e-ae76-8d04c492f5e1
- contentDraftId: draft-7e1e6954-8ed5-4d7c-8c94-2281c9cac5ed
- complianceCheckId: compliance-1783545626511-ubjrg6
- publishIntentId: publish-bf7381ec-ac37-4011-b7c0-b9186c792da8
- crmEvidenceDir: docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-after-fix/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 57ms |  |
| PASS | 创作优化：版本已保存 | version=version-d4c57184-9904-4d7e-ae76-8d04c492f5e1; draft=draft-7e1e6954-8ed5-4d7c-8c94-2281c9cac5ed; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 7ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 11ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 22ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 26ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-08T21:20:26.567Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 7ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-bf7381ec-ac37-4011-b7c0-b9186c792da8; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 26ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 7ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-d35960c8-4758-43b8-8eb7-adec0069af99 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 5ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-after-fix/crm-phase1 |  |

