# Windows WeChat Native Commands Acceptance

- Generated: 2026-06-30T17:34:27.398Z
- Platform: win32
- Simulator: yes
- Require real WeChat success: yes
- Require real WeChat commands success: yes
- Counts: passed 3, blocked 6, failed 0, skipped 0

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- BLOCKED contacts-native-runtime-real (required) -> 04-contacts-native-runtime-real.json: 微信窗口已打开，但当前不是通讯录页；请先扫码登录并切到左侧“通讯录”，再重新同步。
- BLOCKED native-command-real:group-broadcast (required) -> 05-native-command-group-broadcast.json: 微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。
- BLOCKED native-command-real:contact-add (required) -> 05-native-command-contact-add.json: 微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。
- BLOCKED native-command-real:moments-publish (required) -> 05-native-command-moments-publish.json: 微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。
- BLOCKED native-command-real:moments-marketing (required) -> 05-native-command-moments-marketing.json: 微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。
- BLOCKED native-command-real:chat-history (required) -> 05-native-command-chat-history.json: 微信当前停在登录页或二维码页；请先扫码登录桌面微信，再重新执行。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is required by --require-real-wechat. The five native WeChat command runners are required by --require-real-wechat-commands and must return readback plus screenshot evidence.
