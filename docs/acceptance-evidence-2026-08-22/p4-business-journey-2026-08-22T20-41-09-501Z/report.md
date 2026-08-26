# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-22T20:41:09.501Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-63cf655f-ab2b-40ed-8347-f9d97aa630fd
- contentDraftId: draft-de60741c-f85e-4036-8fc1-30033b8f5159
- complianceCheckId: compliance-1787431269618-b4mbgm
- publishIntentId: publish-ec88a09e739fd50d81b89833
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-22/p4-business-journey-2026-08-22T20-41-09-501Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 73ms |  |
| PASS | 创作优化：版本已保存 | version=version-63cf655f-ab2b-40ed-8347-f9d97aa630fd; draft=draft-de60741c-f85e-4036-8fc1-30033b8f5159; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 12ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 13ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 15ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 13ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-08-22T20:41:09.661Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 11ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-ec88a09e739fd50d81b89833; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 9ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 7ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-6070e1aa-d84b-45bb-b72a-1501eab5cebd |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 7ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-22/p4-business-journey-2026-08-22T20-41-09-501Z/crm-phase1 |  |

