当前验收阻塞记录

- 后端/前端代码验证已通过：local-engine.business-task-type.spec.ts 37/37，backend build 通过，frontend build 通过。
- 本机微信加好友探测已执行：wechat-contact-add 用户1196170837 approval 返回 failed/no add form；截图 /tmp/ai-content-wechat-contact-add-1781849294.png。
- 运行环境阻塞：ai-content-postgres-1 容器 docker ps 显示 healthy，但外部 pg 客户端连接 127.0.0.1:5432 在认证/握手阶段超时；Postgres 日志出现 canceling authentication due to timeout。
- 3011 后端因 Prisma 鉴权查询无法连通 DB，/api/local-engine/* 接口超时/500，无法继续浏览器闭环验收。
