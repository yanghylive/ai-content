# Content Workspace Decision Log

## CW-D004 - Action and provenance correction
- Status: Accepted
- Requirements: UX-05, UX-06, UX-08, UX-13
- Decision: Preserve action provenance and publish preparation boundaries.
- Reason: Accepted workspace behavior needs traceable implementation, test, and runtime evidence.

## CW-D005 - Action and provenance correction
- Status: Accepted
- Requirements: UX-05, UX-08, UX-13
- Decision: 再次打开 G1.1 并暂停 G2；同一可见工作区最多保留一个主动作，历史简报缺少字段来源时必须明确显示来源未记录，不得猜测或使用模糊说明。
- Reason: 第一次 G1.1 证据未覆盖规则候选打开、已有版本行以及非空历史简报缺少 fieldSources 的组合状态。
- Evidence: at most one primary action; source was not recorded.
