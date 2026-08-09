# Windows WeChat Native Commands Acceptance

- Generated: 2026-07-01T05:43:16.428Z
- Platform: darwin
- Simulator: yes
- Require real WeChat success: no
- Require real WeChat commands success: no
- Counts: passed 3, blocked 0, failed 0, skipped 6

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- SKIPPED contacts-native-runtime-real: 未在 Windows 环境，或未传 --contacts，已跳过真实联系人 runtime。
- SKIPPED native-command-real:group-broadcast: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:contact-add: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:moments-publish: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:moments-marketing: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。
- SKIPPED native-command-real:chat-history: 未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is required by --require-real-wechat. The five native WeChat command runners are required by --require-real-wechat-commands and must return readback plus screenshot evidence.
