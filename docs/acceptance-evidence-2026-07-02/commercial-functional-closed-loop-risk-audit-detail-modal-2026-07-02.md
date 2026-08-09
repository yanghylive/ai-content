# 商用功能闭环验证：风险审计详情弹窗

验证时间：2026-07-02 15:01 PDT

## 本轮目标

在上一轮“真实发布平台级证据详情”的基础上，继续补齐证据中心的商用操作闭环：用户不仅能在表格里扫到平台结果，还能点开单条审计记录，查看完整审计摘要、平台执行明细、失败原因、下一步动作和证据入口。

## 本轮改动

- `frontend/src/app/(dashboard)/tasks/evidence/page.tsx`
  - 风险审计表新增“操作”列。
  - 每条风险审计记录增加“详情”按钮。
  - 新增风险审计详情弹窗：
    - 审计编号
    - 来源日志
    - 确认时间
    - 动作类型
    - 执行摘要
    - 平台详情数
    - 已发布 / 需处理 / 待确认统计
    - 平台执行明细
    - 失败原因
    - 下一步动作
    - 发布证据入口

## 验证结果

### 前端静态验证

```bash
npx eslint 'src/app/(dashboard)/tasks/evidence/page.tsx' src/lib/api/dashboard.ts
npx tsc --noEmit --pretty false
npm run build
```

- eslint 通过
- TypeScript noEmit 通过
- Next build 通过，`/tasks/evidence` 已成功构建

### 浏览器交互验证

临时插入一条带平台详情的真实发布审计日志：

- `target=Codex detail modal audit`
- `audit=risk_codex_detail_modal`
- 平台 1：抖音，`success`，带发布 URL 和平台回执
- 平台 2：小红书，`blocked`，带失败原因和下一步动作

打开页面：

```text
http://127.0.0.1:3010/tasks/evidence
```

验证结果：

- 页面能看到临时审计记录。
- 点击第一行“详情”按钮成功打开详情弹窗。
- 弹窗内确认出现：
  - `审计信息`
  - `平台执行明细`
  - `Codex detail modal audit`
  - `抖音 · /accounts/douyin.json`
  - `已发布`
  - `小红书 · /accounts/xhs.json`
  - `平台阻断`
  - `下一步动作`
  - `请处理平台账号权限`
- 浏览器控制台 error 数量：0。

验证后已删除临时 `systemLog`，并刷新页面确认 `Codex detail modal audit` 不再出现。

## 商用闭环结论

证据中心现在从“风险审计列表”前进到“单条审计可展开复盘”。用户可以从真实发布审计进入详情，看清哪些平台已经发布、哪些平台被阻断、为什么阻断、下一步怎么处理，以及是否有发布证据入口。

下一轮建议继续补后端数据深度：把发布 preflight 的逐项检查、确认人、确认时间、payload 摘要也写入审计详情，让详情弹窗从“执行结果复盘”升级成完整的“确认前后全链路复盘”。
