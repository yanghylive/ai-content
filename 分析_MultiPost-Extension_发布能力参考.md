# MultiPost-Extension 发布机制分析（JIUZHANG AI 发布中心参考）

> 来源：https://github.com/leaperone/MultiPost-Extension v1.4.4
> 本地克隆：`~/Documents/New project/MultiPost-Extension`（6.1MB，depth 1）
> 分析日期：2026-08-01

## 一句话结论

它不止是个发布工具，本质是**一套"网页安全调起本地浏览器能力"的开放协议 + 84 平台发布函数库**。发布只是其上的一类 action。对 JIUZHANG AI 最值钱的不是发布代码，而是这套协议——它正好解决我们"3010 网页怎么指挥本地浏览器/桌面 app"的问题。

## 核心发现（按价值排序，前两条是第一次没挖出来的）

### 1. 网页↔扩展通信协议（contents/extension.ts，90 行，最大价值）

任何网页只要 `window.postMessage` 发一个 `{type:"request", action:"MULTIPOST_XXX", traceId, data}`，扩展的内容脚本（注入所有页面、document_start）就会：
1. 校验 `event.origin` 是否在用户确认过的**信任域名白名单**里（不在 → 回 403）
2. 把消息转发给扩展 background（`chrome.runtime.sendMessage`）
3. background 执行完把结果按 `{type:"response", traceId, code:0, data}` 格式 postMessage 回网页

**这套机制等于给任何网页开了个"调本地浏览器"的 RPC 通道，且带用户授权。** 我们 JIUZHANG AI 完全可以用一模一样的模式：3010 网页 postMessage → 我们的桌面伴侣/扩展 → 调本地微信/浏览器发内容 → 结果回网页。安全模型（域名白名单 + 弹窗确认）它也做好了。

### 2. 信任域名授权 UX（background/services/trust-domain.ts）

- 网页首次请求 → 扩展弹一个 800x600 确认窗（`tabs/trust-domain.html#<base64参数>`）→ 用户点"信任"→ 域名进白名单（支持 `*.example.com` 通配）
- 之后该域名的请求直接放行
- 白名单存 `@plasmohq/storage` local 区，可列表可删
- **这就是我们要的"省心授权"**：不用用户手动配，首次弹个窗点一下就行——比让用户装证书/改配置低太多门槛

### 3. 文章采集器（contents/scraper/，之前完全没看到）

它能**从已有文章页反向抓取内容**变成可发布的 ArticleData：
- `wechat.ts`：从公众号文章页提 `#activity-name`(标题) / `#js_content`(正文) / og:image(封面) / og:description(摘要)，还专门清理微信代码块的行号
- `preprocessor.ts`：通用清洗——img 的 `data-src`→`src`（懒加载图）、video→封面图、去 style/script/svg、加 `referrerpolicy=no-referrer`（防图片防盗链）
- 已做：知乎/简书/掘金/CSDN/公众号
- **对我们的意义**：做"采集别人的文 → 改写 → 多发"链路时，采集端的坑它也趟完了

### 4. 发布中枢页（tabs/publish.tsx，750 行）

一个独立 tab 做"发布指挥中心"：收 SyncData → 预处理（把内容里的远程图片全抓下来转 blob URL，解决跨域/防盗链）→ 为每个平台开 tab 注入发布函数 → 标签自动编组 → 倒计时自动关闭。图片预处理这块（远程图转本地 blob 再注入）是我们发内容时必踩的坑。

### 5. 84 平台发布函数 + 注册表（第一次已分析，从略）

- 公众号走后台 cgi-bin API（token 提取+上传+裁剪+发布，直接可搬）
- 小红书/抖音/微博走 DOM 模拟（平台改版即断，只挑头部参考）
- 视频号要穿透 wujie 微前端 shadow DOM

### 6. 账号识别（sync/account/，16 个平台）

每个平台一个 `getAccountInfo()`，从已登录页面抓取用户名/头像/账号 ID，汇总进注册表。发布前可展示"将发到哪些账号"。

### 7. 对外开放的完整能力清单（18 个 action，回答"就这些了吗"）

任意网页通过 postMessage 能调用的全部能力（不只是"发布"）：

| 类别 | action | 干什么 |
|---|---|---|
| 状态 | CHECK_SERVICE_STATUS | 探活：网页先问"扩展在不在"，返回 extensionId |
| 发布 | PUBLISH | 提交 SyncData → 弹 800x600 发布中枢窗 |
| 发布 | PUBLISH_NOW | 中枢窗里确认后真正执行：开各平台 tab 注入 |
| 发布 | PUBLISH_REQUEST_SYNC_DATA | 中枢窗向 background 要回刚提交的数据 |
| 平台 | PLATFORMS | 列出全部支持的平台（含账号信息） |
| 账号 | GET_ACCOUNT_INFOS | 读所有平台已登录账号 |
| 账号 | REFRESH_ACCOUNT_INFOS | 弹窗后台批量刷新各平台登录态 |
| 采集 | REQUEST_SCRAPER_START | 从当前文章页抓内容 |
| 信任 | REQUEST_TRUST_DOMAIN | 网页申请加入白名单（弹确认窗） |
| 信任 | GET/DELETE_TRUSTED_DOMAIN(S) | 白名单增删查 |
| 配对 | LINK_EXTENSION(+CONFIRM) | 网页拿 apiKey 与扩展配对（云端 API 模式） |
| 窗口 | TABS_MANAGER_* | 发布开的 tab 编组/查询/关闭 |
| 其他 | OPEN_OPTIONS / PUBLISH_RELOAD | 开设置页 / 重载 |

**关键洞察**：这是一套"网页作为控制台、扩展作为本地执行器"的完整协议。发布只是 18 个 action 里的 2 个。我们照这套做，3010 网页能指挥本地做的事远不止发内容——探活、读账号、刷新登录态、采集、窗口管理全都现成。

## 对 JIUZHANG AI 的落地建议（修订版）

1. **最高优先：整套通信协议 + 18 action 框架照搬**（第 1、2、7 条）。3010 网页 = 控制台，桌面伴侣/扩展 = 本地执行器，postMessage + 域名白名单 + 弹窗授权。发布只是其中 2 个 action，探活/读账号/刷新登录态/采集/窗口管理都能复用同一框架
2. **公众号发布直接搬**（cgi-bin API 路径全在 `dynamic/weixin.ts`）
3. **采集端参考 scraper/**（如果做"采集-改写-多发"）
4. **发布函数注册表模式**（新平台 = 加一个文件注册一行）
5. 图片预处理（远程图→blob）参考 publish.tsx

## 风险提示

- DOM 模拟的平台维护成本高（平台改版即断），只挑头部 5-8 个做
- Apache-2.0 许可证，允许闭源商用；复制或修改代码时必须保留许可证/NOTICE（如有）并标注变更。协议思想和事实性的接口路径可独立实现
