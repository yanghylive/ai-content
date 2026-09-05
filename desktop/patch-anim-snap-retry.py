# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:48], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'
M = D + '/browser-panel-manager.js'

# ---- 常量 ----
patch(M, """/** 拖拽轮询间隔（ms）——主进程跟随系统光标，不受视图边界断流影响 */
const RESIZE_POLL_MS = 16;""",
"""/** 拖拽轮询间隔（ms）——主进程跟随系统光标，不受视图边界断流影响 */
const RESIZE_POLL_MS = 16;
/** 面板开合动画：时长/步进（WebContentsView 没有 CSS 过渡，主进程逐帧 setBounds 补间） */
const PANEL_ANIM_MS = 150;
const PANEL_ANIM_STEP_MS = 16;
/** 拖拽磁吸：距半宽/最大/最小宽该像素内自动吸附（呼应顶栏宽度预设） */
const RESIZE_SNAP_PX = 14;""")

# ---- 构造字段 ----
patch(M, """    this._resizeGrabOffset = 0;
    // 阶段 7（round11）tabs""",
"""    this._resizeGrabOffset = 0;
    /** 开合动画（deps.animatePanels=false 可关，spec 同步断言用） */
    this._animate = deps.animatePanels !== false;
    this._animTimer = null;
    /** 动画期渲染宽（null = 无动画，relayout 用逻辑宽）；逻辑宽 _currentWidth 不受动画影响 */
    this._animWidth = null;
    // 阶段 7（round11）tabs""")

# ---- relayout 用渲染宽 ----
patch(M, """    this._currentWidth = this._clampWidth(this.width());
    const panelW = this._currentWidth;""",
"""    this._currentWidth = this._clampWidth(this.width());
    // 动画期用补间渲染宽（不夹最小值——滑入起点就是 0）；静止期 = 逻辑宽
    const panelW = this._animWidth != null
      ? Math.max(0, Math.min(Math.floor(this._animWidth), this._currentWidth))
      : this._currentWidth;""")

# ---- open 动画 ----
patch(M, """    this.relayout();
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();""",
"""    if (this._animate) this._animWidth = 0;
    this.relayout();
    this._animateWidthTo(this._currentWidth);
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();""")

# ---- show 动画 ----
patch(M, """    this._visible = true;
    this.relayout();
    if (this.session.status === 'stopped') this.session.status = 'ready';""",
"""    this._visible = true;
    if (this._animate) this._animWidth = 0;
    this.relayout();
    this._animateWidthTo(this._currentWidth);
    if (this.session.status === 'stopped') this.session.status = 'ready';""")

# ---- hide：收拢动画后再真正拆视图 ----
patch(M, """  /** 面板关闭 = 隐藏视图，保留会话与登录态（文档 §3.1） */
  hide() {
    this._visible = false;""",
"""  /** 面板关闭 = 隐藏视图，保留会话与登录态（文档 §3.1）。带动画时先收拢再拆 */
  hide() {
    if (!this._visible) return this.publicState();
    if (!this._animate) return this._hideNow();
    // 收起动画：渲染宽补间到 0 才 setVisible(false)——业务区跟着补间回弹，
    // 而不是"视图瞬间消失 + rightInset 一步置 0"的硬切
    this._animateWidthTo(0, () => this._hideNow());
    return this.publicState();
  }

  _hideNow() {
    this._visible = false;""")

# ---- 动画驱动方法（挂在 endResize 后） ----
patch(M, """    this._saveWidth();
    return true;
  }""",
"""    this._saveWidth();
    return true;
  }

  _cancelAnim() {
    if (this._animTimer) {
      clearInterval(this._animTimer);
      this._animTimer = null;
    }
  }

  /**
   * 渲染宽补间（easeOutCubic）。只动 _animWidth（relayout 的显示宽度），
   * 逻辑宽 _currentWidth/持久化/宽度记忆都不受影响；done 在收尾帧后执行。
   * 重复调用互斥（新动画顶掉旧的及其 done——hide 动画中途 open 不会误拆视图）。
   */
  _animateWidthTo(to, done) {
    this._cancelAnim();
    const from = this._animWidth != null ? this._animWidth : this._currentWidth;
    if (!this._animate || from === to || this._destroyed) {
      this._animWidth = null;
      if (this._visible) this.relayout();
      if (done) done();
      return;
    }
    const start = Date.now();
    this._animWidth = from;
    this._animTimer = setInterval(() => {
      if (this._destroyed || !this.window || this.window.isDestroyed()) {
        this._cancelAnim();
        return;
      }
      const t = Math.min(1, (Date.now() - start) / PANEL_ANIM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this._animWidth = Math.round(from + (to - from) * eased);
      if (this._visible) this.relayout();
      if (t >= 1) {
        clearInterval(this._animTimer);
        this._animTimer = null;
        if (this._visible) this.relayout();
        if (done) done();
        this._animWidth = null;
      }
    }, PANEL_ANIM_STEP_MS);
  }

  /** 拖拽磁吸：raw 距半宽/最大/最小宽 ≤RESIZE_SNAP_PX 时吸附 */
  _snapWidth(raw, windowWidth) {
    const half = Math.floor(windowWidth * 0.5);
    const max = Math.floor(windowWidth * PANEL_WIDTH_RATIO_MAX);
    for (const c of [half, max, PANEL_MIN_WIDTH]) {
      if (Math.abs(raw - c) <= RESIZE_SNAP_PX) return c;
    }
    return raw;
  }""")

# ---- 拖拽轮询接磁吸 ----
patch(M, """    const next = this._clampWidth(bounds.width - (localX - (this._resizeGrabOffset || 0)));""",
"""    const raw = bounds.width - (localX - (this._resizeGrabOffset || 0));
    const next = this._clampWidth(this._snapWidth(raw, bounds.width));""")

# ---- destroy 清动画 ----
patch(M, """  destroy() {
    this._destroyed = true;
    this.endResize();""",
"""  destroy() {
    this._destroyed = true;
    this.endResize();
    this._cancelAnim();""")

print('MANAGER DONE')

# ================= 控制条：重试按钮 =================
S = D + '/browser-control-strip.html'
patch(S, """    #status.needs-human, #status.blocked, #status.error { color: var(--danger); }""",
"""    #status.needs-human, #status.blocked, #status.error { color: var(--danger); }
    /* 加载失败/被阻断：状态文字旁给一键重试（全局 button 宽 28px 要显式覆盖） */
    #retry {
      display: none; flex: none; width: auto; height: 20px; padding: 0 8px;
      border: 1px solid var(--danger); border-radius: 6px; background: transparent;
      color: var(--danger); font-size: 11px; font-weight: 600;
    }
    #retry.show { display: inline-flex; }
    #retry:hover { background: var(--danger); color: #fff; }""")
patch(S, """    <span id="status"></span>""",
"""    <span id="status"></span>
    <button id="retry" title="重新加载当前页面">重试</button>""")
patch(S, """    $('reload').addEventListener('click', () => invoke('browser-panel:reload'));""",
"""    $('reload').addEventListener('click', () => invoke('browser-panel:reload'));
    $('retry').addEventListener('click', () => invoke('browser-panel:reload'));""")
patch(S, """      status.className = s || '';""",
"""      status.className = s || '';
      // 出错/被阻断 → 露出重试按钮（点了没反应最烦人，给个出口）
      $('retry').classList.toggle('show', s === 'error' || s === 'blocked');""")
print('STRIP DONE')

# ================= spec =================
P = D + '/browser-panel-manager.spec.js'
patch(P, """  const manager = new BrowserPanelManager({
    electron,
    store: { get: () => undefined, set: () => undefined },
    tabManager,
    preloadPath: '/fake/preload.js',""",
"""  const manager = new BrowserPanelManager({
    electron,
    store: { get: () => undefined, set: () => undefined },
    tabManager,
    // 默认关动画（既有断言都是同步读 _bounds）；动画专测 opts.animate:true 开启
    animatePanels: opts.animate === true,
    preloadPath: '/fake/preload.js',""")

anchor = "test('默认宽度 480，窄面板下限 360，上限 60%', () => {"
new_tests = """test('开合动画：open 从 0 展到目标宽，hide 收拢后才真正拆视图', async () => {
  const { manager } = setup(1600, 900, { animate: true });
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.width(), 480, '逻辑宽立即到位（记忆/广播不受动画影响）');
  assert.equal(manager.panelView._bounds.width, 0, '第 0 帧渲染宽 0（滑入起点）');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.panelView._bounds.width, 480, '动画结束渲染宽=目标');
  manager.hide();
  assert.equal(manager.publicState().visible, true, '收拢动画期间仍算可见（延后拆视图）');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.publicState().visible, false, '动画收拢后才真正隐藏');
  assert.equal(manager.gutterView._visible, false, '沟槽随收起隐藏');
});

test('收起动画中途重开：新动画顶掉旧 done，不会误拆视图', async () => {
  const { manager } = setup(1600, 900, { animate: true });
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  await new Promise((r) => setTimeout(r, 450));
  manager.hide();
  await new Promise((r) => setTimeout(r, 60));
  manager.show();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.publicState().visible, true, 'hide 动画未完成即 show → 面板保留');
  assert.equal(manager.panelView._bounds.width, 480);
});

test('拖拽磁吸：±14px 内吸附半宽/最大宽/最小宽，区间外不吸', () => {
  const { electron, manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  electron.setCursor(1120, 400); // 面板左缘（1600-480）→ grabOffset=0
  assert.equal(manager.beginResize(), true);
  electron.setCursor(807, 400); // raw=793 → 距半宽 800 差 7 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 800);
  electron.setCursor(650, 400); // raw=950 → 距 60% 上限 960 差 10 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 960);
  electron.setCursor(1234, 400); // raw=366 → 距最小 360 差 6 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 360);
  electron.setCursor(995, 400); // raw=605 → 离所有吸附点都远 → 不吸
  manager._pollResize();
  assert.equal(manager.width(), 605);
  manager.endResize();
});

"""
assert P and io.open(P, encoding='utf-8').read().count(anchor) == 1
s = io.open(P, encoding='utf-8').read()
io.open(P, 'w', encoding='utf-8').write(s.replace(anchor, new_tests + anchor))
print('SPEC DONE')
