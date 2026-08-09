# Windows WeChat Native Commands Acceptance

- Generated: 2026-06-30T19:14:10.960Z
- Platform: win32
- Simulator: yes
- Require real WeChat success: yes
- Require real WeChat commands success: no
- Counts: passed 3, blocked 1, failed 0, skipped 5

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- BLOCKED contacts-native-runtime-real (required) -> 04-contacts-native-runtime-real.json: 微信窗口已打开，但当前不是通讯录页；请先扫码登录并切到左侧“通讯录”，再重新同步。
- SKIPPED native-command-real:group-broadcast: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:contact-add: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:moments-publish: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:moments-marketing: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:chat-history: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is required by --require-real-wechat. The five native WeChat command runners are required by --require-real-wechat-commands and must return readback plus screenshot evidence.
