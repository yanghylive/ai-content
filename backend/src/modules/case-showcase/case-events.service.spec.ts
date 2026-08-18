import { BadRequestException } from '@nestjs/common';
import {
  CASE_EVENT_NAMES,
  CaseEventsService,
  isKnownEventName,
  sanitizeEventProps,
} from './case-events.service';

describe('CaseEventsService（分析事件）', () => {
  it('白名单包含 PRD §14.1 的 12 个事件名', () => {
    expect(CASE_EVENT_NAMES).toHaveLength(12);
    expect(CASE_EVENT_NAMES).toEqual([
      'case_impression',
      'case_open',
      'search_submit',
      'filter_change',
      'media_view',
      'demo_open',
      'qr_view',
      'shortlink_open',
      'collection_open',
      'inquiry_start',
      'inquiry_submit',
      'case_feedback',
    ]);
  });

  it('isKnownEventName：合法事件全部通过，未知事件一律拒绝', () => {
    for (const name of CASE_EVENT_NAMES) {
      expect(isKnownEventName(name)).toBe(true);
    }
    expect(isKnownEventName('unknown_event')).toBe(false);
    expect(isKnownEventName('')).toBe(false);
    expect(isKnownEventName(123)).toBe(false);
    expect(isKnownEventName(null)).toBe(false);
    expect(isKnownEventName(undefined)).toBe(false);
  });

  it('record：未知事件名抛 400 BadRequest', () => {
    const svc = new CaseEventsService();
    expect(() => svc.record({ name: 'unknown_event' }, '127.0.0.1')).toThrow(
      BadRequestException,
    );
    expect(() => svc.record({}, '127.0.0.1')).toThrow(BadRequestException);
  });

  it('record：合法事件名通过（不抛异常）', () => {
    const svc = new CaseEventsService();
    expect(() =>
      svc.record(
        { name: 'case_open', props: { case_id: 'case_1' } },
        '127.0.0.1',
      ),
    ).not.toThrow();
  });

  it('sanitizeEventProps：剥离联系方式 / 需求正文 / 客户名称等敏感键', () => {
    const result = sanitizeEventProps({
      case_id: 'case_1',
      contactValue: '13800138000',
      message: '希望了解知识库与客服方案',
      name: '张先生',
      company: '某某公司',
      channel_code: 'sales_a1',
    });
    expect(result).toEqual({ case_id: 'case_1', channel_code: 'sales_a1' });
  });

  it('sanitizeEventProps：截断超长字符串、丢弃嵌套敏感字段', () => {
    const result = sanitizeEventProps({
      keyword: 'x'.repeat(500),
      nested: { contactValue: 'secret' },
      media_id: 'm1',
      ok: true,
      n: 3,
    });
    expect(result.keyword).toHaveLength(200);
    expect(result).not.toHaveProperty('nested');
    expect(result.ok).toBe(true);
    expect(result.n).toBe(3);
  });

  it('sanitizeEventProps：空值 / null / 非法输入返回空对象', () => {
    expect(sanitizeEventProps(undefined)).toEqual({});
    expect(sanitizeEventProps(null)).toEqual({});
    expect(sanitizeEventProps('str')).toEqual({});
    expect(sanitizeEventProps([1, 2])).toEqual({});
    expect(sanitizeEventProps({ a: null, b: undefined })).toEqual({});
  });
});
