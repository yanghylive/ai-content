# 商用功能闭环验证：真实发布平台级证据详情

验证时间：2026-07-02 14:46 PDT

## 本轮目标

继续风险审计证据中心建设，把“真实发布”的审计记录从总摘要升级为平台级明细：

`真实发布确认 -> 发布预检/执行 -> 平台结果 -> 风险审计日志 -> 证据 API -> 证据页可读详情`

## 本轮改动

- `backend/src/modules/auto-upload/auto-upload.service.ts`
  - 真实发布审计日志新增 `details=` 字段。
  - `details` 使用 base64url JSON，兼容现有 `system_logs.content` 文本字段，不改数据库 schema。
  - 平台级详情包含：
    - 平台 / 账号
    - 状态与状态文案
    - 发布任务 ID
    - 发布 URL / 外部 ID
    - 失败原因
    - 下一步动作
    - 证据来源

- `backend/src/modules/dashboard/dashboard.service.ts`
  - 风险审计通用日志解析改为 key/value 解析。
  - 新增 `RiskAuditEvidenceDetail[]` 解码与白名单字段过滤。
  - 坏日志或不可解码详情不会打挂 API，会降级为空详情。

- `frontend/src/lib/api/dashboard.ts`
  - `RiskAuditEvidence` 增加 `detail` 和 `details` 类型。

- `frontend/src/app/(dashboard)/tasks/evidence/page.tsx`
  - 风险审计表新增“详情”列。
  - 发布审计可展示平台级状态、任务 ID、证据来源、发布证据链接、下一步动作。
  - 指标区新增“发布审计”和“平台详情”。

## 验证结果

### 后端目标单测

```bash
npm test -- auto-upload.service.spec.ts dashboard.service.spec.ts materials.service.spec.ts --runInBand
```

- Test Suites: 3 passed
- Tests: 34 passed

### 后端构建

```bash
npm run build
```

- 通过

### 前端检查

```bash
npx eslint 'src/app/(dashboard)/tasks/evidence/page.tsx' src/lib/api/dashboard.ts
npm run build
npx tsc --noEmit --pretty false
```

- eslint 通过
- Next build 通过，`/tasks/evidence` 已生成
- TypeScript noEmit 通过

### API 验证

- 未登录访问 `GET /api/dashboard/risk-audit-evidence?limit=5` 返回 HTTP 401。
- 插入临时带 `details=` 的真实发布审计日志。
- 使用临时 session 调用 API，返回：
  - `action: publish`
  - `riskLevel: high`
  - `detail: submitted=2;blocked=0`
  - `details[0].platform: 抖音`
  - `details[0].status: success`
  - `details[0].publishUrl: https://www.douyin.com/video/45`
  - `details[1].platform: 小红书`
  - `details[1].status: blocked`
  - `details[1].nextAction` 正确返回

验证后已删除临时 `systemLog` 和临时 `userSession`。

### 页面验证

使用内置浏览器打开：

```text
http://127.0.0.1:3010/tasks/evidence
```

页面确认出现：

- `风险审计证据`
- `Codex platform detail audit`
- `抖音 · /accounts/douyin.json`
- `已发布`
- `平台回执`
- `小红书 · /accounts/xhs.json`
- `平台阻断`
- `下一步：请处理平台账号权限、验证码、社区规范风控或页面状态后重试。`

## 商用闭环结论

真实发布现在不再只有“已确认发布”的审计总账，而是能在证据中心展开到每个平台的执行结果和下一步动作。这个闭环更接近商用发布系统需要的可追责能力：用户能区分已发布、待确认、平台阻断、未接入、素材异常等状态，而不是把所有结果混成一条成功或失败。

下一轮建议继续补“发布审计详情页/抽屉”：从表格里的平台详情进入单条审计记录，展示完整 preflight、payload 摘要、确认人、执行回执、页面回读、重试/回滚入口。
