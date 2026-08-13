import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';

/**
 * 线索事件流（一期，轻量）。
 *
 * 一期只打通两个事件：lead.created（新线索）与 lead.converted（线索转客户）。
 * 供 CRM / 情报 / 互动等模块订阅，避免各模块直接互相调用产生耦合。
 *
 * 用 Node 原生 EventEmitter 实现，不引入 @nestjs/event-emitter 依赖；
 * 一期事件消费方数量少、同步处理足够，后续需要异步/持久化再升级。
 */

export interface LeadCreatedEvent {
  type: 'lead.created';
  leadId: string;
  userId: string;
  tenantId: string | null;
  platform: string;
  sourceType: string;
  dedupeKey: string;
  at: Date;
}

export interface LeadConvertedEvent {
  type: 'lead.converted';
  leadId: string;
  customerId: string;
  userId: string;
  at: Date;
}

export type LeadEvent = LeadCreatedEvent | LeadConvertedEvent;

@Injectable()
export class LeadEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: LeadEvent): void {
    this.emitter.emit(event.type, event);
  }

  on(
    type: LeadEvent['type'],
    listener: (event: LeadEvent) => void,
  ): void {
    this.emitter.on(type, listener);
  }

  off(
    type: LeadEvent['type'],
    listener: (event: LeadEvent) => void,
  ): void {
    this.emitter.off(type, listener);
  }
}
