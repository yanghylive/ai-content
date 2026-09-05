# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:48], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

B = '/Users/yanghy/Documents/New project/ai-content/backend/src/modules/local-engine'

# ============ 1) executor：input.leadId 透传到签单 summary ============
E = B + '/agent-browser-executor.service.ts'
patch(E, """  /**
   * 阶段 7：loop 锁定的面板确认单 id（resolveConfirmation → lockedConfirmationId）。""",
"""  /**
   * 触达审计：本步动作归属的线索 id（获客跟进执行时透传）。面板确认单落库时
   * 写进 confirmationJson.leadId —— 线索详情页「触达历史」按它反查。不传 = 通用
   * agent 任务动作（与具体客户无关），只进会话审计不进线索时间线。
   */
  leadId?: string | null;
  /**
   * 阶段 7：loop 锁定的面板确认单 id（resolveConfirmation → lockedConfirmationId）。""")

# 5 处签单加 leadId：input.leadId
for old, new in [
    ("""      method: 'Page.navigate',
      params: { url: action.url },
      summary: { label: '导航', url: action.url },
      sessionId: sessionId ?? null,""",
     """      method: 'Page.navigate',
      params: { url: action.url },
      summary: { label: '导航', url: action.url },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,"""),
    ("""      method: 'Input.dispatchMouseEvent',
      summary: {
        label: '点击',
        selector: action.selector,
        targetText: probe.text ?? null,
      },
      sessionId: sessionId ?? null,""",
     """      method: 'Input.dispatchMouseEvent',
      summary: {
        label: '点击',
        selector: action.selector,
        targetText: probe.text ?? null,
      },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,"""),
    ("""      method: 'Input.insertText',
      summary: { label: '输入文本', selector: action.selector, text: textPreview },
      sessionId: sessionId ?? null,""",
     """      method: 'Input.insertText',
      summary: { label: '输入文本', selector: action.selector, text: textPreview },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,"""),
    ("""      method: 'Input.dispatchKeyEvent',
      summary: { label: '按下按键', key: action.key },
      sessionId: sessionId ?? null,""",
     """      method: 'Input.dispatchKeyEvent',
      summary: { label: '按下按键', key: action.key },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,"""),
    ("""      method: 'Panel.tabs',
      summary,
      sessionId: sessionId ?? null,""",
     """      method: 'Panel.tabs',
      summary,
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,"""),
]:
    patch(E, old, new)
print('executor summaries ok')
