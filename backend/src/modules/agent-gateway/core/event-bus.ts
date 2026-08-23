import { AgentEvent, AgentEventType } from './types';
import { makeError } from '../contracts/error-codes';
import { genId, nowIso } from './util';

type Listener = (event: AgentEvent) => void;

/**
 * 统一事件总线 —— 对齐《补充包》3.3。
 * - 每个 session 内 eventId 唯一、sequence 单调递增
 * - 客户端按 eventId 去重；断线用 lastEventId 补发
 * - 超过重放窗口返回 RESUME_WINDOW_EXPIRED，前端改为拉取任务快照
 */
export class EventBus {
  private sessions = new Map<string, AgentEvent[]>();
  private listeners = new Map<string, Set<Listener>>();
  private lastSequence = new Map<string, number>();
  /** 重放窗口（事件保留上限），超出之后 lastEventId 视为过期 */
  private windowSize: number;

  constructor(windowSize = 1000) {
    this.windowSize = windowSize;
  }

  private nextSequence(sessionId: string): number {
    const seq = (this.lastSequence.get(sessionId) ?? 0) + 1;
    this.lastSequence.set(sessionId, seq);
    return seq;
  }

  publish(sessionId: string, type: AgentEventType, taskId: string, payload: Record<string, unknown>): AgentEvent {
    const seq = this.nextSequence(sessionId);
    const event: AgentEvent = {
      eventId: `evt_${seq.toString().padStart(6, '0')}`,
      sequence: seq,
      type,
      taskId,
      sessionId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    const arr = this.sessions.get(sessionId) ?? [];
    arr.push(event);
    // 维持窗口：只保留最近 windowSize 条；超出后更早的 lastEventId 视为过期
    if (arr.length > this.windowSize) {
      arr.splice(0, arr.length - this.windowSize);
    }
    this.sessions.set(sessionId, arr);

    const ls = this.listeners.get(sessionId);
    if (ls) for (const fn of ls) fn(event);
    return event;
  }

  subscribe(sessionId: string, fn: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(sessionId, set);
    return () => set.delete(fn);
  }

  private indexOfEvent(sessionId: string, eventId: string): number {
    const arr = this.sessions.get(sessionId) ?? [];
    return arr.findIndex((e) => e.eventId === eventId);
  }

  /**
   * 返回 lastEventId 之后的所有事件。lastEventId 为空 → 返回全部。
   * 若 lastEventId 不在窗口内 → RESUME_WINDOW_EXPIRED。
   */
  getEventsSince(sessionId: string, lastEventId?: string): AgentEvent[] {
    const arr = this.sessions.get(sessionId) ?? [];
    if (!lastEventId) return [...arr];
    const idx = this.indexOfEvent(sessionId, lastEventId);
    if (idx === -1) {
      // 可能太旧被窗口淘汰，或根本不存在
      const oldest = arr[0];
      if (oldest && lastEventId < oldest.eventId) {
        throw makeError('RESUME_WINDOW_EXPIRED', { details: { lastEventId, oldestEventId: oldest.eventId } });
      }
      throw makeError('RESUME_WINDOW_EXPIRED', { details: { lastEventId } });
    }
    return arr.slice(idx + 1);
  }

  snapshot(sessionId: string): AgentEvent[] {
    return [...(this.sessions.get(sessionId) ?? [])];
  }
}

export { nowIso, genId };
