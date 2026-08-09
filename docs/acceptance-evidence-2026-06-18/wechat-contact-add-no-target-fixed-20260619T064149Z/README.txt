P2/#46 自动加好友 no_target 分类复验

- 真实执行任务：le_mqkk87xn_dofqua
- 本机微信目标：用户1196170837
- 验收动作：创建 wechat-contact-add / auto-send / commercialExecutionRequested=true 任务，由 3011 Node Runtime 调用本机微信执行器。
- 结果：status=no_target；batchSummary.noTarget=1；batchSummary.failed=0；未继续误计为 failed。
- 证据：任务事件包含 /tmp/ai-content-wechat-contact-add-1781851257.png 截图。
- 结论：当前目标不可添加或已是联系人时，系统能正确记录为“无对象”。#46 真正 PASS 仍需要一个未成为好友且可搜索/可添加的微信测试对象，目标端必须可见好友申请。
