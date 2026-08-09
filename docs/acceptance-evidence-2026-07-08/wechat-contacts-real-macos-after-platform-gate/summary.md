# Windows 微信联系人验收

- 证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-08/wechat-contacts-real-macos-after-platform-gate
- API：http://127.0.0.1:3011/api
- 模拟器：未启用
- 真实同步：已启用

- 生成时间：2026-07-08T21:44:12.467Z

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| readiness | passed | 00-readiness.json |
| contacts-before | passed | 01-contacts-before.json |
| contacts-random-sync | passed | 02-contacts-random-sync-result.json |
| contacts-all-sync | failed | 03-contacts-all-sync-result.json |
| contacts-after | passed | 04-contacts-after.json |
| contacts-export | passed | 05-contacts-export.json |
| contacts-diagnostics-export | passed | 06-contacts-diagnostics-export.json |

## 复跑命令

```bash
node scripts/wechat-windows-contacts-acceptance.mjs --real --base-url http://127.0.0.1:3011/api --evidence-dir "/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-07-08/wechat-contacts-real-macos-after-platform-gate"
```
