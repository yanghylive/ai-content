# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d (want %d)' % (path.split('/')[-1], old[:44], n, count)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'
S = D + '/browser-control-strip.html'

# ===== CSS：快捷行 =====
patch(S, """    #agent-mode.on:hover { background: var(--accent); filter: brightness(1.08); }

  </style>""",
"""    #agent-mode.on:hover { background: var(--accent); filter: brightness(1.08); }
    /* TraeWork 对齐：地址栏聚焦时控制器视图加高 30px，露出快捷跳转行
       （控制条是独立视图，下拉会被视图边界裁掉，故用"视图加高"实现） */
    #quickrow {
      display: none; flex: none; height: 30px; align-items: center; gap: 6px;
      padding: 3px 10px 5px; background: var(--card);
      border-top: 1px solid var(--border);
    }
    #quickrow.show { display: flex; }
    #quickrow .lbl { font-size: 11px; color: var(--text-faint); flex: none; }
    #quickrow .chip {
      flex: none; height: 22px; padding: 0 10px; border: 1px solid var(--border);
      border-radius: 11px; background: var(--bg); color: var(--text-dim);
      font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
      transition: all .12s;
    }
    #quickrow .chip:hover { border-color: var(--accent); color: var(--accent); background: var(--card); }
    #quickrow .chip .k { font: 10px ui-monospace, Menlo, monospace; opacity: .55; }
  </style>""")

# ===== HTML：快捷行 =====
patch(S, """  <div id="toolbar">
    <button id="back" title="后退">""",
"""  <div id="quickrow">
    <span class="lbl">快捷打开</span>
    <button type="button" class="chip" data-url="https://www.douyin.com">抖音</button>
    <button type="button" class="chip" data-url="https://www.xiaohongshu.com">小红书</button>
    <button type="button" class="chip" data-url="https://mp.weixin.qq.com">公众号</button>
    <button type="button" class="chip" data-url="https://channels.weixin.qq.com">视频号</button>
    <button type="button" class="chip" data-url="https://www.baidu.com">百度<span class="k">⌥A</span></button>
  </div>
  <div id="toolbar">
    <button id="back" title="后退">""")

# ===== JS：聚焦展开/失焦收起 + chip 跳转 =====
patch(S, """    $('addr').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const raw = $('addr').value.trim();
      if (!raw) return;
      const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(raw) ? raw : `https://${raw}`;
      invoke('browser-panel:navigate', url);
      $('addr').blur();
    });""",
"""    const quick = (url) => { invoke('browser-panel:navigate', url); $('addr').blur(); };
    $('quickrow').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) quick(chip.getAttribute('data-url'));
    });
    $('addr').addEventListener('focus', () => {
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
    });""")
print('STRIP DONE')
