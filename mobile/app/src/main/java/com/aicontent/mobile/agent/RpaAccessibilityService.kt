package com.aicontent.mobile.agent

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * 无障碍 RPA 服务（P5 C2 S3 骨架）：
 * 用户设置中开启「JIUZHANG AI 无障碍」后，可跨 App 操作（点击/输入/滑动）。
 * S3 实现 RpaEngine（findNodeByText/click/input），S4 各平台发布流程。
 * 当前仅注册占位（manifest 已声明）。
 */
class RpaAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // S3：事件流监听（页面变化/节点出现）
    }

    override fun onInterrupt() = Unit
}
