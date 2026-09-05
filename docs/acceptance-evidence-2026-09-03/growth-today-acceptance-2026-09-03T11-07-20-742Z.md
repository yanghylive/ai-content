# Growth / Today 运行态验收（复核五点闭环）

- Started: 2026-09-03T11:07:04.207Z
- Finished: 2026-09-03T11:07:20.742Z
- Frontend: http://127.0.0.1:3010 · Backend API: http://127.0.0.1:3011/api · commit: fe43988828b8f2ec690efb688904dc37f5fd31d6
- 登录态：一次性会话 acc_growth_today_4451abb7bf01802d（已清理）
- 视口: 1440x900 亮/暗 + 375x812 移动

## 结果

| ID | 检查 | 结论 |
|---|---|---|
| T1 | /growth 终态重定向 /today | PASS |
| T2a | 亮色 /today 核心区块可见 | PASS |
| T2b | 亮色 1440 无横向溢出 | PASS |
| T2c | 主题钮切换暗色生效 | PASS |
| T2d | 暗色 1440 无横向溢出 | PASS |
| T3 | 375px 移动视口无横向溢出 | PASS |
| T4 | overview 500 → home 主数据仍渲染且无整页错误 | PASS |
| T5 | 无未解释 console error / 请求失败 | PASS |

## 明细
- T1 /growth 终态重定向 /today: PASS — 200 http://127.0.0.1:3010/growth -> http://127.0.0.1:3010/today
- T2a 亮色 /today 核心区块可见: PASS — {"hub":true,"funnel":true,"recent":true}
- T2b 亮色 1440 无横向溢出: PASS — scrollWidth=1440 clientWidth=1440
- T2c 主题钮切换暗色生效: PASS — clicked=true dark=true bg rgba(0, 0, 0, 0) -> rgba(0, 0, 0, 0)
- T2d 暗色 1440 无横向溢出: PASS — scrollWidth=1440 clientWidth=1440
- T3 375px 移动视口无横向溢出: PASS — scrollWidth=375 clientWidth=375
- T4 overview 500 → home 主数据仍渲染且无整页错误: PASS — {"hub":true,"funnel":true,"recent":true,"brief":false,"bill":false,"fullError":false}
- T5 无未解释 console error / 请求失败: PASS — clean

截图：t1-growth-redirect-today.png / t2-today-light.png / t2-today-dark.png / t3-today-mobile-375.png / t4-overview-fail-partial.png
