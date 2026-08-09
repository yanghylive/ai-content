# P4 Business Journey Smoke Evidence

- Generated at: 2026-07-08T21:57:32.523Z
- API: http://127.0.0.1:3011/api
- Frontend: http://127.0.0.1:3010
- Result: PASS
- Counts: PASS=20 FAIL=0 BLOCKED=0

## Artifacts

- contentVersionId: version-f20e9162-548a-4302-ad82-2434a9bd8ecb
- contentDraftId: draft-74d4abe8-d8ca-47e8-acaf-ed2ffd9f830f
- complianceCheckId: compliance-1783547852581-jzoqcy
- publishIntentId: publish-c302443b-2fc7-4821-8f5a-9950c1a82e0f
- crmEvidenceDir: docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-final/crm-phase1

## Checks

| Status | Check | Details | Next step |
| --- | --- | --- | --- |
| PASS | 创作优化：保存优化版本 | HTTP 201; 42ms |  |
| PASS | 创作优化：版本已保存 | version=version-f20e9162-548a-4302-ad82-2434a9bd8ecb; draft=draft-74d4abe8-d8ca-47e8-acaf-ed2ffd9f830f; status=saved |  |
| PASS | 创作优化：差异摘要可读 | HTTP 200; 9ms |  |
| PASS | 创作优化：差异摘要完整 | original=13; version=89 |  |
| PASS | 合规检查：发布前检查完成 | HTTP 201; 9ms |  |
| PASS | 合规检查：风险门禁命中 | risk=medium; score=62; findings=2 |  |
| PASS | 创作优化：设为正式稿 | HTTP 201; 10ms |  |
| PASS | 创作优化：正式稿状态正确 | status=official; official=true |  |
| PASS | 发布准备：复核前被阻断 | 当前内容需要负责人复核后才能进入发布准备 |  |
| PASS | 发布准备：负责人复核完成 | HTTP 201; 8ms |  |
| PASS | 发布准备：复核记录可追踪 | reviewedAt=2026-07-08T21:57:32.606Z |  |
| PASS | 发布准备：复核后进入发布准备 | HTTP 201; 8ms |  |
| PASS | 发布准备：待发布记录已创建 | publish=publish-c302443b-2fc7-4821-8f5a-9950c1a82e0f; status=ready; platform=xiaohongshu |  |
| PASS | 发布复盘：业务结果可记录 | HTTP 201; 8ms |  |
| PASS | 发布复盘：线索指标已保存 | views=1280; leads=5 |  |
| PASS | 协作备注：备注可记录 | HTTP 201; 8ms |  |
| PASS | 协作备注：备注内容已返回 | comment=comment-eb5aaea3-e537-4b3a-aa39-b49045bba2b2 |  |
| PASS | 创作优化：版本列表可追踪 | HTTP 200; 5ms |  |
| PASS | 创作优化：版本列表包含本次记录 | total=1; found=true |  |
| PASS | CRM 导入：写入后可回滚 | CRM smoke 通过，证据目录：docs/acceptance-evidence-2026-07-08/p4-business-journey-current-authenticated-final/crm-phase1 |  |

