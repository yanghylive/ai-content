# P4 Business Journey Smoke Evidence

- Generated at: 2026-08-23T08:50:40.351Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3015
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-5f93ef89-aabe-46da-99e7-9f1cfba72a22
- contentDraftId: draft-20061a68-39ee-4ce9-8449-a2753b1cbe23
- complianceCheckId: compliance-1787475040411-7i9u6u
- publishIntentId: publish-26c3ea93a7b0e8802e061969
- crmEvidenceDir: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T08-50-40-351Z/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 26ms |  |
| PASS | 创作优化：版本已保存 | version=version-5f93ef89-aabe-46da-99e7-9f1cfba72a22; draft=draft-20061a68-39ee-4ce9-8449-a2753b1cbe23; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 6ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 8ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 8ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 6ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-08-23T08:50:40.433Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 5ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-26c3ea93a7b0e8802e061969; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 6ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 7ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-1b248538-58f8-48f0-bb3d-5ed5020f9991 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 4ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-23/p4-business-journey-2026-08-23T08-50-40-351Z/crm-phase1 |  |

