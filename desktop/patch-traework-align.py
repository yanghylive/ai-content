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

# ============ 1) manager：状态订阅钩子 + 控制条展开行 ============
patch(M, """const TABBAR_HEIGHT = 26;""",
"""const TABBAR_HEIGHT = 26;
// 地址栏聚焦时的快捷跳转行（TraeWork 地址行语义：聚焦即出建议）。
// 控制条是独立视图，下拉会被视图边界裁掉——所以聚焦时把视图加高一行。
const STRIP_EXPAND_HEIGHT = 30;""")

patch(M, """    this._sessionListeners = new Set();
  }""",
"""    this._sessionListeners = new Set();
    /** 面板状态订阅（顶部标签条 chip 用；_emitState 时同步回调） */
    this._stateListeners = new Set();
    /** 控制条快捷跳转行是否展开（参与 _stripHeight） */
    this._stripExpanded = false;
  }

  /** 顶部标签条订阅面板状态广播（返回取消函数） */
  onStateChange(cb) {
    if (typeof cb !== 'function') return () => undefined;
    this._stateListeners.add(cb);
    return () => this._stateListeners.delete(cb);
  }

  /** 地址栏聚焦→控制条加高一行的快捷跳转行；失焦收起 */
  setStripExpanded(on) {
    const next = !!on;
    if (this._stripExpanded === next) return this._stripHeight();
    this._stripExpanded = next;
    this.relayout();
    this._emitState();
    return this._stripHeight();
  }""")

patch(M, """  _stripHeight() {
    return this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
  }""",
"""  _stripHeight() {
    const base = this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
    return base + (this._stripExpanded ? STRIP_EXPAND_HEIGHT : 0);
  }""")

patch(M, """  _emitState() {
    const state = this.publicState();
    this._sendToPanelOwner('browser-panel:state', state);
    this._sendToStrip('browser-panel:state', state);
  }""",
"""  _emitState() {
    const state = this.publicState();
    this._sendToPanelOwner('browser-panel:state', state);
    this._sendToStrip('browser-panel:state', state);
    // 顶部标签条（浏览器 chip / 宽度预设按钮）订阅同一状态流
    for (const cb of this._stateListeners) {
      try { cb(state); } catch { /* 单个订阅方异常互不影响 */ }
    }
  }""")

# ============ 2) IPC：expand-strip 通道 ============
I = D + '/browser-panel-ipc.js'
patch(I, """  ipcMain.handle('browser-panel:set-width', stripOnly((w) => getPanel().setWidth(w)));""",
"""  ipcMain.handle('browser-panel:set-width', stripOnly((w) => getPanel().setWidth(w)));
  // 地址栏聚焦时的快捷跳转行（控制条/沟槽视图展开自己的高度）
  ipcMain.handle('browser-panel:expand-strip', stripOnly((on) => getPanel().setStripExpanded(on)));""")
patch(I, """      'browser-panel:set-width',""",
"""      'browser-panel:set-width',
      'browser-panel:expand-strip',""")

# ============ 3) 控制条 preload 白名单 ============
patch(D + '/browser-control-strip-preload.js', """  'browser-panel:set-width',""",
"""  'browser-panel:set-width',
  'browser-panel:expand-strip',""")

# ============ 4) tab-strip preload：浏览器命令通道 ============
T = D + '/tab-strip-preload.js'
patch(T, """  'tab-strip:request-octop'
]);""",
"""  'tab-strip:request-octop',
  // TraeWork 对齐：浏览器面板入口上顶栏（chip/＋菜单/宽度预设），悬浮球退役
  'tab-strip:browser-show',
  'tab-strip:browser-hide',
  'tab-strip:browser-open-current',
  'tab-strip:browser-new-tab',
  'tab-strip:browser-width'
]);""")
patch(T, """const ON_CHANNELS = new Set(['tab-strip:state']);""",
"""const ON_CHANNELS = new Set(['tab-strip:state', 'browser-panel:state']);""")

# ============ 5) main.js：tab-strip ↔ browserPanel 接线 ============
patch(D + '/main.js', """  registerBrowserPanelIpc({
    ipcMain,
    getPanel: getBrowserPanel,
    getWiring: getBrowserWiring,
    isTrustedRendererSender:
      typeof isTrustedRendererSender === 'function' ? isTrustedRendererSender : undefined,
  });
}""",
"""  registerBrowserPanelIpc({
    ipcMain,
    getPanel: getBrowserPanel,
    getWiring: getBrowserWiring,
    isTrustedRendererSender:
      typeof isTrustedRendererSender === 'function' ? isTrustedRendererSender : undefined,
  });

  // —— TraeWork 对齐：浏览器面板入口上顶栏（悬浮球 dock 已退役） ——
  // 面板状态 → 顶部标签条（chip 与宽度预设按钮据此渲染）
  getBrowserPanel().onStateChange((state) => {
    try {
      const strip = getTabManager().tabStrip;
      if (strip && !strip.webContents.isDestroyed()) {
        strip.webContents.send('browser-panel:state', state);
      }
    } catch { /* 标签条尚未创建 */ }
  });
  const isFromTabStrip = (event) => {
    try {
      const strip = getTabManager().tabStrip;
      return !!(strip && !strip.webContents.isDestroyed() && strip.webContents.id === event.sender.id);
    } catch {
      return false;
    }
  };
  const currentBusinessUrl = () => {
    try {
      const tm = getTabManager();
      const tab = tm.tabs.get(tm.activeId);
      const wc = tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
      return (wc && wc.getURL()) || '';
    } catch {
      return '';
    }
  };
  ipcMain.on('tab-strip:browser-show', (e) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (p.publicState().visible) return;
    if (!p.show()) {
      const url = currentBusinessUrl();
      if (url) { try { p.open({ url }); } catch { /* 非 http(s) 页忽略 */ } }
    }
  });
  ipcMain.on('tab-strip:browser-hide', (e) => {
    if (isFromTabStrip(e)) getBrowserPanel().hide();
  });
  ipcMain.on('tab-strip:browser-open-current', (e) => {
    if (!isFromTabStrip(e)) return;
    const url = currentBusinessUrl();
    if (!url) return;
    try { getBrowserPanel().open({ url }); } catch { /* 非 http(s) 页忽略 */ }
  });
  ipcMain.on('tab-strip:browser-new-tab', (e) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (p.session) {
      try { p.tabsOperation('new'); } catch { /* 视图不可用时退回 show */ }
      if (!p.publicState().visible) p.show();
    } else {
      const url = currentBusinessUrl() || 'https://www.douyin.com';
      try { p.open({ url }); } catch { /* ignore */ }
    }
  });
  ipcMain.on('tab-strip:browser-width', (e, mode) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (!p.publicState().visible || !p.window || p.window.isDestroyed()) return;
    const { width } = p.window.getContentBounds();
    const target = mode === 'max' ? Math.floor(width * 0.6) : mode === 'half' ? Math.floor(width * 0.5) : 480;
    p.setWidth(target);
  });
}""")
print('PART1 DONE')
