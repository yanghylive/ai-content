# 增长获客 7 页商用验收结果

- 生成时间：2026-06-26T06:22:47.512Z
- 前端地址：http://localhost:3010
- API 地址：http://localhost:3011/api
- 视口：desktop 1440x1000 / laptop 1365x900 / narrow 768x1024
- 汇总：PASS=67 WARN=0 BLOCKED=0 FAILED=36

## 结果明细

| 状态 | 范围 | 说明 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| PASS | auth | Loaded 1 auth cookie(s) into 4 origin(s). | - | - |
| PASS | setup | Playwright loaded from ../backend/node_modules/playwright | - | - |
| PASS | setup | Evidence directory: /Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131 | - | - |
| PASS | auth | /auth/me accepted the browser cookie. | - | - |
| FAILED | 获客总览 desktop | missing required text: 增长获客总览 / 商用级增长底座 / 执行记录 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-desktop.png |
| FAILED | 获客总览 desktop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-desktop.png |
| PASS | 获客总览 desktop | interactive controls detected: 8 | - | - |
| PASS | 获客总览 desktop | no body-level horizontal overflow | - | - |
| FAILED | 获客总览 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-desktop.png |
| FAILED | 自动获客矩阵 desktop | missing required text: 执行计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-desktop.png |
| FAILED | 自动获客矩阵 desktop | missing expected table(s): 获客任务 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-desktop.png |
| PASS | 自动获客矩阵 desktop | interactive controls detected: 37 | - | - |
| PASS | 自动获客矩阵 desktop | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 获客玩法 关键词获客 \| 执行账号 优先选择在线正常账号 \| 执行风控 人工确认后触达 \| 线索去重 按昵称/主页/原文去重 \| 加入执行计划 仅手动确认 \| 任务状态 全部状态 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-desktop.png |
| PASS | 获客策略 desktop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-desktop.png |
| PASS | 获客策略 desktop | interactive controls detected: 16 | - | - |
| PASS | 获客策略 desktop | no body-level horizontal overflow | - | - |
| FAILED | 获客策略 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 健康度 全部健康度 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-desktop.png |
| FAILED | 线索池 desktop | missing required text: 加入线索池 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-desktop.png |
| PASS | 线索池 desktop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 desktop | interactive controls detected: 19 | - | - |
| PASS | 线索池 desktop | no body-level horizontal overflow | - | - |
| FAILED | 线索池 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 线索状态 全部状态 \| 平台 全部平台 \| 来源 全部来源 \| 跟进 全部意向 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-desktop.png |
| PASS | 账号健康 desktop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/account-health-desktop.png |
| PASS | 账号健康 desktop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 desktop | interactive controls detected: 11 | - | - |
| PASS | 账号健康 desktop | no body-level horizontal overflow | - | - |
| FAILED | 账号健康 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/account-health-desktop.png |
| PASS | 增长复盘 desktop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-desktop.png |
| FAILED | 增长复盘 desktop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-desktop.png |
| PASS | 增长复盘 desktop | interactive controls detected: 37 | - | - |
| PASS | 增长复盘 desktop | no body-level horizontal overflow | - | - |
| FAILED | 增长复盘 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 时间范围 近 7 天 \| 平台 全部平台 \| 任务 全部任务 \| 新增线索 0 查看明细 \| 已触达 0 查看明细 \| 高意向线索 0 查看明细 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-desktop.png |
| PASS | 增长工作流 desktop | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-desktop.png |
| PASS | 增长工作流 desktop | interactive controls detected: 18 | - | - |
| PASS | 增长工作流 desktop | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 desktop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 模板 内容到获客闭环 \| 内容到获客闭环 已选模板 从内容准备、发布确认、获客预演、线索跟进到增长复盘。 \| 关键词线索培育 SOP 围绕关键词池、线索预检、人工筛选和跟进备注做稳态获客。 \| 活动获客复盘闭环 覆盖活动目标、素材检查、获客预演、线索分层和复盘沉淀。 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-desktop.png |
| PASS | 获客总览 laptop | required text visible: 增长获客总览 / 商用级增长底座 / 执行记录 / 线索池 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-laptop.png |
| FAILED | 获客总览 laptop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-laptop.png |
| PASS | 获客总览 laptop | interactive controls detected: 29 | - | - |
| PASS | 获客总览 laptop | no body-level horizontal overflow | - | - |
| FAILED | 获客总览 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 时间范围 近 7 天 \| 平台 全部平台 \| 任务 全部任务 \| 新增线索 0 查看明细 \| 已触达 0 查看明细 \| 高意向线索 0 查看明细 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-laptop.png |
| FAILED | 自动获客矩阵 laptop | missing required text: 执行计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-laptop.png |
| FAILED | 自动获客矩阵 laptop | missing expected table(s): 获客任务 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-laptop.png |
| PASS | 自动获客矩阵 laptop | interactive controls detected: 37 | - | - |
| PASS | 自动获客矩阵 laptop | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 获客玩法 关键词获客 \| 执行账号 优先选择在线正常账号 \| 执行风控 人工确认后触达 \| 线索去重 按昵称/主页/原文去重 \| 加入执行计划 仅手动确认 \| 任务状态 全部状态 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-laptop.png |
| PASS | 获客策略 laptop | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-laptop.png |
| PASS | 获客策略 laptop | interactive controls detected: 16 | - | - |
| PASS | 获客策略 laptop | no body-level horizontal overflow | - | - |
| FAILED | 获客策略 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 健康度 全部健康度 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-laptop.png |
| FAILED | 线索池 laptop | missing required text: 加入线索池 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-laptop.png |
| PASS | 线索池 laptop | expected tables visible: 线索池 | - | - |
| PASS | 线索池 laptop | interactive controls detected: 19 | - | - |
| PASS | 线索池 laptop | no body-level horizontal overflow | - | - |
| FAILED | 线索池 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 线索状态 全部状态 \| 平台 全部平台 \| 来源 全部来源 \| 跟进 全部意向 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-laptop.png |
| PASS | 账号健康 laptop | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/account-health-laptop.png |
| PASS | 账号健康 laptop | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 laptop | interactive controls detected: 11 | - | - |
| PASS | 账号健康 laptop | no body-level horizontal overflow | - | - |
| FAILED | 账号健康 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/account-health-laptop.png |
| PASS | 增长复盘 laptop | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-laptop.png |
| FAILED | 增长复盘 laptop | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-laptop.png |
| PASS | 增长复盘 laptop | interactive controls detected: 37 | - | - |
| PASS | 增长复盘 laptop | no body-level horizontal overflow | - | - |
| FAILED | 增长复盘 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 时间范围 近 7 天 \| 平台 全部平台 \| 任务 全部任务 \| 新增线索 0 查看明细 \| 已触达 0 查看明细 \| 高意向线索 0 查看明细 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-laptop.png |
| PASS | 增长工作流 laptop | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-laptop.png |
| PASS | 增长工作流 laptop | interactive controls detected: 18 | - | - |
| PASS | 增长工作流 laptop | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 laptop | button text wraps or becomes too tall: 大 大壮 高级版 phone-__REDACTED_TEST_USER__@kaypal.invalid \| 版本更新 v1.1.25 \| 模板 内容到获客闭环 \| 内容到获客闭环 已选模板 从内容准备、发布确认、获客预演、线索跟进到增长复盘。 \| 关键词线索培育 SOP 围绕关键词池、线索预检、人工筛选和跟进备注做稳态获客。 \| 活动获客复盘闭环 覆盖活动目标、素材检查、获客预演、线索分层和复盘沉淀。 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-laptop.png |
| PASS | 获客总览 narrow | required text visible: 增长获客总览 / 商用级增长底座 / 执行记录 / 线索池 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-narrow.png |
| FAILED | 获客总览 narrow | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-narrow.png |
| PASS | 获客总览 narrow | interactive controls detected: 27 | - | - |
| PASS | 获客总览 narrow | no body-level horizontal overflow | - | - |
| FAILED | 获客总览 narrow | button text wraps or becomes too tall: 时间范围 近 7 天 \| 平台 全部平台 \| 任务 全部任务 \| 新增线索 0 查看明细 \| 已触达 0 查看明细 \| 高意向线索 0 查看明细 \| 风险账号 0 查看明细 \| 候选线索 0 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/overview-narrow.png |
| FAILED | 自动获客矩阵 narrow | missing required text: 执行计划队列 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-narrow.png |
| FAILED | 自动获客矩阵 narrow | missing expected table(s): 获客任务 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-narrow.png |
| PASS | 自动获客矩阵 narrow | interactive controls detected: 35 | - | - |
| PASS | 自动获客矩阵 narrow | no body-level horizontal overflow | - | - |
| FAILED | 自动获客矩阵 narrow | button text wraps or becomes too tall: 获客玩法 关键词获客 \| 执行账号 优先选择在线正常账号 \| 执行风控 人工确认后触达 \| 线索去重 按昵称/主页/原文去重 \| 加入执行计划 仅手动确认 \| 任务状态 全部状态 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/acquisition-narrow.png |
| PASS | 获客策略 narrow | required text visible: 获客策略中心 / 行业 / 场景 / 搜索策略 / 健康度 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-narrow.png |
| PASS | 获客策略 narrow | interactive controls detected: 14 | - | - |
| PASS | 获客策略 narrow | no body-level horizontal overflow | - | - |
| FAILED | 获客策略 narrow | button text wraps or becomes too tall: 健康度 全部健康度 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/strategies-narrow.png |
| FAILED | 线索池 narrow | missing required text: 加入线索池 | 确认页面标题、核心模块和空状态文案仍符合增长计划。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-narrow.png |
| PASS | 线索池 narrow | expected tables visible: 线索池 | - | - |
| PASS | 线索池 narrow | interactive controls detected: 17 | - | - |
| PASS | 线索池 narrow | no body-level horizontal overflow | - | - |
| FAILED | 线索池 narrow | button text wraps or becomes too tall: 线索状态 全部状态 \| 平台 全部平台 \| 来源 全部来源 \| 跟进 全部意向 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/leads-narrow.png |
| PASS | 账号健康 narrow | required text visible: 账号健康中心 / 账号风控台 / 在线正常 / 需人工处理 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/account-health-narrow.png |
| PASS | 账号健康 narrow | expected tables visible: 账号健康 | - | - |
| PASS | 账号健康 narrow | interactive controls detected: 9 | - | - |
| PASS | 账号健康 narrow | no body-level horizontal overflow | - | - |
| PASS | 增长复盘 narrow | required text visible: 增长复盘 / 增长趋势 / 增长瓶颈诊断 / 任务表现 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-narrow.png |
| FAILED | 增长复盘 narrow | missing expected table(s): 执行记录 | 表格页必须保留可承载真实数据规模的表格外壳。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-narrow.png |
| PASS | 增长复盘 narrow | interactive controls detected: 35 | - | - |
| PASS | 增长复盘 narrow | no body-level horizontal overflow | - | - |
| FAILED | 增长复盘 narrow | button text wraps or becomes too tall: 时间范围 近 7 天 \| 平台 全部平台 \| 任务 全部任务 \| 新增线索 0 查看明细 \| 已触达 0 查看明细 \| 高意向线索 0 查看明细 \| 风险账号 0 查看明细 \| 候选线索 0 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/reports-narrow.png |
| PASS | 增长工作流 narrow | required text visible: 增长工作流 / 创建商用增长 SOP / 工作流名称 / 模板 | - | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-narrow.png |
| PASS | 增长工作流 narrow | interactive controls detected: 16 | - | - |
| PASS | 增长工作流 narrow | no body-level horizontal overflow | - | - |
| FAILED | 增长工作流 narrow | button text wraps or becomes too tall: 模板 内容到获客闭环 \| 内容到获客闭环 已选模板 从内容准备、发布确认、获客预演、线索跟进到增长复盘。 \| 关键词线索培育 SOP 围绕关键词池、线索预检、人工筛选和跟进备注做稳态获客。 \| 活动获客复盘闭环 覆盖活动目标、素材检查、获客预演、线索分层和复盘沉淀。 | 按钮文字必须一行显示，窄屏也不能挤成两行。 | docs/acceptance-evidence-2026-06-26/growth-acquisition-commercial-20260626-062131/screenshots/workflows-narrow.png |
| PASS | browser-console | No unexpected browser console errors captured. | - | - |

