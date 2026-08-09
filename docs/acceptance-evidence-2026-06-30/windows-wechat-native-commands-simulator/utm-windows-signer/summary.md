# Windows WeChat Native Commands Acceptance

- Generated: 2026-06-30T05:39:52.911Z
- Platform: win32
- Simulator: yes
- Require real WeChat success: no
- Counts: passed 3, blocked 0, failed 1, skipped 0

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- FAILED contacts-native-runtime-real -> 04-contacts-native-runtime-real.json: 请确认 Windows 微信已打开到通讯录，或检查 DB helper/诊断输出后重试。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is only required when --require-real-wechat is passed; otherwise a blocked contact result is kept as environment evidence.
