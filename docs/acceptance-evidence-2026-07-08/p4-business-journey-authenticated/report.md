# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-08T19:41:54.439Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-9f9dc6f6-abf8-4a26-820c-f0a9b7159f86
- contentDraftId: draft-e48735f3-6617-42e0-96f6-205253263749
- complianceCheckId: compliance-1783539714581-bh94fz
- publishIntentId: publish-f634b772-396d-42b7-a7c8-00216f16ec1b
- crmEvidenceDir: docs/acceptance-evidence-2026-07-08/p4-business-journey-authenticated/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 121ms |  |
| PASS | 创作优化：版本已保存 | version=version-9f9dc6f6-abf8-4a26-820c-f0a9b7159f86; draft=draft-e48735f3-6617-42e0-96f6-205253263749; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 12ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 11ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 87ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 10ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-08T19:41:54.683Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 9ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-f634b772-396d-42b7-a7c8-00216f16ec1b; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 8ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 15ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-58702b22-a3e8-43c2-b4bf-4df49a6a0253 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 9ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：docs/acceptance-evidence-2026-07-08/p4-business-journey-authenticated/crm-phase1 |  |

