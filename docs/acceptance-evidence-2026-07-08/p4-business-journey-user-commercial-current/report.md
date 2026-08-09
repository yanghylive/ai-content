# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-08T22:22:11.404Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-5c16edc9-f9a9-446b-b157-71a6208fcb50
- contentDraftId: draft-a1a252b2-d238-4d95-bd3a-1fe9ca3cd2c5
- complianceCheckId: compliance-1783549331457-biukwc
- publishIntentId: publish-4de07e53-b932-4910-85fe-6ff380522b92
- crmEvidenceDir: docs/acceptance-evidence-2026-07-08/p4-business-journey-user-commercial-current/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 39ms |  |
| PASS | 创作优化：版本已保存 | version=version-5c16edc9-f9a9-446b-b157-71a6208fcb50; draft=draft-a1a252b2-d238-4d95-bd3a-1fe9ca3cd2c5; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 7ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 12ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 11ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 12ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-08T22:22:11.492Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 10ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-4de07e53-b932-4910-85fe-6ff380522b92; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 10ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 9ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-edb87ec4-ac5a-4346-98c1-17381282a2b4 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 8ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：docs/acceptance-evidence-2026-07-08/p4-business-journey-user-commercial-current/crm-phase1 |  |

