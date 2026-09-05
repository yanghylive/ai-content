# ai-content-backend launchd 配置缺陷（2026-09-05 发现）

## 现状

- plist 路径：`~/Library/LaunchAgents/com.jiuzhang.ai-content-backend.plist`
- plist Label：`com.jiuzhang.ai-content-backend`
- plist 期望监听端口：**3011**（看 `StandardOutPath=/Users/yanghy/.workbuddy/ai-content-backend/backend-3011.log`）
- plist ProgramArguments：`/Users/yanghy/.workbuddy/ai-content-backend/backend-launchd.sh`
- plist `KeepAlive: true` + `RunAtLoad: true`

## 问题

```
$ launchctl list | grep jiuzhang.ai-content-backend
36169	-15	com.jiuzhang.ai-content-backend
```

**PID 列是 `-15`，不是 PID** —— plist 拉的 `backend-launchd.sh` 反复崩溃（退出码 -15 = SIGTERM，常见于启动后被 kill），导致 launchd KeepAlive 一直尝试重启但一直崩。

3011 端口当前能响应（HTTP 404 = nest 正常），**但实际响应进程不是 plist 拉的**，而是另一份 dist-bundle-sqlite 副本（PID 36169，路径 `/Users/yanghy/.workbuddy/ai-content-backend/dist-bundle-sqlite/index.js`，启动时间 4:01:52 ——是更早手动起的）。

## 后果

- 桌面端用户依赖 3011 端口——**目前功能可用靠副本曲线救国，不是 plist 在管**
- 如果手动副本挂了，plist 会试图重启 `backend-launchd.sh`，但脚本大概率继续崩
- 系统重启后 plist RunAtLoad 会启动 backend-launchd.sh，如果它持续崩，3011 端口可能长时间空缺
- 整个 launchd + 副本模式让 3011 端口**没有真正的"管理"** —— 出问题排查起来一团乱（谁拉的、为什么起、谁负责）

## 待排查项

1. **backend-launchd.sh 启动失败原因**
   - 跑一次看 stderr：`bash -x /Users/yanghy/.workbuddy/ai-content-backend/backend-launchd.sh 2>&1`
   - 或读 launchd 日志：`/Users/yanghy/.workbuddy/ai-content-backend/backend-3011.log`
2. **plsit 是否设了 ThrottleInterval**——有的话 KeepAlive 重启间隔被拉长，崩了之后要等很久才再启
3. **plist 启动命令 vs 实际跑的副本**——是否应该把 plist 命令改成直接 `node dist-bundle-sqlite/index.js` 加 env

## 建议修复方向（待大王拍板）

**选项 A**（最小动作）：改 plist ProgramArguments 指向 `dist-bundle-sqlite/index.js`，加 ThrottleInterval=10，让 plist 直接管 dist-bundle
**选项 B**（彻底）：拆掉 plist，把 backend-launchd.sh 换成 system-level supervisor（systemd / supervisord 替代），本机 macOS 用 launchd + 直接 dist-bundle
**选项 C**（保守）：不动 plist，承认 3011 端口"靠副本曲线救国"是当前事实，给副本加个轻量守护

## 不在 B 类范围

这条与 B 类真机验证无关，是独立的 launchd 配置缺陷。**B 类真机验证 BLOCKED 的根因是快手风控，不是这个**。

## 发现时间

2026-09-05，pkill 误杀 3013 端口事故排查时连带发现。

## 相关提交

- 诊断报告：`docs/B类真机验证v2.2根因诊断报告-20260905.md`（§8、§10 提到）
- memory：`.workbuddy/memory/2026-09-05.md`（事故段）