# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:46], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

R = '/Users/yanghy/Documents/New project/ai-content'
D = R + '/desktop'
M = D + '/browser-panel-manager.js'

# ===== manager：setStripExpanded 支持定制高度（建议下拉比快捷行高） =====
patch(M, """    /** 控制条快捷跳转行是否展开（参与 _stripHeight） */
    this._stripExpanded = false;""",
"""    /** 控制条快捷跳转行是否展开（参与 _stripHeight） */
    this._stripExpanded = false;
    /** 展开部分当前高度（快捷行 30 / 建议下拉按需加高） */
    this._stripExpandH = STRIP_EXPAND_HEIGHT;""")

patch(M, """  /** 地址栏聚焦→控制条加高一行的快捷跳转行；失焦收起 */
  setStripExpanded(on) {
    const next = !!on;
    if (this._stripExpanded === next) return this._stripHeight();
    this._stripExpanded = next;
    this.relayout();
    this._emitState();
    return this._stripHeight();
  }""",
"""  /**
   * 地址栏聚焦→控制条加高，露出快捷跳转行/建议下拉；失焦收起。
   * @param {number} [height] 展开区需要的像素高（快捷行 30；建议下拉按需
   *   30 + 建议条数*24）。视图只有此高度，内容区溢出会被裁掉，故高度要量准。
   */
  setStripExpanded(on, height) {
    const next = !!on;
    if (on) {
      const h = Math.max(30, Math.min(160, Math.floor(Number(height) || STRIP_EXPAND_HEIGHT)));
      this._stripExpandH = h;
    }
    if (this._stripExpanded === next) return this._stripHeight();
    this._stripExpanded = next;
    this.relayout();
    this._emitState();
    return this._stripHeight();
  }""")

patch(M, """    const extra = (this._stripExpanded ? STRIP_EXPAND_HEIGHT : 0) + (this._activityLog.length ? ACTIVITY_ROW_HEIGHT : 0);
    return base + extra;""",
"""    const extra = (this._stripExpanded ? this._stripExpandH : 0) + (this._activityLog.length ? ACTIVITY_ROW_HEIGHT : 0);
    return base + extra;""")

# ===== IPC 透传高度 =====
patch(D + '/browser-panel-ipc.js',
"""  ipcMain.handle('browser-panel:expand-strip', stripOnly((on) => getPanel().setStripExpanded(on)));""",
"""  ipcMain.handle('browser-panel:expand-strip', stripOnly((on, height) => getPanel().setStripExpanded(on, height)));""")

# ===== 控制条：进度线 + 建议下拉 =====
S = D + '/browser-control-strip.html'
patch(S, """    /* ---- 面板活动条（TraeWork「控制台日志」语义） ---- */""",
"""    /* ---- 加载进度线（页面加载的可视反馈） ---- */
    body { position: relative; }
    #prog { position: absolute; left: 0; right: 0; top: 0; height: 2px; pointer-events: none; opacity: 0; transition: opacity .18s; z-index: 5; }
    #prog i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #722ed1, #b37feb); }
    #prog.on { opacity: 1; }
    #prog.on i { animation: progflow 2.2s ease-in-out infinite; }
    #prog.done { opacity: 1; }
    #prog.done i { width: 100%; transition: width .22s ease; animation: none; }
    @keyframes progflow { 0% { width: 5%; margin-left: 0; } 55% { width: 68%; } 100% { width: 78%; margin-left: 32%; opacity: .92; } }
    /* ---- 建议下拉（最近访问过滤 + 搜索兜底；与快捷行同处展开区） ---- */
    #sugbox { display: none; flex: none; background: var(--card); border-top: 1px solid var(--border); padding: 2px 6px 6px; }
    #sugbox.show { display: block; }
    #sugbox .sug {
      display: flex; align-items: center; gap: 7px; height: 24px; padding: 0 8px;
      border: none; background: transparent; color: var(--text); font-size: 11.5px;
      cursor: pointer; width: 100%; text-align: left; border-radius: 6px;
    }
    #sugbox .sug:hover { background: var(--hover); }
    #sugbox .sug .u { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    #sugbox .sug .host { flex: none; color: var(--text-faint); font-size: 10.5px; }
    #sugbox .sug.search { color: var(--accent); }
    #sugbox .sug.search .u { color: var(--accent); }
    /* ---- 面板活动条（TraeWork「控制台日志」语义） ---- */""")

patch(S, """<body>
  <div id="tabbar"></div>""",
"""<body>
  <div id="prog"><i></i></div>
  <div id="tabbar"></div>""")

patch(S, """  <div id="quickrow">""",
"""  <div id="sugbox"></div>
  <div id="quickrow">""")

# JS：进度线状态 + 建议逻辑
patch(S, """    // round15：tab 条（用户手动切/关；面板只暴露自己的页面，无第三方 IPC 特权）""",
"""    /* ---- 加载进度线（session.status 驱动） ---- */
    const prog = $('prog');
    let lastStatus = '';
    function setProg(status) {
      if (status === lastStatus) return;
      lastStatus = status;
      if (status === 'starting') {
        prog.classList.remove('done');
        prog.classList.add('on');
      } else if (status === 'ready' || status === 'error' || status === 'blocked' || status === 'needs-human') {
        prog.classList.remove('on');
        prog.classList.add('done');
        setTimeout(() => { prog.classList.remove('done', 'on'); }, 420);
      } else {
        prog.classList.remove('on', 'done');
      }
    }

    /* ---- 最近访问建议（从活动流 nav 记录推导） + 搜索兜底 ---- */
    let recentUrls = [];
    function collectRecents(state) {
      const out = [];
      for (const a of state.activity || []) {
        if (a.type === 'nav' && a.text.startsWith('打开 ')) {
          const url = a.text.slice(3);
          try {
            const host = new URL(url).hostname;
            if (!out.some((u) => new URL(u).hostname === host)) out.push(url);
          } catch (e) { /* 跳过非法 URL */ }
        }
      }
      recentUrls = out.slice(0, 6);
    }
    function renderSug() {
      const box = $('sugbox');
      const q = $('addr').value.trim();
      box.innerHTML = '';
      const lower = q.toLowerCase();
      if (!q) { return; }
      const matched = recentUrls.filter((u) => u.toLowerCase().includes(lower)).slice(0, 4);
      if (!matched.length) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'sug search';
        row.innerHTML = '<span class="u">搜索「' + q.replace(/[<>&"]/g, '') + '」</span><span class="host">百度</span>';
        row.onclick = () => quick('https://www.baidu.com/s?wd=' + encodeURIComponent(q));
        box.appendChild(row);
      } else {
        for (const url of matched) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'sug';
          row.insertAdjacentHTML('afterbegin', favFor(url));
          const u = document.createElement('span');
          u.className = 'u';
          u.textContent = url;
          row.appendChild(u);
          try { const h = document.createElement('span'); h.className = 'host'; h.textContent = new URL(url).hostname; row.appendChild(h); } catch (e) {}
          row.onclick = () => { $('addr').value = url; quick(url); };
          box.appendChild(row);
        }
      }
    }
    function updateExpand() {
      const sugH = $('sugbox').scrollHeight || 0;
      const need = 32 + sugH; // 快捷行 30 + 建议区（含上下边距）
      invoke('browser-panel:expand-strip', true, Math.min(160, need));
    }
    function collapseExpand() {
      $('sugbox').classList.remove('show');
      $('quickrow').classList.remove('show');
      invoke('browser-panel:expand-strip', false);
    }
    $('addr').addEventListener('input', () => { renderSug(); updateExpand(); });
    $('addr').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const raw = $('addr').value.trim();
      if (!raw) return;
      renderSug();
      const first = $('sugbox').querySelector('.sug');
      if (first && first.onclick) { first.onclick(); return; }
      const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(raw) ? raw : `https://${raw}`;
      quick(url);
    });
    // 建议行点击不能先触发 blur（否则下拉先收起又收不到点击）
    $('sugbox').addEventListener('pointerdown', (e) => { e.preventDefault(); });

    // round15：tab 条（用户手动切/关；面板只暴露自己的页面，无第三方 IPC 特权）""")

# 替换原来的 focus/blur/Enter 块（quick 已是顶层函数，保留）
patch(S, """    $('addr').addEventListener('focus', () => {
      $('quickrow').classList.add('show');
      $('addr').select();
    });
    $('addr').addEventListener('blur', () => {
      setTimeout(() => $('quickrow').classList.remove('show'), 120);
    });
    $('addr').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const raw = $('addr').value.trim();
      if (!raw) return;
      const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(raw) ? raw : `https://${raw}`;
      invoke('browser-panel:navigate', url);
      $('addr').blur();
    });""",
"""    $('addr').addEventListener('focus', () => {
      $('quickrow').classList.add('show');
      $('sugbox').classList.add('show');
      renderSug();
      updateExpand();
      setTimeout(() => $('addr').select(), 0);
    });
    $('addr').addEventListener('blur', () => {
      setTimeout(() => { $('sugbox').classList.remove('show'); $('quickrow').classList.remove('show'); invoke('browser-panel:expand-strip', false); }, 140);
    });""")

# onState：进度线 + 建议数据刷新 + 清冗余
patch(S, """      // 面板活动条（publicState.activity 驱动）
      lastActivity = Array.isArray(state.activity) ? state.activity : [];
      if (activityOpen) renderActivity(lastActivity);
      else renderActivity(lastActivity);
    });""",
"""      // 面板活动条（publicState.activity 驱动）
      lastActivity = Array.isArray(state.activity) ? state.activity : [];
      renderActivity(lastActivity);
      collectRecents(state);
      setProg(s);
      if (document.activeElement === $('addr')) renderSug();
    });""")

# mock 状态带 starting 一次（进度线可见）
patch(S, """            session: { currentUrl: 'https://www.douyin.com/video/7498231...', status: 'ready' },""",
"""            session: { currentUrl: 'https://www.douyin.com/video/7498231...', status: 'starting' },""")
print('STRIP PROG+SUG DONE')
