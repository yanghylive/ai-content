# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-23T03:36:22.271Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3015
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-9d1391bc-7d1d-4f87-b8ab-4c08e2abc6b4
- contentDraftId: draft-fbe336c9-6f79-4c7c-9e51-5585142decbb
- complianceCheckId: compliance-1787456182355-lcteyf
- publishIntentId: publish-62e02a47998b09fb5cd3a546
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T03-36-22-271Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 42ms |  |
| PASS | 创作优化：版本已保存 | version=version-9d1391bc-7d1d-4f87-b8ab-4c08e2abc6b4; draft=draft-fbe336c9-6f79-4c7c-9e51-5585142decbb; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 9ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 15ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 12ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 8ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-08-23T03:36:22.387Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 7ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-62e02a47998b09fb5cd3a546; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 6ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 7ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-954768d6-d78b-4f3f-9c8d-54ad90208023 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 4ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T03-36-22-271Z/crm-phase1 |  |

