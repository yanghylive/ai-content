# Windows 微信联系人验收

- 证据目录：/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-06-29/windows-wechat-contacts-simulator
- API：http://127.0.0.1:3011
- 模拟器：已启用
- 真实同步：未启用
- 说明：这是本机模拟器证据，只验证 random/all 合同、诊断和导出链路，不等同 Windows 真机通过。
- 生成时间：2026-06-29T06:41:50.662Z

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| readiness | passed | 00-readiness.json |
| contacts-before | passed | 01-contacts-before.json |
| contacts-random-sync | passed | 02-contacts-random-sync-result.json |
| contacts-all-sync | passed | 03-contacts-all-sync-result.json |
| contacts-after | passed | 04-contacts-after.json |
| contacts-export | passed | 05-contacts-export.json |
| contacts-diagnostics-export | passed | 06-contacts-diagnostics-export.json |

## 复跑命令

```bash
node scripts/wechat-windows-contacts-acceptance.mjs --simulator --base-url http://127.0.0.1:3011 --evidence-dir "/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-06-29/windows-wechat-contacts-simulator"
```
