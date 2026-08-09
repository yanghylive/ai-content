本机微信真实执行阶段记录

已完成：
- 微信会话回复：le_mqkkfycb_obfyj0 completed，batch completed=1 failed=0，真实发送到当前本机微信群，证据 /tmp/ai-content-wechat-auto-reply-1781851643.png。
- 微信群发：le_mqkkh9e2_oadg19 completed，batch completed=1 failed=0，真实发送到当前本机微信群，证据 /tmp/ai-content-wechat-auto-reply-1781851679.png。
- 自动加好友 no_target 分类：le_mqkk87xn_dofqua no_target，batch noTarget=1 failed=0，目标不可添加时不再误计失败，证据 /tmp/ai-content-wechat-contact-add-1781851257.png。

发现的当前 bug：
- 朋友圈发布：le_mqkkhwn7_fyi4sx failed。原因是旧脚本打开朋友圈入口后，文案/发表坐标没有绑定到朋友圈发布编辑 sheet，smoke 曾出现假阳性并可能把文案填入聊天输入框。已开始修脚本，入口改为窗口菜单“朋友圈”，并新增 sheet 检测，但正文输入偏移仍需继续校准后才能自动发布。
