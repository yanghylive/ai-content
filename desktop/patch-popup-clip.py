# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:44], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'

# ============ 1) preload 白名单 ============
patch(D + '/tab-strip-preload.js', """  'tab-strip:browser-width'
]);""",
"""  'tab-strip:browser-width',
  // 菜单/气泡展开时上报所需视图高度（38px 标签条视图会裁掉越界弹层）
  'tab-strip:popup'
]);""")

# ============ 2) tab-strip.html：开合弹层时上报高度 ============
T = D + '/tab-strip.html'
patch(T, """  function hideAll() {
    addMenuEl.classList.remove('open');
    menuEl.classList.remove('open');
    ctxEl.classList.remove('open');
    popEl.classList.remove('open');
    addBtn.classList.remove('open');
    moreBtn.classList.remove('open');
  }""",
"""  /* 标签条视图只有 38px 高，弹层越界会被裁掉（用户视角=点了没反应）。
     开合弹层时把需要的视图总高上报主进程临时加高（同控制条快捷行思路）。 */
  function announcePopup() {
    let bottom = 38;
    for (const el of [addMenuEl, menuEl, ctxEl, popEl]) {
      if (el.classList.contains('open')) bottom = Math.max(bottom, Math.ceil(el.getBoundingClientRect().bottom) + 6);
    }
    window.tabStrip.send('tab-strip:popup', Math.min(bottom, 340));
  }
  function hideAll() {
    addMenuEl.classList.remove('open');
    menuEl.classList.remove('open');
    ctxEl.classList.remove('open');
    popEl.classList.remove('open');
    addBtn.classList.remove('open');
    moreBtn.classList.remove('open');
    announcePopup();
  }""")
# 各开点补 announce：＋菜单 / ⋯菜单 / 右键菜单 / 绑定气泡
patch(T, """    const willOpen = !addMenuEl.classList.contains('open');
    addMenuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
    addMenuEl.style.top = (r.bottom + 6) + 'px';
    addMenuEl.classList.toggle('open', willOpen);
    addBtn.classList.toggle('open', willOpen);
  });""",
"""    const willOpen = !addMenuEl.classList.contains('open');
    addMenuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
    addMenuEl.style.top = (r.bottom + 6) + 'px';
    addMenuEl.classList.toggle('open', willOpen);
    addBtn.classList.toggle('open', willOpen);
    announcePopup();
  });""")
patch(T, """    const willOpen = !menuEl.classList.contains('open');
    menuEl.classList.toggle('open', willOpen);
    moreBtn.classList.toggle('open', willOpen);
  });""",
"""    const willOpen = !menuEl.classList.contains('open');
    menuEl.classList.toggle('open', willOpen);
    moreBtn.classList.toggle('open', willOpen);
    announcePopup();
  });""")
patch(T, """    ctxEl.classList.add('open');
  }""",
"""    ctxEl.classList.add('open');
    announcePopup();
  }""")
patch(T, """    popEl.classList.add('open');
    popInput.focus();""",
"""    popEl.classList.add('open');
    announcePopup();
    popInput.focus();""")

# ============ 3) workspace-tabs：popup 通道 + 视图加高/置顶 ============
W = D + '/workspace-tabs.js'
patch(W, """    this.tabStrip.setBounds({ x: 0, y: 0, width: w, height: TAB_STRIP_HEIGHT });""",
"""    // 弹层展开期临时加高（tab-strip.html announcePopup 上报）；置顶防被业务/面板视图盖住
    this.tabStrip.setBounds({ x: 0, y: 0, width: w, height: Math.max(TAB_STRIP_HEIGHT, this._popupHeight || 0) });""")
patch(W, """    ipcMain.on('tab-strip:request-octop', (e) => {
      if (!this._isTabStripSender(e)) return;
      this.sendToBusiness('octop:request-launch');
    });""",
"""    ipcMain.on('tab-strip:request-octop', (e) => {
      if (!this._isTabStripSender(e)) return;
      this.sendToBusiness('octop:request-launch');
    });
    // 标签条弹层（＋菜单/⋯菜单/右键/绑定气泡）高度上报：38px 视图装不下越界弹层，
    // 加高视图并把标签条提到最上层（收起时归位 38px）。
    ipcMain.on('tab-strip:popup', (e, height) => {
      if (!this._isTabStripSender(e)) return;
      const h = Math.max(0, Math.min(Number(height) || 0, 340));
      if (h === (this._popupHeight || 0)) return;
      this._popupHeight = h;
      if (!this.window || this.window.isDestroyed() || !this.tabStrip) return;
      try {
        this.relayout();
        if (h > TAB_STRIP_HEIGHT) this.window.contentView.addChildView(this.tabStrip); // 重添加 = 移到最上层
      } catch { /* 视图竞态：下一帧 relayout 自愈 */ }
    });""")
print('POPUP CLIP FIX DONE')
