# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:44], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'
T = D + '/tab-strip.html'

# ---- CSS：浏览器 chip / 收起态 / 分隔 ----
patch(T, """  .iconbtn {""",
"""  /* TraeWork 对齐：浏览器面板 = 标签条里的一等公民（globe chip） */
  .tab.browser .globe { width: 13px; height: 13px; flex: 0 0 auto; color: var(--accent); }
  .tab.browser { color: var(--text-dim); }
  .tab.browser.active { background: var(--card); color: var(--text); box-shadow: var(--shadow-tab); }
  .tab.dim { opacity: .55; }
  .tab.dim:hover { opacity: 1; }
  .iconbtn {""")

# ---- HTML：宽度预设按钮（面板可见时出现）＋ ＋菜单 ----
patch(T, """    <button class="iconbtn" id="more" type="button" title="更多" aria-label="更多">""",
"""    <button class="iconbtn hidden" id="wHalf" type="button" title="面板半宽">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><rect x="12" y="4" width="9" height="16" fill="currentColor" stroke="none" opacity=".22"/></svg>
    </button>
    <button class="iconbtn hidden" id="wMax" type="button" title="面板加宽（最大 60%）">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><rect x="15" y="4" width="6" height="16" fill="currentColor" stroke="none" opacity=".22"/></svg>
    </button>
    <button class="iconbtn" id="more" type="button" title="更多" aria-label="更多">""")

patch(T, """  <div class="menu" id="menu">
    <button type="button" data-act="new">新建工作区标签<span class="kbd">⌘T</span></button>
    <button type="button" data-act="octop">打开 Octop 高级模式</button>
    <hr />
    <label class="chk"><input type="checkbox" id="pinOctop" />Octop 入口常驻标签栏</label>
  </div>""",
"""  <!-- ＋ = 浏览器式新建菜单（TraeWork 对齐）；⋯ = 溢出设置 -->
  <div class="menu" id="addMenu">
    <button type="button" data-act="new">新建工作区标签<span class="kbd">⌘T</span></button>
    <button type="button" data-act="browser-current">在浏览器面板打开当前页</button>
    <button type="button" data-act="browser-new">新建浏览器标签</button>
    <hr />
    <button type="button" data-act="octop">打开 Octop 高级模式</button>
  </div>

  <div class="menu" id="menu">
    <label class="chk"><input type="checkbox" id="pinOctop" />Octop 入口常驻标签栏</label>
  </div>""")

# ---- JS：shim mock ----
patch(T, """    window.tabStrip = {
      send: (channel, ...args) => console.log('[preview mock send]', channel, ...args),
      on: () => {},
      invoke: (name) =>
        name === 'workspace-tabs:list' ? Promise.resolve(MOCK_TABS) : Promise.resolve([]),
    };""",
"""    const MOCK_PANEL = {
      visible: true, hasSession: true, panelWidth: 480, tabActiveIndex: 0,
      tabList: [{ title: '抖音 · 装修视频评论区', url: 'https://www.douyin.com/video/7498231' }],
    };
    window.tabStrip = {
      send: (channel, ...args) => console.log('[preview mock send]', channel, ...args),
      on: (channel, cb) => {
        if (channel === 'browser-panel:state') setTimeout(() => cb(MOCK_PANEL), 0);
      },
      invoke: (name) =>
        name === 'workspace-tabs:list' ? Promise.resolve(MOCK_TABS) : Promise.resolve([]),
    };""")

# ---- JS：元素引用 + 面板态 ----
patch(T, """  const addBtn = document.getElementById('add');
  const moreBtn = document.getElementById('more');
  const state = { activeId: null, tabs: [] };""",
"""  const addBtn = document.getElementById('add');
  const moreBtn = document.getElementById('more');
  const addMenuEl = document.getElementById('addMenu');
  const wHalfBtn = document.getElementById('wHalf');
  const wMaxBtn = document.getElementById('wMax');
  const state = { activeId: null, tabs: [] };
  /** 浏览器面板状态（browser-panel:state 广播驱动 chip/预设按钮渲染） */
  let panelState = null;""")

patch(T, """  function hideAll() {
    menuEl.classList.remove('open');""",
"""  function hideAll() {
    addMenuEl.classList.remove('open');
    menuEl.classList.remove('open');""")

patch(T, """    if (e.target.closest('.menu') || e.target.closest('.pop') || e.target.closest('#add') || e.target.closest('#more') || e.target.closest('.ws')) return;""",
"""    if (e.target.closest('.menu') || e.target.closest('.pop') || e.target.closest('#add') || e.target.closest('#more') || e.target.closest('.ws')) return;
    // 上面 .menu 已覆盖 addMenu（同 class）""")

# ---- JS：render() 末尾挂 chip ----
patch(T, """      tabsEl.appendChild(el);
    }
  }

  /* ---------- 双击/右键改名""",
"""      tabsEl.appendChild(el);
    }
    renderBrowserChip();
  }

  /* ---------- 浏览器面板 chip（TraeWork：浏览器是标签条一等公民） ---------- */
  const GLOBE_SVG = '<svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>';
  function panelTitle() {
    const list = panelState && Array.isArray(panelState.tabList) ? panelState.tabList : [];
    const cur = list[panelState ? panelState.tabActiveIndex : 0] || list[0];
    return (cur && (cur.title || cur.url)) || '浏览器面板';
  }
  function renderBrowserChip() {
    if (!panelState || !(panelState.visible || panelState.hasSession)) return;
    const el = document.createElement('div');
    el.className = 'tab browser' + (panelState.visible ? ' active' : ' dim');
    el.title = panelState.visible ? '浏览器面板已打开（点击保持/收起用 ×）' : '浏览器面板已收起（点击恢复）';
    el.innerHTML = GLOBE_SVG;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = panelTitle();
    el.appendChild(title);
    if (panelState.visible) {
      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.title = '收起浏览器面板';
      close.onclick = (e) => { e.stopPropagation(); window.tabStrip.send('tab-strip:browser-hide'); };
      el.appendChild(close);
    }
    el.addEventListener('click', () => window.tabStrip.send('tab-strip:browser-show'));
    tabsEl.appendChild(el);
    wHalfBtn.classList.toggle('hidden', !panelState.visible);
    wMaxBtn.classList.toggle('hidden', !panelState.visible);
  }

  /* ---------- 双击/右键改名""")

# ---- JS：＋菜单开合与动作；预设按钮；面板态订阅 ----
patch(T, """  /* ---------- ＋ 直接新建（浏览器语义）；⋯ 溢出菜单 ---------- */
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideAll();
    window.tabStrip.send('tab-strip:new');
  });""",
"""  /* ---------- ＋ 浏览器式新建菜单；⋯ 溢出设置 ---------- */
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = addBtn.getBoundingClientRect();
    menuEl.classList.remove('open');
    ctxEl.classList.remove('open');
    popEl.classList.remove('open');
    const willOpen = !addMenuEl.classList.contains('open');
    addMenuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
    addMenuEl.style.top = (r.bottom + 6) + 'px';
    addMenuEl.classList.toggle('open', willOpen);
    addBtn.classList.toggle('open', willOpen);
  });
  addMenuEl.addEventListener('click', (e) => {
    const act = e.target.getAttribute('data-act');
    if (!act) return;
    hideAll();
    if (act === 'new') window.tabStrip.send('tab-strip:new');
    if (act === 'browser-current') window.tabStrip.send('tab-strip:browser-open-current');
    if (act === 'browser-new') window.tabStrip.send('tab-strip:browser-new-tab');
    if (act === 'octop') window.tabStrip.send('tab-strip:request-octop');
  });
  wHalfBtn.addEventListener('click', (e) => { e.stopPropagation(); hideAll(); window.tabStrip.send('tab-strip:browser-width', 'half'); });
  wMaxBtn.addEventListener('click', (e) => { e.stopPropagation(); hideAll(); window.tabStrip.send('tab-strip:browser-width', 'max'); });""")

patch(T, """  window.tabStrip.on('tab-strip:state', (s) => {
    state.activeId = s.activeId;
    state.tabs = s.tabs || [];
    render();
  });""",
"""  window.tabStrip.on('tab-strip:state', (s) => {
    state.activeId = s.activeId;
    state.tabs = s.tabs || [];
    render();
  });
  window.tabStrip.on('browser-panel:state', (s) => {
    panelState = s;
    render();
  });""")
print('TABSTRIP DONE')
