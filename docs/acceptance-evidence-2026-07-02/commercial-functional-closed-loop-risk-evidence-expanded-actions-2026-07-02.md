# 商用功能闭环验证：风险审计证据扩展

验证时间：2026-07-02 14:34 PDT

## 本轮目标

继续上一轮“证据中心 / 风险审计”闭环，不做前端命名测试，重点验证高风险业务动作是否能形成商用可追责链路：

`人工确认 -> 执行动作/预检阻断 -> riskAudit -> system_logs -> /dashboard/risk-audit-evidence -> 证据中心可读记录`

## 本轮改动

- `backend/src/modules/auto-upload/auto-upload.service.ts`
  - 为 AutoUpload 高风险动作接入统一审计日志写入：
    - 清理互动证据
    - 删除平台账号
    - 重试发布任务
    - 恢复阻断发布任务
    - 删除本地素材文件
    - 真实发布
  - 新增统一日志格式：
    - `风险审计已确认：{actionLabel}（action=..., target=..., audit=..., risk=..., status=..., detail=...）`

- `backend/src/modules/dashboard/dashboard.service.ts`
  - 修正 `audit=` 提取，避免新日志格式里把逗号带进 auditId。
  - 新增通用风险审计日志解析：
    - action
    - actionLabel
    - riskLevel
    - targetLabel
    - detail
    - summary

- `backend/src/modules/auto-upload/auto-upload.service.spec.ts`
  - 增加 systemLogsService mock。
  - 覆盖“未确认不执行、不写执行证据”。
  - 覆盖“确认后清理互动证据会写风险审计证据”。
  - 覆盖“确认后真实发布 / 删除平台账号会写风险审计证据”。

- `backend/src/modules/dashboard/dashboard.service.spec.ts`
  - 覆盖通用高风险审计日志解析。

## 验证结果

### 后端目标单测

命令：

```bash
npm test -- auto-upload.service.spec.ts dashboard.service.spec.ts materials.service.spec.ts --runInBand
```

结果：

- Test Suites: 3 passed
- Tests: 34 passed

### 后端构建

命令：

```bash
npm run build
```

结果：

- 通过
- 注：第一次遇到旧 `dist/modules` 清理瞬时 `ENOTEMPTY`，复跑通过，无类型错误。

### 本地 API 验证

未登录访问：

```bash
curl 'http://127.0.0.1:3011/api/dashboard/risk-audit-evidence?limit=5'
```

结果：

- HTTP 401

登录态访问：

- 使用现有活跃用户创建 1 小时临时 session。
- 插入一条临时 systemLog：
  - `风险审计已确认：真实发布（action=publish, target=Codex publish audit test, audit=risk_codex_publish, risk=high, status=allowed, detail=submitted=1;blocked=0）`
- 调用 `GET /api/dashboard/risk-audit-evidence?limit=5`

接口返回已正确解析为：

- `action: publish`
- `actionLabel: 真实发布`
- `riskLevel: high`
- `status: allowed`
- `targetLabel: Codex publish audit test`
- `detail: submitted=1;blocked=0`
- `summary: 已确认真实发布：Codex publish audit test`

验证后已删除临时 `systemLog` 和临时 `userSession`。

## 商用闭环结论

本轮把风险证据中心从“素材删除证据”扩展为可承接多种高风险动作的统一证据入口。现在真实发布、账号删除、任务重试、阻断恢复、证据清理等动作，具备同一套可追责链路。

仍建议下一轮继续做“真实发布任务的详情级证据展开”：把 `detail=submitted/blocked` 进一步扩展成每个平台的 preflight、执行结果、失败原因、下一步动作和回读证据，避免用户只看到一条总摘要。
