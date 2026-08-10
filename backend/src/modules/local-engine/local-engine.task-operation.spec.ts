import { cancelTask, editTask } from './local-engine.task-operation.mixin';

describe('LocalEngineService cancelTask / editTask', () => {
  function makeHost() {
    const tasks = new Map<string, any>();
    const host: any = {
      tasks,
      ensureTaskStore: jest.fn(async () => undefined),
      persistTask: jest.fn(async () => undefined),
      getTask: jest.fn(async (id: string) => tasks.get(id)),
      updateTask: jest.fn((task: any, status: string, message: string, patch?: any) => {
        task.status = status;
        task.message = message;
        Object.assign(task, patch ?? {});
        return task;
      }),
      pushEvent: jest.fn(),
    };
    tasks.set('t-queued', { id: 't-queued', status: 'queued', replyText: '文案A', targetName: '客户A', metadata: {} });
    tasks.set('t-running', { id: 't-running', status: 'running', replyText: '文案B', metadata: {} });
    tasks.set('t-paused', { id: 't-paused', status: 'paused', replyText: '文案C', targetName: '客户C', metadata: { dailyLimit: 5 } });
    return host;
  }

  it('cancelTask：排队计划 → cancelled', async () => {
    const host = makeHost();
    const task = await cancelTask.call(host, 't-queued');
    expect(task.status).toBe('cancelled');
    expect(host.persistTask).toHaveBeenCalled();
  });

  it('cancelTask：running 状态拒绝', async () => {
    const host = makeHost();
    await expect(cancelTask.call(host, 't-running')).rejects.toThrow();
  });

  it('editTask：暂停计划可改文案/限额/间隔', async () => {
    const host = makeHost();
    const task = await editTask.call(host, 't-paused', {
      replyText: '新文案',
      dailyLimit: 20,
      intervalSeconds: 30,
    });
    expect(task.replyText).toBe('新文案');
    expect(task.metadata.dailyLimit).toBe(20);
    expect(task.metadata.intervalSeconds).toBe(30);
  });

  it('editTask：running 状态拒绝', async () => {
    const host = makeHost();
    await expect(editTask.call(host, 't-running', { replyText: 'x' })).rejects.toThrow();
  });

  it('editTask：空文案拒绝', async () => {
    const host = makeHost();
    await expect(editTask.call(host, 't-paused', { replyText: '  ' })).rejects.toThrow();
  });
});
