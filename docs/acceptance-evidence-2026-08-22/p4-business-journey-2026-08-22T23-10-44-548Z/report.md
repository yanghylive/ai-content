# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-22T23:10:44.548Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-21ec880a-9609-43dc-9476-aaa13ae8d180
- contentDraftId: draft-d85ffdb2-711f-41d6-a2b7-6d74e4dcbf3c
- complianceCheckId: compliance-1787440244697-v4o28a
- publishIntentId: publish-76b158fd2db28382a7076a0c
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-22/p4-business-journey-2026-08-22T23-10-44-548Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 82ms |  |
| PASS | 创作优化：版本已保存 | version=version-21ec880a-9609-43dc-9476-aaa13ae8d180; draft=draft-d85ffdb2-711f-41d6-a2b7-6d74e4dcbf3c; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 19ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 15ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 21ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 16ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-08-22T23:10:44.745Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 15ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-76b158fd2db28382a7076a0c; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 14ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 14ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-3c997724-ed7e-41ef-b40f-6ecde38ed75a |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 11ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-22/p4-business-journey-2026-08-22T23-10-44-548Z/crm-phase1 |  |

