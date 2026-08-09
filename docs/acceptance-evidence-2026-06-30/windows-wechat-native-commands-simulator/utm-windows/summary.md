# Windows WeChat Native Commands Acceptance

- Generated: 2026-06-30T05:22:49.849Z
- Platform: win32
- Simulator: yes
- Require real WeChat success: no
- Counts: passed 3, blocked 1, failed 0, skipped 0

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- BLOCKED contacts-native-runtime-real -> 04-contacts-native-runtime-real.json: 微信进程存在，但当前执行器拿不到可控窗口；请在同一个已登录的用户桌面会话打开微信通讯录，避免从服务会话或管理员/非管理员混合会话启动。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is only required when --require-real-wechat is passed; otherwise a blocked contact result is kept as environment evidence.
