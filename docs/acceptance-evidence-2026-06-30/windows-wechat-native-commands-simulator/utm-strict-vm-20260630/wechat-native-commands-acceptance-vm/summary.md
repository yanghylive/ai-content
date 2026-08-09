# Windows WeChat Native Commands Acceptance

- Generated: 2026-06-30T16:52:27.388Z
- Platform: win32
- Simulator: yes
- Require real WeChat success: yes
- Require real WeChat commands success: yes
- Counts: passed 3, blocked 6, failed 0, skipped 0

## Results

- PASSED wechat-native-command-contract-smoke (required) -> 01-command-contract-smoke.txt: smoke passed
- PASSED wechat-native-bundled-runners-smoke (required) -> 02-bundled-runners-smoke.txt: smoke passed
- PASSED wechat-native-external-runner-smoke (required) -> 03-external-runner-smoke.txt: smoke passed
- BLOCKED contacts-native-runtime-real (required) -> 04-contacts-native-runtime-real.json: 微信进程存在，但当前执行器拿不到可控窗口；请在同一个已登录的用户桌面会话打开微信通讯录，避免从服务会话或管理员/非管理员混合会话启动。
- BLOCKED native-command-real:group-broadcast (required) -> 05-native-command-group-broadcast.json: 检查 Windows PowerShell、微信窗口和自动化权限。
- BLOCKED native-command-real:contact-add (required) -> 05-native-command-contact-add.json: 检查 Windows PowerShell、微信窗口和自动化权限。
- BLOCKED native-command-real:moments-publish (required) -> 05-native-command-moments-publish.json: 检查 Windows PowerShell、微信窗口和自动化权限。
- BLOCKED native-command-real:moments-marketing (required) -> 05-native-command-moments-marketing.json: 检查 Windows PowerShell、微信窗口和自动化权限。
- BLOCKED native-command-real:chat-history (required) -> 05-native-command-chat-history.json: 检查 Windows PowerShell、微信窗口和自动化权限。

## Rule

Core runner smoke failures block packaging. Real WeChat contact success is required by --require-real-wechat. The five native WeChat command runners are required by --require-real-wechat-commands and must return readback plus screenshot evidence.
