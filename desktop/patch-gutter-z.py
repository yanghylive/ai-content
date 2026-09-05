# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:44], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'

# 1) 面板 relayout：沟槽置顶（Electron 重复 addChildView = 移到最上层）。
#    业务视图在 switchTo 时会被重新 addChildView 到最上层，恰好盖住与它
#    右缘重叠的沟槽（60% 夹取后 inset 少让 12px）——面板拉到最宽时
#    用户就"没有能拉回去的地方了"。
patch(D + '/browser-panel-manager.js', """    if (this.gutterView && !this.gutterView.webContents.isDestroyed()) {
      this.gutterView.setBounds({ x: x - gutter, y: contentY, width: gutter, height: contentH });
      this.gutterView.setVisible(gutter > 0);
    }""",
"""    if (this.gutterView && !this.gutterView.webContents.isDestroyed()) {
      this.gutterView.setBounds({ x: x - gutter, y: contentY, width: gutter, height: contentH });
      this.gutterView.setVisible(gutter > 0);
      // 置顶：业务视图在 switchTo 时被重新 addChildView 到最上层，会盖住
      // 与其右缘重叠的沟槽（面板越宽重叠越必然）——沟槽被盖 = 拖不回面板。
      // Electron 对已存在子视图重复 addChildView 即移到最上层，幂等。
      try {
        this.window.contentView.addChildView(this.gutterView);
      } catch { /* 视图竞态：下次 relayout 自愈 */ }
    }""")

# 2) 业务 inset 不再按 60% 二次夹取：rightInset 由面板侧保证 ≤ 60%w+gutter，
#    这里再夹 60% 会把沟槽那 12px 还给业务区造成必然重叠。防遮挡目的改为
#    "至少留 120px 业务区"。
patch(D + '/workspace-tabs.js', """    const inset = Math.max(0, Math.min(this.rightInset || 0, Math.floor(w * 0.6)));""",
"""    // 上限只保底"业务区不被完全挤没"（120px）；不再按 60% 二次夹取——
    // 那会把面板让出的沟槽 12px 划回业务视图，业务视图盖住沟槽（拖不回面板）。
    // 面板自身在 BrowserPanelManager._clampWidth 已有 60% 上限。
    const inset = Math.max(0, Math.min(this.rightInset || 0, Math.max(0, w - 120)));""")
print('Z-FIX DONE')
