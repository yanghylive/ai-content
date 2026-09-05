# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path, old[:50], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

D = '/Users/yanghy/Documents/New project/ai-content/desktop'
G = D + '/browser-panel-gutter.html'

# 沟要"读得出是一条空隙"，靠的是与业务底色的明度差；第一版只差 15 档，太弱
patch(G, """    --channel: #e3e5e9;
    --card-edge: rgba(31, 35, 41, .13);
    --shade: rgba(31, 35, 41, .10);
    --grip: rgba(31, 35, 41, .30);""",
"""    --channel: #d8dbe1;
    --card-edge: rgba(31, 35, 41, .16);
    --shade: rgba(31, 35, 41, .16);
    --grip: rgba(31, 35, 41, .46);""")

patch(G, """      --channel: #131417;
      --card-edge: rgba(255, 255, 255, .16);
      --shade: rgba(0, 0, 0, .55);
      --grip: rgba(255, 255, 255, .34);""",
"""      --channel: #0d0e11;
      --card-edge: rgba(255, 255, 255, .18);
      --shade: rgba(0, 0, 0, .62);
      --grip: rgba(255, 255, 255, .46);""")

# 握柄常态加大：3x30 → 4x34（小尺寸截图里也能看见）
patch(G, """    width: 3px; height: 30px; border-radius: 2px;""",
"""    width: 4px; height: 34px; border-radius: 2px;""")
patch(G, """    background: var(--accent); width: 4px; height: 46px;""",
"""    background: var(--accent); width: 5px; height: 52px;""")

# 沟宽 10 → 12（主进程常量同步）
patch(G, """     * 沟本身就是拖拽热区（居中胶囊是握柄提示）。""",
"""     * 沟本身就是拖拽热区（居中胶囊是握柄提示）。
     * 对比度实测：沟底色与业务底色需差 ≥25 明度档才读得出"空隙"，
     * 第一版 #e3e5e9 只差 15 档，缩略图下几乎不可见（用户第二次反馈看不到）。""")

patch(D + '/browser-panel-manager.js', "const PANEL_GUTTER = 10;", "const PANEL_GUTTER = 12;")
patch(D + '/browser-panel-manager.js',
""" *   面板与业务区之间留 PANEL_GUTTER(10px) 背景沟""",
""" *   面板与业务区之间留 PANEL_GUTTER(12px) 背景沟""")
print('CONTRAST DONE')
