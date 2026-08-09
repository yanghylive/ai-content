# KAYPAL v2 后端接口需求清单

> 来源：前端"零学习成本"改造（v2）已完成页面层重构，以下接口是让全部页面从"示例数据"变成"真实数据"的最后缺口。
> 整理时间：2026-07-29
> 现状：相关页面已在前端标注"示例数据，接口接入后显示真实值"，接口就绪后每页接入成本约 5 分钟。

---

## 一、工作台统计聚合接口（最高优先级，影响 ~20 个页面）

### 需求
各工作台首页需要一个"统计概览"数据，目前前端写死了示例值（已标注）。希望有一个统一的聚合接口，或按领域分接口。

### 建议方案 A：统一聚合接口（推荐）
```
GET /api/workbench-stats
```

响应：
```json
{
  "monitors": { "active": 12, "todayNew": 5, "handled": 28 },
  "inbox": { "pending": 15, "todayHandled": 9, "converted": 6 },
  "industry": { "weekNew": 34, "hotEvents": 6, "competitorMoves": 12 },
  "reports": { "total": 24, "weekNew": 3 },
  "trends": { "todayHot": 18, "rising": 5 },
  "collaboration": { "unassigned": 4, "inProgress": 7, "todayDone": 11 },
  "costs": { "monthUsage": 1240, "monthCost": 328, "remainingQuota": 672 },
  "douyinMessages": { "pending": 7, "todayReplied": 14 },
  "compliance": { "todayChecked": 18, "passed": 16, "needsFix": 2 },
  "risk": { "pendingConfirm": 3, "todayConfirmed": 12, "blocked": 1 },
  "voiceAgent": { "todayCalls": 32, "connectRate": 0.78, "callback": 6 },
  "wecomAssistant": { "todaySessions": 28, "pendingHuman": 3, "aiReplied": 25 },
  "autoAcquisition": { "todayNewLeads": 23, "todayTouched": 15, "pending": 8 },
  "contentWorkspace": { "drafts": 6, "pendingPublish": 3, "weekPublished": 12 },
  "crmCloser": { "activeDeals": 15, "monthWon": 8, "todayFollowUp": 5 },
  "customerDetail": { "interactions": 23, "orders": 3, "pendingFollowUp": 2 },
  "commercialReadiness": { "ready": 18, "pending": 4 },
  "momentsPlan": { "active": 3, "todayPublished": 5, "pendingConfirm": 2 },
  "redfox": { "connected": true, "todayCalls": 156, "availableSkills": 18 },
  "taskEvidence": { "total": 48, "withEvidence": 42, "pending": 4, "failed": 2 }
}
```

### 建议方案 B：按领域分接口（如果统一接口太重）
每个工作台一个轻量统计端点：
```
GET /api/intelligence/monitors/stats
GET /api/intelligence/inbox/stats
GET /api/intelligence/reports/stats
GET /api/intelligence/costs/stats
GET /api/distribution/compliance/stats
GET /api/capabilities/risk/stats
GET /api/crm/closer/stats
...
```

**前端消费方式**：`WorkbenchCenter` 组件的 `stats` 属性直接从接口填充，去掉 `statsNote="示例数据"` 标注。

---

## 二、好友申请列表接口（friend-accept 页面）

### 需求
微信"通过好友"页面需要展示真实的待处理好友申请列表。目前只有创建 friend-accept 任务的接口，没有"待处理申请"的查询接口。

```
GET /api/local-engine/wechat/friend-requests?status=pending&limit=50
```

响应：
```json
[
  {
    "id": "req_001",
    "wxid": "wxid_xxx",
    "nickname": "张三",
    "message": "我是朋友介绍的小张",
    "source": "群聊-产品交流群",
    "appliedAt": "2026-07-29T10:00:00Z",
    "status": "pending"
  }
]
```

字段说明：
- `message`：申请验证消息
- `source`：来源（群聊/名片/搜索等）
- `status`：pending / accepted / rejected / expired

**前端消费方式**：`friend-accept-panel` 的申请列表（现在是 SAMPLE_APPLICATIONS 示例数据）替换为真实数据，支持勾选批量通过（创建接口已存在）。

---

## 三、设置页保存接口

### 3.1 个人资料更新
```
PATCH /api/auth/me
Body: { "name": "...", "email": "..." }
```

### 3.2 修改密码
```
POST /api/auth/me/change-password
Body: { "currentPassword": "...", "newPassword": "..." }
```

### 3.3 通知偏好
```
PUT /api/auth/me/notification-preferences
Body: {
  "taskDone": true,
  "taskFailed": true,
  "newLead": true,
  "dailyReport": false
}
```

### 3.4 数据导出
```
POST /api/data-export
Body: { "scope": ["customers", "contents", "tasks"] }
→ 返回 { "jobId": "...", "status": "queued" }
GET /api/data-export/{jobId} → { "status": "done", "downloadUrl": "..." }
```

**现状**：设置页 UI 已完成（个人资料/改密/通知/数据导出四个区块），保存按钮目前是占位（TODO 注释），接口就绪后接上即可。

---

## 四、已有但需确认的接口

| 接口 | 状态 | 说明 |
|------|------|------|
| `POST /local-engine/groups/plans` | ✅ 已验证可用 | 群发任务创建（已实测通过） |
| `GET /local-engine/wechat/contacts` | ✅ 可用 | 联系人列表（任务中心已接） |
| `GET /local-engine/tasks` | ✅ 可用 | 互动任务列表 |
| `GET /local-engine/health` 等引擎状态 | ✅ 可用 | 健康中心 10 页已全接 |
| `GET /dashboard/stats` | ✅ 可用 | 首页已接 |
| `GET /publishing/accounts` | ✅ 可用 | 平台账号已接 |
| 资源 CRUD（strategies/styles/topics 等） | ✅ 可用 | 10 个资源表单已接 |
| `PATCH /auth/users/:id/role` | ✅ 可用但无 UI | 商用授权管理，建议在"团队成员"页加开关 |

---

## 五、对接说明

1. **所有接口请保持现有统一响应格式**：`{ success, data, message, timestamp, requestId }`
2. **鉴权**：复用现有 session cookie（`ai_content_session`）
3. **接口就绪后通知前端**：前端有完整的接入计划，每个接口对应页面的接入工作量在 5-30 分钟
4. **优先级排序**：一（工作台统计）> 二（好友申请）> 三（设置保存）

---

*本文档由前端 v2 改造过程中整理，对应的页面已全部就绪，只等数据。*
