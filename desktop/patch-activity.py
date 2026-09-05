# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:44], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

R = '/Users/yanghy/Documents/New project/ai-content'
D = R + '/desktop'
M = D + '/browser-panel-manager.js'

# ---- 常量 ----
patch(M, """const STRIP_EXPAND_HEIGHT = 30;""",
"""const STRIP_EXPAND_HEIGHT = 30;
// Agent 活动条行高：面板有活动记录时常驻在控制条底部（TraeWork「控制台日志」语义）
const ACTIVITY_ROW_HEIGHT = 30;
/** 活动日志容量：内存环形，够回看即可 */
const ACTIVITY_CAP = 30;
/** publicState 下发的活动条数（最新在前） */
const ACTIVITY_EXPOSE = 15;""")

# ---- 构造 ----
patch(M, """    this._stripExpanded = false;
  }""",
"""    this._stripExpanded = false;
    /** Agent/面板活动日志（时间戳记录，供控制条底部活动条回看） */
    this._activityLog = [];
  }""")

# ---- recordActivity / clearActivity / _stripHeight / publicState ----
patch(M, """  _stripHeight() {
    const base = this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
    return base + (this._stripExpanded ? STRIP_EXPAND_HEIGHT : 0);
  }""",
"""  _stripHeight() {
    const base = this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
    const extra = (this._stripExpanded ? STRIP_EXPAND_HEIGHT : 0) + (this._activityLog.length ? ACTIVITY_ROW_HEIGHT : 0);
    return base + extra;
  }

  /**
   * 记录一条面板活动（打开/导航/批准/拒绝…），控制条底部活动条与顶部标签条
   * 都经 publicState.activity 消费。环形上限 ACTIVITY_CAP；有记录时控制条
   * 视图加高一行（ACTIVITY_ROW_HEIGHT），清空后复原。
   */
  recordActivity(type, text) {
    const entry = { t: Date.now(), type, text: String(text || '').slice(0, 120) };
    this._activityLog.push(entry);
    if (this._activityLog.length > ACTIVITY_CAP) this._activityLog.shift();
    if (this._visible) this.relayout();
    this._emitState();
  }

  clearActivity() {
    if (!this._activityLog.length) return;
    this._activityLog = [];
    if (this._visible) this.relayout();
    this._emitState();
  }""")

# open / hide / show / navigate / goBack / goForward / reload / tab 操作注入
patch(M, """  hide() {
    this._visible = false;""",
"""  open(input) {
    const result = this._openImpl(input);""".replace('open(input) {\n    const result', 'OPEN_PLACEHOLDER'))

# 上面这种换法易错——直接在方法体内做精确注入：
patch(M, """    this.relayout();
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();
    this._emitSessionEvent(accountSwitched ? 'account-switched' : 'opened');
    return this.publicState();""",
"""    this.relayout();
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();
    this._emitSessionEvent(accountSwitched ? 'account-switched' : 'opened');
    this.recordActivity('open', '打开浏览器面板');
    return this.publicState();""")

patch(M, """    this._emitSessionEvent('hidden');
    return this.publicState();
  }

  /** 恢复显示（沿用当前会话与 URL） */""",
"""    this._emitSessionEvent('hidden');
    this.recordActivity('hide', '收起浏览器面板');
    return this.publicState();
  }

  /** 恢复显示（沿用当前会话与 URL） */""")

patch(M, """    this._emitSessionEvent('shown');
    return this.publicState();
  }""",
"""    this._emitSessionEvent('shown');
    this.recordActivity('show', '恢复浏览器面板');
    return this.publicState();
  }""")

patch(M, """    this.panelView.webContents.loadURL(targetUrl);
    return targetUrl;
  }""",
"""    this.panelView.webContents.loadURL(targetUrl);
    this.recordActivity('nav', `打开 ${targetUrl}`);
    return targetUrl;
  }""")

patch(M, """  goBack() {""",
"""  recordNav(kind, label) {
    this.recordActivity('nav', label);
    if (kind === 'back') { if (this.panelView && !this.panelView.webContents.isDestroyed()) return this.panelView.webContents.goBack(); return false; }
    if (kind === 'forward') { if (this.panelView && !this.panelView.webContents.isDestroyed()) return this.panelView.webContents.goForward(); return false; }
    if (kind === 'reload') { if (this.panelView && !this.panelView.webContents.isDestroyed()) { this.panelView.webContents.reload(); return true; } return false; }
    return false;
  }

  goBack() {""")
# goBack/goForward/reload 原实现替换成走 recordNav
import re
s = io.open(M, encoding='utf-8').read()
old_go = """  goBack() {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    this.panelView.webContents.goBack();
    this._emitState();
    return true;
  }"""
assert s.count(old_go) == 1
s = s.replace(old_go, """  goBack() {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    this.panelView.webContents.goBack();
    this._emitState();
    this.recordActivity('nav', '后退');
    return true;
  }""")
old_fw = """  goForward() {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    this.panelView.webContents.goForward();
    this._emitState();
    return true;
  }"""
assert s.count(old_fw) == 1
s = s.replace(old_fw, """  goForward() {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    this.panelView.webContents.goForward();
    this._emitState();
    this.recordActivity('nav', '前进');
    return true;
  }""")
io.open(M, 'w', encoding='utf-8').write(s)
print('ok goBack/goForward')

patch(M, """      return { ok: true, snapshot: this.tabsOperation('switch', index) };""",
"""      this.recordActivity('tab', `切换标签页 ${Number(index) + 1}`);
      return { ok: true, snapshot: this.tabsOperation('switch', index) };""")
patch(M, """      return { ok: true, snapshot: this.tabsOperation('close', index) };""",
"""      this.recordActivity('tab', '关闭标签页');
      return { ok: true, snapshot: this.tabsOperation('close', index) };""")

# publicState 加 activity
patch(M, """      // ③：面板模式开关当前态（读文件，控制条按钮据此高亮）
      agentMode: this.getAgentMode(),""",
"""      // ③：面板模式开关当前态（读文件，控制条按钮据此高亮）
      agentMode: this.getAgentMode(),
      // 面板/Agent 活动日志（最新在前，控制条底部活动条消费）
      activity: this._activityLog.slice(-ACTIVITY_EXPOSE).reverse(),""")
print('MANAGER DONE')
