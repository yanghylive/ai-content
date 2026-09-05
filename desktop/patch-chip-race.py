# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'

# 1) 快捷行防抢焦点（与 sugbox 同款）：mousedown 不再让地址栏 blur，
#    行不会在 mouseup 前收起，click 正常触发
S = D + '/browser-control-strip.html'
patch(S, """    // 建议行点击不能先触发 blur（否则下拉先收起又收不到点击）
    $('sugbox').addEventListener('pointerdown', (e) => { e.preventDefault(); });""",
"""    // 建议行/快捷行点击不能先触发 blur（否则行先收起，mouseup 时 click
    // 根本不发——真机实证：慢点的 mousedown 200ms 后行已 COLLAPSED）
    const keepFocus = (e) => { if (!e.target.closest('input')) e.preventDefault(); };
    $('sugbox').addEventListener('pointerdown', keepFocus);
    $('quickrow').addEventListener('pointerdown', keepFocus);""")

# 2) 面板收起时展开态清零（防"关面板期间的 expand 请求泄漏到下次打开"）
M = D + '/browser-panel-manager.js'
patch(M, """  setStripExpanded(on, height) {
    const next = !!on;
    if (on) {""",
"""  setStripExpanded(on, height) {
    const next = !!on;
    // 面板收起时拒绝展开请求（视图本来就藏着一行空白，还会泄漏到下次打开）；
    // 收起请求照常放行（复位状态）
    if (next && !this._visible) return this._stripHeight();
    if (on) {""")
patch(M, """  _hideNow() {
    this._visible = false;""",
"""  _hideNow() {
    this._visible = false;
    this._stripExpanded = false;""")
print('CHIP RACE FIX DONE')
