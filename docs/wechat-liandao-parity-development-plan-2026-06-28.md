# 微信任务打平/超越炼刀开发文档

日期：2026-06-28

适用范围：`/workbench/wechat` 微信任务、联系人同步、会话历史、群发、加好友、朋友圈发布、朋友圈营销、本地助手、安装包与发布门禁。

结论先写清楚：当前系统还没有打平炼刀。我们已经补了页面、合同、诊断、任务记录、安装包资源门禁和部分联系人同步保护，但真正差距在 Windows 本地微信执行内核。后续开发必须围绕这个内核推进，不能再用页面 smoke 或模拟器通过来替代真实 Windows 微信验收。

## 1. 背景

用户反馈集中在这些问题：

- Windows 10 / Windows 11 真机微信通讯录同步失败、数量波动、误报成功。
- 同步全部好友时，微信界面显示 788 个联系人，但系统只读到 1 个、6 个或 7 个。
- 加好友、群发、朋友圈发布、朋友圈营销等任务页面存在，但很多动作没有达到商用稳定执行。
- 打包和 OSS 发布过早，版本号提升了，但核心微信能力没有同步打平。
- 用户要求对齐炼刀，而不是只做诊断解释。

这份文档的目的：

- 把炼刀已经确认具备的能力记录下来。
- 把我们当前已做和未做的边界写死。
- 明确后续自研 Windows 微信 native runtime 的架构。
- 明确每个阶段的验收标准。
- 防止后续再把“页面能点”“接口没崩”“模拟器通过”误认为“商用通过”。

## 2. 已确认事实

### 2.1 炼刀安装包确认具备的能力

从 `/Users/yanghy/Desktop/炼刀/dt-ai-helper-1.8.5.exe` 拆包和字符串检查，确认炼刀安装包包含：

- `resources/app.asar`
- `resources/app.asar.unpacked/resources/main.exe`
- `resources/app.asar.unpacked/resources/_internal/resources/libs/wx_key.dll`
- `resources/app.asar.unpacked/resources/_internal/sqlcipher3/_sqlite3.cp312-win_amd64.pyd`
- `resources/app.asar.unpacked/resources/_internal/python3.dll`
- `resources/app.asar.unpacked/resources/_internal/python312.dll`
- `resources/app.asar.unpacked/resources/_internal/win32/win32api.pyd`
- `resources/app.asar.unpacked/resources/_internal/win32/win32gui.pyd`
- `resources/app.asar.unpacked/resources/_internal/win32/win32process.pyd`
- `resources/app.asar.unpacked/node_modules/@computer-use/libnut/.../libnut-win32`
- `resources/app.asar.unpacked/resources/_internal/cv2`
- `resources/app.asar.unpacked/resources/_internal/scripts/wechat_ocr/wechat_icon/*`
- `resources/elevate.exe`
- `electron-updater`

`wx_key.dll` 字符串中确认出现：

- `ReadProcessMemory`
- `NtReadVirtualMemory`
- `NtWriteVirtualMemory`
- `NtAllocateVirtualMemory`
- `NtProtectVirtualMemory`
- `Weixin.dll`
- `wx_key.dll`

`main.exe` 字符串中确认出现：

- `scripts.wechat.WeChatKeyDumper`
- `scripts.wechat.WechatDb`
- `scripts.wechat.ContactManager`
- `scripts.wechat.ChatHistoryManager`
- `scripts.wechat.WechatAutomation`
- `scripts.automation.actions.AddWechatContactManager`
- `scripts.automation.actions.CheckNewContactManager`
- `scripts.automation.actions.ProcessWechatMsgManager`
- `scripts.wechat_ocr.WeChatOCRInstaller`
- `scripts.wechat_ocr.WechatOcrService`
- `scripts.wechat_ocr.contact_ocr_manager`
- `sqlcipher3`

基于这些证据，可以确认炼刀至少具备这些方向的本地能力：

- 微信进程/数据库 key 获取能力。
- 加密微信数据库读取能力。
- 联系人管理能力。
- 聊天历史管理能力。
- 微信自动化控制能力。
- 加好友动作管理能力。
- 新联系人检查能力。
- 消息处理能力。
- 微信 OCR 与模板识别能力。
- Windows 桌面控制、截图、图像识别、权限提升和自动更新能力。

注意：这里只记录能力边界，不复制、不反编译、不搬运炼刀代码。我们后续必须自研等价能力。

### 2.2 我们当前确认具备的能力

当前系统已经具备：

- 微信任务页面：普通群发、添加好友、朋友圈批量发布、朋友圈营销、联系人管理、会话历史、执行策略。
- 联系人管理：随机/全部同步选项、手动新增、编辑、删除、清空、导出。
- 联系人同步诊断：平台、窗口、数据库、helper、UIA/OCR 分层诊断。
- 失败保护：低置信同步拒绝覆盖缓存，本机权限/窗口错误不再伪成功。
- 任务记录：计划创建、对象明细、暂停、恢复、删除、重发、诊断导出部分已接入。
- 统一命令合同：`contacts`、`group-broadcast`、`contact-add`、`moments-publish`、`moments-marketing`、`chat-history` 已定义合同。
- 安装包资源：Node runtime、Playwright、`sqlite3.exe`、`wechat-native-runtime`、`wechat-engine`、`elevate.exe`、自动更新配置。

关键代码位置：

- `desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js`
- `desktop/runtime/wechat-native-runtime/README.md`
- `desktop/runtime/wechat-engine/kaypal-wechat-engine.js`
- `desktop/runtime/wechat-engine/README.md`
- `desktop/runtime/wechat-db-helper/README.md`
- `backend/src/modules/local-engine/local-engine.service.ts`
- `backend/src/modules/local-engine/wechat-native-command.contract.ts`
- `backend/src/modules/runtime/node-agent-runtime/node-agent-runtime.service.ts`
- `frontend/src/app/(dashboard)/workbench/wechat/wechat-workbench-client.tsx`
- `docs/liandao-wechat-acceptance-matrix.md`
- `docs/liandao-wechat-field-map.md`

### 2.3 我们当前没有打平的事实

当前系统没有打平炼刀，具体是：

- 没有内置等价 `wx_key.dll` / key dumper / SQLCipher helper。
- `wechat-db-helper` 安装包里只确认带了 `sqlite3.exe` 和 README，不是完整解密 helper。
- `wechat-native-runtime` 现在主要是联系人同步 runtime，不是完整六类微信任务 native runner。
- `wechat-engine` README 明确写着以后才加 `kaypal-wechat-engine.exe`、native DLL、图标/模板资产。
- `wechat-native-command.contract.ts` 是合同边界，不是实际 Windows 执行器。
- 会话历史当前仍有“真实微信 DB/RPA/OCR 同步接口已预留但未接入成熟采集器”的 blocker。
- 群发、加好友、朋友圈发布、朋友圈营销很多执行路径仍依赖脚本适配，仓库里的对应脚本主要是 macOS AppleScript 方案。
- Windows 真机验收没有达到 Day 12 标准，不能说商用通过。

## 3. 根因复盘

### 3.1 之前为什么没有打平

主要错误：

- 把页面和 API 合同当成了本地微信能力。
- 把模拟器和静态 smoke 当成了 Windows 真机验收。
- 先修诊断、提示、失败保护和安装包，而不是先补 Windows native 微信内核。
- 没有把 DB 解密读取作为联系人同步的硬门槛。
- 没有把“动作后读回”和“对象级证据”作为所有微信任务的必过标准。
- 打包上传太早。

### 3.2 后续必须坚持的原则

- 不再说“打平”，除非 Windows 10 和 Windows 11 真机全流程通过。
- 不再把“任务已创建”当成“任务已执行”。
- 不再把“同步拿到少量联系人”当成“通讯录同步成功”。
- 不再把“诊断能解释失败”当成“功能已修好”。
- 不再把“页面 smoke 通过”当成“商用通过”。
- 不复制炼刀代码，只自研等价实现。

## 4. 当前差距清单

### 4.1 P0 差距：不补不能商用

| 差距 | 炼刀状态 | 我们状态 | 影响 | 必须补到什么程度 |
| --- | --- | --- | --- | --- |
| 微信 DB key 获取 | 有 `wx_key.dll`、`WeChatKeyDumper` 迹象 | 无内置等价 helper | 加密 DB 读不了，联系人/聊天历史只能靠 UIA/OCR | 自研 key helper，能稳定返回 key 或明确 blocked |
| SQLCipher 解密读库 | 有 `sqlcipher3` | 只带 `sqlite3.exe`，缺完整 SQLCipher helper | `encrypted-or-locked` 场景无法稳定读取 | 自研 SQLCipher reader，能读联系人和消息库 |
| 联系人全量同步 | 有 DB + UI/OCR 多路 | UIA/OCR 易低置信，数量波动 | 用户 788 个联系人只读 1/7 个 | DB 优先，UIA/OCR 校验兜底，数量稳定 |
| 聊天历史 | 有 `ChatHistoryManager` | 当前主要是联系人缓存生成会话入口 | CRM 闭环不完整 | 真实读取会话列表和消息正文 |
| Windows 任务执行器 | 有 Python/pywin32/libnut/cv2/OCR | 合同完整，Windows 实执行不足 | 群发、加好友、朋友圈任务不稳 | 六类命令都有 native runner |
| 动作读回 | 炼刀疑似有 OCR/模板和状态检查 | 我们部分有截图/诊断，不完整 | 容易假成功 | 每个对象必须有 action -> readback -> evidence |
| 真机验收 | 作为成熟产品应有稳定路径 | 目前没有完整通过 | 打包会反复被用户打回 | Win10/Win11 全流程证据包 |

### 4.2 P1 差距：影响稳定性

- 微信窗口状态机不够强，容易识别错页面。
- UIA 滚动容器识别不稳定。
- 多显示器、高 DPI、输入法、管理员权限、微信版本差异处理不足。
- OCR/模板资产太少，没有炼刀那种多版本图标模板。
- 失败后恢复策略不够完整。
- 任务执行中断后 resume checkpoint 不够细。
- 当前微信号和计划微信号的强绑定还要覆盖所有任务。
- 本地助手运行检查项还要更细，不能只显示“已连接”。

### 4.3 P2 差距：影响体验和交付

- 前端诊断太多时页面压迫感强，需要分层折叠。
- 商用准备页、运行检查页、微信任务页之间的信息还没有完全一致。
- 错误 toast 有时过长，需要转成诊断卡片。
- OSS 发布门禁需要和真机证据绑定。
- 自动更新存在，但必须绑定稳定包，不能推送半成品。

## 5. 目标架构

### 5.1 总体架构

目标不是再堆脚本，而是形成一条稳定链路：

```text
前端微信任务页
  -> 后端 local-engine API
  -> WeChat native command contract
  -> Windows native runtime
  -> DB reader / UIA controller / OCR controller / evidence recorder
  -> 结构化结果
  -> 任务记录 / 联系人库 / 会话历史 / 诊断导出 / 证据回放
```

### 5.2 Windows native runtime 分层

建议拆成 6 层：

1. `platform`：系统、权限、管理员、DPI、多显示器、输入法、窗口枚举。
2. `wechat-process`：识别微信进程、版本、路径、窗口句柄、当前账号。
3. `wechat-db`：定位 DB、获取 key、解密读取、SQL 查询、字段归一化。
4. `wechat-ui`：UIA 控件树、窗口焦点、点击、输入、滚动、文件选择器。
5. `wechat-ocr`：截图、模板匹配、文字 OCR、风险弹窗识别、按钮状态识别。
6. `evidence`：动作前截图、动作后截图、读回文本、失败原因、可导出诊断包。

### 5.3 命令合同

所有 Windows 微信命令必须走统一合同，不允许各功能私自 spawn 零散脚本。

命令列表：

- `contacts`
- `chat-history`
- `group-broadcast`
- `contact-add`
- `moments-publish`
- `moments-marketing`

每个命令必须返回：

- `ok`
- `status`
- `errorCode`
- `message`
- `source`
- `items/results`
- `diagnostics`
- `evidence`
- `startedAt`
- `finishedAt`
- `durationMs`
- `account`
- `wechatVersion`

失败也必须返回 JSON，不允许裸抛 PowerShell、sqlite、Node 或系统异常。

## 6. 自研实现路线

### 6.1 第一阶段：联系人 DB helper

目标：先解决“788 个联系人只读 1 个”的根问题。

任务：

- 实现 Windows helper 可执行文件，例如 `kaypal-wechat-db-helper.exe`。
- helper 支持 `contacts --mode random|all`。
- helper 支持 `diagnose`。
- helper 支持稳定 JSON stdin/stdout 合同。
- 内置 SQLCipher 或可加载 SQLCipher。
- 读取微信 DB 路径。
- 获取或接收 DB key。
- 查询联系人表。
- 输出 `wxid`、昵称、备注、别名、标签、来源、同步时间。
- 对 encrypted/locked/key-missing/db-busy/version-unsupported 给明确错误码。

验收：

- Windows 10 真机，同一微信账号连续 3 次 all，同步数量波动不超过 5%。
- Windows 11 真机，同一微信账号连续 3 次 all，同步数量波动不超过 5%。
- 如果 DB 仍不可读，必须明确返回 `db_key_missing` 或 `db_locked`，不能假成功。

### 6.2 第二阶段：联系人 UIA/OCR 兜底

目标：DB 失败时，UIA/OCR 能可靠辅助，不污染数据。

任务：

- 联系人页状态机：未打开微信、未登录、不是主窗口、不是通讯录、不是联系人列表、已到顶部、已到底部。
- UIA 识别联系人列表容器。
- OCR 识别联系人名称和分组标题。
- 滚动过程记录页号、首尾联系人、重复页、停止原因。
- 低置信规则：
  - all 模式只读到少量联系人且 UIA stopReason 异常，必须失败。
  - 识别到网页、抖音、发布中心、3010 页面，必须拒绝。
  - 与 DB/cache 差异过大，必须要求确认或降级为诊断。

验收：

- 用户有 700+ 联系人时，不能返回 1 个还提示成功。
- UIA/OCR fallback 失败时保留原联系人缓存。
- 诊断导出能看到每一页扫描结果。

### 6.3 第三阶段：聊天历史

目标：补齐炼刀 `ChatHistoryManager` 对应能力。

任务：

- 同步会话列表。
- 读取指定会话最近 N 条消息。
- 支持文本、图片、文件、系统消息基本分类。
- 消息包含方向、发送人、时间、内容、来源。
- DB 读不到时，可通过当前会话 UIA/OCR 只读采集。
- 严禁用联系人缓存伪造成聊天历史。

验收：

- 真实微信测试会话最近 20 条消息与人工抽样一致。
- 空会话返回 empty，不返回假数据。
- DB/RPA/OCR 都不可用时返回 blocked 和 nextAction。

### 6.4 第四阶段：群发任务

目标：从“创建群发计划”变成“真实可控群发”。

任务：

- 目标解析：联系人、群聊、标签、手动列表。
- 每日上限、发送间隔、分段发送。
- 对象级状态：pending/running/approval/success/failed/skipped/cancelled。
- 支持暂停、恢复、删除、重发。
- 受控模式停在发送前。
- 自动模式必须读回发送结果。
- 附件路径校验和文件选择器处理。

验收：

- 测试联系人和测试群各至少 2 个目标。
- 暂停后不继续后续对象。
- 恢复后从 checkpoint 继续。
- 每个目标有截图/事件证据。

### 6.5 第五阶段：加好友任务

目标：稳定搜索、填写验证语、处理风控。

任务：

- 支持手机号/微信号/备注名输入。
- 搜索结果唯一性判断。
- 目标不存在、目标歧义、已是好友、被限制、验证码、风控弹窗都要识别。
- 验证语输入和读回。
- 备注策略和标签。
- 黑名单跳过。
- 每日上限和间隔。

验收：

- 目标缺失不抛 runtime error。
- 黑名单必跳过并记录原因。
- 风控弹窗必 blocked，不继续批量执行。
- 验证语读回一致。

### 6.6 第六阶段：朋友圈发布

目标：支持真实发布或受控确认。

任务：

- 文案输入。
- 图片/视频/文件路径校验。
- 文件选择器适配 Windows 10/11。
- 可见范围。
- 定时/立即执行。
- 发布前截图、发布后截图/读回。
- 素材缺失、格式不支持、数量超限时阻断。

验收：

- 素材缺失不能创建可执行任务。
- 受控模式停在发表前。
- 自动模式必须确认发布成功或明确失败。

### 6.7 第七阶段：朋友圈营销

目标：支持随机/定向浏览、点赞、评论、AI 评论。

任务：

- 随机浏览联系人朋友圈。
- 定向进入指定好友朋友圈。
- 点赞、评论、点赞+评论。
- AI 评论生成和固定评论。
- 评论框定位、发送按钮识别。
- 已点赞/不可评论/权限不可见/内容为空的跳过逻辑。
- 每条动态留证。

验收：

- random 模式按浏览数停止。
- targeted 模式按联系人停止。
- 评论内容和实际发送内容一致。
- 无权限、不可见、风控时 blocked/skipped 清晰。

### 6.8 第八阶段：运行检查和权限检测

目标：用户点同步前就知道为什么不能跑。

运行检查必须覆盖：

- 本地助手进程。
- Windows 版本。
- 管理员权限。
- 微信进程。
- 微信窗口句柄。
- 微信登录状态。
- 当前微信号。
- DB 路径。
- DB 加密状态。
- helper 状态。
- UIA 可用性。
- OCR 可用性。
- DPI/缩放。
- 多显示器。
- 输入法状态。
- 文件访问权限。
- 自动更新状态。

验收：

- `/local-engine` 运行检查项和 `/workbench/wechat` 诊断卡片口径一致。
- 每个阻断项都有下一步动作。
- 检查不通过时禁止执行高风险任务。

## 7. 12 天节奏重新定义

原 12 天节奏保留，但要调整为“native 优先”：

| 天数 | 目标 | 通过标准 |
| --- | --- | --- |
| Day 1 | 合同、诊断、发布门禁、smoke 底座 | 已完成，但不能当成打平 |
| Day 2 | 联系人 DB helper 原型 | Win10/Win11 能识别 DB/key/helper 状态，不假成功 |
| Day 3 | 联系人 random/all 真机稳定 | 3 次数量稳定，失败有诊断 |
| Day 4 | 群发 native runner | 测试对象可控发送，暂停/恢复有效 |
| Day 5 | 加好友 native runner | 目标缺失、黑名单、风控、验证语全可控 |
| Day 6 | 朋友圈发布 native runner | 素材校验、受控发布、证据留存 |
| Day 7 | 朋友圈营销 native runner | random/targeted、点赞/评论、证据留存 |
| Day 8 | 会话历史 DB/UIA/OCR 同步 | 会话和消息正文真实可读 |
| Day 9 | 任务记录、失败证据、诊断导出闭环 | 每个对象有状态和证据 |
| Day 10 | 异常恢复、权限检测、微信窗口状态检测 | 运行检查覆盖所有阻断项 |
| Day 11 | 完整安装包、自动更新、OSS 发布门禁 | 包内资源完整，未过真机不准上传 |
| Day 12 | Win10/Win11 全流程验收 | P0/P1 为 0，再上传 OSS |

## 8. 验收标准

### 8.1 不能算通过的情况

这些都不能算通过：

- 只创建任务，没有真实执行。
- 只拿到 1 个联系人，就提示“全部好友已同步”。
- 只跑 macOS AppleScript，没跑 Windows。
- 只跑模拟器，没跑真机。
- 只跑页面 smoke，没跑微信真机。
- 只返回诊断，没有修通执行能力。
- 打包成功，但核心 helper 缺失。
- 上传 OSS，但没有 Win10/Win11 证据。

### 8.2 联系人同步通过标准

random 模式：

- 能读取当前微信通讯录可见/随机联系人。
- 不采集浏览器、抖音、3010 页面。
- 至少返回结构化字段。
- 失败时保留旧缓存。

all 模式：

- DB helper 优先。
- UIA/OCR fallback 必须有页数、停止原因、低置信判断。
- 同账号连续 3 次数量波动不超过 5%。
- 对 700+ 联系人不能低置信误报成功。

### 8.3 群发通过标准

- 支持测试联系人和测试群。
- 受控模式停在发送前。
- 自动模式有发送后读回。
- 暂停后不继续。
- 恢复后从 checkpoint 继续。
- 每个对象有执行证据。

### 8.4 加好友通过标准

- 目标缺失不崩。
- 验证语可读回。
- 黑名单跳过。
- 风控/验证码 blocked。
- 每日上限生效。
- 每个目标有证据。

### 8.5 朋友圈发布通过标准

- 素材路径真实存在。
- 格式和数量校验。
- 文件选择器可控。
- 受控/自动模式明确。
- 发表结果可读回。

### 8.6 朋友圈营销通过标准

- random/targeted 都可执行。
- 点赞/评论/点赞+评论都有对象级记录。
- AI 评论和固定评论都可用。
- 不可评论、已点赞、权限不可见要跳过并记录。

### 8.7 会话历史通过标准

- 会话列表真实读取。
- 指定会话最近消息真实读取。
- 消息正文不能伪造。
- blocked/empty/error 语义清晰。

## 9. 发布门禁

### 9.1 打包前门禁

必须通过：

- 后端类型检查。
- 前端类型检查。
- 单元测试。
- `liandao-wechat-smoke.mjs`。
- `wechat-windows-contacts-acceptance.mjs --real`。
- Win10 真机联系人 random/all。
- Win11 真机联系人 random/all。
- 六类微信任务至少测试账号闭环。
- 安装包资源检查。
- 自动更新 feed 检查。

### 9.2 OSS 上传门禁

满足以下条件才允许上传：

- P0 = 0。
- P1 = 0。
- P2 有 owner、规避方案、复测日期。
- 版本号已更新。
- 安装包内包含完整 runtime/helper/assets。
- 更新 feed 指向新版本。
- Win10/Win11 验收报告已归档。

### 9.3 发布后门禁

发布后必须做：

- 新安装验证。
- 覆盖安装验证。
- 自动更新验证。
- 登录后运行检查验证。
- 联系人同步验证。
- 失败诊断导出验证。

## 10. 证据目录规范

每次真机验收必须落盘：

```text
docs/acceptance-evidence-YYYY-MM-DD/wechat-liandao-parity-版本号/
  00-environment.md
  01-local-engine-readiness.json
  02-wechat-window-state.json
  03-contacts-random-result.json
  04-contacts-all-result.json
  05-contacts-export.json
  06-chat-sessions.json
  07-chat-history-sample.json
  08-group-broadcast-result.json
  09-contact-add-result.json
  10-moments-publish-result.json
  11-moments-marketing-result.json
  12-diagnostics-export.json
  13-installer-resource-check.json
  14-oss-update-feed-check.json
  screenshots/
  summary.md
```

`summary.md` 必须写：

- 测试系统。
- 微信版本。
- 当前微信账号。
- 联系人数人工观察值。
- 同步结果数量。
- 失败项。
- 是否允许发布。

## 11. 不复制炼刀的实现原则

可以参考：

- 能力边界。
- 模块拆分。
- 验收思路。
- 需要覆盖的微信页面状态。
- 需要打包的运行时类型。

不能做：

- 复制炼刀代码。
- 反编译炼刀业务逻辑后照搬。
- 直接使用炼刀 DLL。
- 用炼刀私有资源作为我们安装包的一部分。

必须做：

- 自研 key/helper/runtime。
- 自研 UIA/OCR 控制器。
- 自研模板资产或运行时识别规则。
- 保留许可和来源记录。

## 12. 开发任务拆分

### 12.1 Native helper 任务

- [ ] 设计 `kaypal-wechat-db-helper/v1` 最终 JSON 合同。
- [ ] 实现 Windows helper 可执行文件。
- [ ] 支持 `diagnose`。
- [ ] 支持 `contacts --mode random|all`。
- [ ] 支持 DB key 获取或 key 注入。
- [ ] 支持 SQLCipher 解密。
- [ ] 支持联系人字段归一化。
- [ ] 支持错误码和诊断导出。
- [ ] 打包进 `resources/wechat-db-helper`。
- [ ] 写安装包资源门禁。

### 12.2 Native command runner 任务

- [ ] 实现统一 runner 入口。
- [ ] 接入 `contacts`。
- [ ] 接入 `chat-history`。
- [ ] 接入 `group-broadcast`。
- [ ] 接入 `contact-add`。
- [ ] 接入 `moments-publish`。
- [ ] 接入 `moments-marketing`。
- [ ] 所有命令返回统一 JSON。
- [ ] 所有命令支持 timeout、cancel、checkpoint。

### 12.3 UIA/OCR 任务

- [ ] 微信窗口发现。
- [ ] 通讯录页识别。
- [ ] 联系人列表滚动容器识别。
- [ ] 聊天窗口识别。
- [ ] 搜索框识别。
- [ ] 发送按钮识别。
- [ ] 朋友圈入口识别。
- [ ] 评论框识别。
- [ ] 风控/验证码/权限弹窗识别。
- [ ] 多 DPI、多显示器适配。
- [ ] 模板资产管理。

### 12.4 后端任务

- [ ] local-engine 调用 native runner，不再绕散脚本。
- [ ] 联系人同步 DB 优先，UIA/OCR fallback。
- [ ] 聊天历史从真实 reader 接入。
- [ ] 群发对象级状态。
- [ ] 加好友对象级状态。
- [ ] 朋友圈发布对象级状态。
- [ ] 朋友圈营销对象级状态。
- [ ] 统一错误码。
- [ ] 统一诊断导出。
- [ ] 统一证据记录。

### 12.5 前端任务

- [ ] `/workbench/wechat` 显示真实 runtime 状态。
- [ ] 联系人同步显示 random/all 真实结果。
- [ ] 低置信结果不显示成功 toast。
- [ ] 诊断卡片可折叠、可导出。
- [ ] 六类任务按钮禁用状态和原因一致。
- [ ] 运行检查页和微信任务页口径一致。
- [ ] 错误 toast 不塞长堆栈。
- [ ] 计划列表对象级状态可见。

### 12.6 QA/发布任务

- [ ] Win10 真机环境。
- [ ] Win11 真机环境。
- [ ] 测试微信账号。
- [ ] 测试联系人。
- [ ] 测试群。
- [ ] 测试朋友圈素材。
- [ ] 真机验收脚本。
- [ ] 证据目录归档。
- [ ] 安装包资源检查。
- [ ] OSS 上传检查。
- [ ] 自动更新检查。

## 13. 错误码规范

建议统一错误码：

```text
success
runtime_unavailable
unsupported_platform
wechat_not_running
wechat_not_logged_in
wechat_window_not_found
wechat_wrong_page
permission_missing
admin_required
db_not_found
db_locked
db_encrypted
db_key_missing
db_decrypt_failed
helper_missing
helper_failed
uia_unavailable
uia_low_confidence
ocr_unavailable
ocr_low_confidence
target_missing
target_not_found
target_ambiguous
content_invalid
media_missing
captcha_required
risk_prompt_detected
rate_limited
send_failed
readback_failed
cancelled
timeout
unknown
```

所有错误码必须有：

- 用户可读中文说明。
- 技术详情。
- 下一步建议。
- 是否可重试。
- 是否可继续后续对象。

## 14. 运行检查页修复要求

`/local-engine` 必须成为商用运行前检查页，不只是状态展示。

检查项分三类：

### 14.1 必须通过

- 本地助手已连接。
- Windows 系统支持。
- 微信进程存在。
- 微信已登录。
- 能识别微信窗口。
- 当前微信号可读。
- DB/helper/UIA/OCR 至少一条链路可用。

### 14.2 警告但可继续

- 非管理员运行。
- 多显示器。
- 高 DPI 缩放。
- 输入法可能影响输入。
- DB 加密但 UIA/OCR 可用。

### 14.3 阻断执行

- 未登录微信。
- 没有微信窗口。
- 不能读 DB，也不能 UIA/OCR。
- 当前微信号和计划微信号不一致。
- 风控/验证码弹窗。
- 助手版本过低。

## 15. 验收命令

静态合同检查。只能证明接口、页面合同、脚本入口和文档矩阵存在；不能作为商用通过或 Windows 真机通过：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content
node scripts/liandao-wechat-smoke.mjs
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

模拟器联系人。只能验证 random/all 合同、导出和诊断链路；不能上传正式 Windows 包：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content
node scripts/wechat-windows-contacts-acceptance.mjs --simulator --base-url http://127.0.0.1:3011
```

Windows 真机联系人。必须在已登录桌面微信的 Win10/Win11 上分别跑，证据目录不能带 `simulator`：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content
WECHAT_ACCEPT_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win10 \
  node scripts/wechat-windows-contacts-acceptance.mjs --real --base-url http://127.0.0.1:3011

WECHAT_ACCEPT_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win11 \
  node scripts/wechat-windows-contacts-acceptance.mjs --real --base-url http://127.0.0.1:3011
```

严格真机 smoke。用于 Day 12，blocked 也会失败：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content
LIANDAO_SMOKE_LIVE=1 LIANDAO_SMOKE_STRICT_LIVE=1 LIANDAO_SMOKE_REAL_WECHAT=1 node scripts/liandao-wechat-smoke.mjs
```

打包资源门禁。只检查包内资源和本地 artifact，不代表商用真机通过：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
BUILD_PLATFORM=win-x64 npm run check:commercial-assets
BUILD_PLATFORM=win-x64 npm run check:full-installer-assets:pre
npm run build:win
npm run release:verify
```

正式 Windows 商业发布门禁。没有 real-windows 证据会输出 `BLOCKER real-windows` 并失败；模拟器和静态 smoke 只会按自己的层级展示：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
WINDOWS_GATE_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD \
WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win10 \
WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/account-binding-win10.md \
WINDOWS_GATE_GROWTH_SEND_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/growth-send-readback-win10.md \
  npm run check:win-commercial-release
```

正式上传 OSS 必须走 `npm run release`，并带同一组真机证据环境变量。不要用 `npm run upload:oss` 绕过门禁上传正式 Windows 包：

```bash
cd /Users/yanghy/Documents/New\ project/ai-content/desktop
RELEASE_TARGETS=win \
WINDOWS_GATE_EVIDENCE_DIR=docs/acceptance-evidence-YYYY-MM-DD \
WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/windows-wechat-contacts-win10 \
WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/account-binding-win10.md \
WINDOWS_GATE_GROWTH_SEND_EVIDENCE=docs/acceptance-evidence-YYYY-MM-DD/growth-send-readback-win10.md \
  npm run release
```

注意：只有静态、模拟器、包资源门禁通过仍不等于商用通过。商用通过必须看 Win10/Win11 真机证据目录；证据缺失时门禁只能是 blocked。

## 16. 完成定义

真正可以说“打平炼刀”的条件：

- 联系人同步 random/all 在 Win10/Win11 真实微信通过。
- 联系人数量稳定，不再误报少量联系人成功。
- 加密 DB 有内置 helper 处理，不能只提示 helper missing。
- 聊天历史真实可读，不再用联系人缓存伪会话。
- 群发、加好友、朋友圈发布、朋友圈营销都有 Windows native runner。
- 每个任务对象有状态、读回和证据。
- `/local-engine` 能提前告诉用户为什么不能跑。
- 安装包内完整带 runtime/helper/assets。
- 自动更新可用。
- OSS 发布前有完整证据包。
- P0/P1 为 0。

真正可以说“超越炼刀”的条件：

- 失败诊断比炼刀更清楚。
- 每个动作都有证据回放。
- 任务可以暂停/恢复/重试。
- 计划关联微信号强校验。
- 自动更新和发布门禁强绑定。
- CRM/线索池能吃到微信任务结果。
- 商用验收脚本可复跑。

## 17. 当前下一步

不要继续优先改页面细节。下一步优先级：

1. 自研 Windows `kaypal-wechat-db-helper.exe`。
2. SQLCipher 解密和联系人 DB 读取。
3. 联系人 all 模式 Win10/Win11 稳定。
4. 会话历史真实读取。
5. 六类微信 native runner。
6. 全任务对象级证据闭环。
7. 安装包和 OSS 发布门禁。

如果没有完成第 1 到第 3 项，不允许再说联系人同步打平。
如果没有完成第 1 到第 6 项，不允许再说微信任务打平。
如果没有完成第 1 到第 7 项，不允许上传正式安装包给用户。
