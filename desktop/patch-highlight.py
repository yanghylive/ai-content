# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:46], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

M = '/Users/yanghy/Documents/New project/ai-content/desktop/browser-panel-manager.js'

# 构造态
patch(M, """    /** Agent/面板活动日志（时间戳记录，供控制条底部活动条回看） */
    this._activityLog = [];""",
"""    /** Agent/面板活动日志（时间戳记录，供控制条底部活动条回看） */
    this._activityLog = [];
    /** 当前待批高亮的目标 selector（审批浮层"批准前看到点哪里"；导航后重注入） */
    this._highlightSelector = null;""")

# updateApprovalList：驱动高亮
patch(M, """    // 条数变化会改变浮层高度 → 重新定位；为 0 时顺手隐藏
    if (this._visible) this.relayout();
    else if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      this.approvalView.setVisible(false);
    }
  }""",
"""    // 条数变化会改变浮层高度 → 重新定位；为 0 时顺手隐藏
    if (this._visible) this.relayout();
    else if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      this.approvalView.setVisible(false);
    }
    // 审批高亮：有待批动作时在面板页面里标出"要点哪里"（最早的待批优先），
    // 清空则移除标记。导航类动作没有元素目标，跳过。
    const target = list.find((a) => a && a.summary && typeof a.summary.selector === 'string' && a.summary.selector);
    this.setPendingHighlight(target ? target.summary.selector : null);
  }

  /**
   * 在面板页面里给待批动作的目标元素叠一个描边脉冲标记（主进程 CDP 注入，
   * 与 Agent 执行链共用同一 debugger 通道，第三方页面零特权姿态不变）。
   * 记下的 selector 在页面导航完成后自动重注入；失败静默（高亮是辅助反馈）。
   */
  async setPendingHighlight(selector) {
    const next = typeof selector === 'string' && selector ? selector : null;
    this._highlightSelector = next;
    await this._applyPendingHighlight();
  }

  async _applyPendingHighlight() {
    const wc = this.panelView && !this.panelView.webContents.isDestroyed() ? this.panelView.webContents : null;
    if (!wc) return;
    if (!this._highlightSelector) {
      // 清除：只动我们自己挂的节点，不碰页面
      try {
        if (wc.debugger.isAttached()) {
          await wc.debugger.sendCommand('Runtime.evaluate', {
            expression: "(function(){var n=document.getElementById('__kaypal_hl__');if(n)n.remove();return 1;})()",
          });
        }
      } catch (e) { /* ignore */ }
      return;
    }
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const sel = JSON.stringify(this._highlightSelector);
      const expression = `(function(){
        try {
          var old = document.getElementById('__kaypal_hl__'); if (old) old.remove();
          var el = document.querySelector(${sel});
          if (!el) return false;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          var box = document.createElement('div');
          box.id = '__kaypal_hl__';
          var st = document.createElement('style');
          st.textContent = '@keyframes kaypal-hl-pulse{0%,100%{box-shadow:0 0 0 4px rgba(114,46,209,.28)}50%{box-shadow:0 0 0 12px rgba(114,46,209,.06)}}';
          box.appendChild(st);
          var place = function(){
            if (!document.getElementById('__kaypal_hl__')) return;
            var r = el.getBoundingClientRect();
            var s = box.style;
            s.position='fixed'; s.left=(r.left-5)+'px'; s.top=(r.top-5)+'px';
            s.width=(r.width+10)+'px'; s.height=(r.height+10)+'px';
            s.border='2px solid #722ed1'; s.borderRadius='8px';
            s.zIndex='2147483000'; s.pointerEvents='none';
            s.animation='kaypal-hl-pulse 1.4s ease-in-out infinite';
            s.background='rgba(114,46,209,.06)';
          };
          box.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0';
          (document.body || document.documentElement).appendChild(box);
          place();
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place, true);
          return true;
        } catch (e) { return false; }
      })()`;
      await wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true });
    } catch (e) {
      /* 高亮失败不干扰审批流程 */
    }
  }""")

# 导航完成后重注入
patch(M, """    wc.on('did-finish-load', () => push({ status: 'ready' }));""",
"""    wc.on('did-finish-load', () => {
      push({ status: 'ready' });
      // 页面换了，高亮标记随之消失——还有待批动作时重注入
      if (this._highlightSelector) this._applyPendingHighlight();
    });""")
print('HIGHLIGHT DONE')
