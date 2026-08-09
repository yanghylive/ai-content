import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const users = await p.user.count();
  const sessions = await p.userSession.count();
  const ieTasks = await p.interactionTask.count();
  const ieTaskByStatus = await p.interactionTask.groupBy({ by: ['status'], _count: true });
  const asSessions = await p.agentSession.count();
  const asSessionByStatus = await p.agentSession.groupBy({ by: ['status'], _count: true });
  const runtimeExecs = await p.runtimeExecution.count();
  console.log('users:', users, 'sessions:', sessions);
  console.log('interactionTasks:', ieTasks, ieTaskByStatus);
  console.log('agentSessions:', asSessions, asSessionByStatus);
  console.log('runtimeExecutions:', runtimeExecs);
  await p.$disconnect();
})();
