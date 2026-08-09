package com.aicontent.mobile.agent

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/** RPA 执行结果 */
data class RpaResult(val ok: Boolean, val message: String) {
    companion object {
        fun success(m: String) = RpaResult(true, m)
        fun failure(m: String) = RpaResult(false, m)
    }
}

/**
 * RPA 无障碍执行引擎（C2 全自动）：
 * 驱动目标平台 App 完成「回复私信（dm-reply）」：
 * 1. 调起目标 App（平台包名）
 * 2. 等目标窗口就绪（onAccessibilityEvent 驱动 + 轮询兜底）
 * 3. 找输入框（EditText）→ ACTION_SET_TEXT 输入回复内容
 * 4. 找「发送」按钮 → ACTION_CLICK
 * 5. 回调执行结果
 *
 * AgentService 通过 companion.instance.execute() 调用；执行编排在主线程 Handler。
 */
class RpaAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "JZRpa"
        private const val EXEC_TIMEOUT_MS = 30_000L

        @Volatile
        var instance: RpaAccessibilityService? = null
            private set

        /** 平台 key → 包名（与前端 mobile-bridge / JsBridge 保持一致） */
        val PLATFORM_PACKAGES = mapOf(
            "douyin" to "com.ss.android.ugc.aweme",
            "xiaohongshu" to "com.xingin.xhs",
            "shipinhao" to "com.tencent.mm",
            "gongzhonghao" to "com.tencent.mm",
            "kuaishou" to "com.smile.gifmaker",
            "bilibili" to "tv.danmaku.bili",
            "weibo" to "com.sina.weibo",
            "zhihu" to "com.zhihu.android",
            "toutiao" to "com.ss.android.article.news",
        )

        @Volatile
        private var pendingCallback: ((RpaResult) -> Unit)? = null
        @Volatile
        private var pendingPackage: String? = null
        @Volatile
        private var pendingContent: String? = null
        @Volatile
        private var pendingPlatform: String? = null

        private val handler = Handler(Looper.getMainLooper())

        fun isEnabled(): Boolean = instance != null

        /**
         * 执行 RPA 动作（AgentService 调用）。
         * @param platform 平台 key（douyin/xiaohongshu/shipinhao...）
         * @param content  回复内容
         */
        fun execute(
            platform: String,
            content: String,
            callback: (RpaResult) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                callback(RpaResult.failure("无障碍服务未开启（请在系统设置中开启 JIUZHANG AI 的无障碍权限）"))
                return
            }
            val pkg = PLATFORM_PACKAGES[platform]
            if (pkg == null) {
                callback(RpaResult.failure("不支持的平台：$platform"))
                return
            }
            if (content.isBlank()) {
                callback(RpaResult.failure("回复内容为空"))
                return
            }
            pendingPlatform = platform
            pendingPackage = pkg
            pendingContent = content
            pendingCallback = callback
            handler.post { svc.launchApp(pkg) }
            handler.postDelayed({ timeoutIfPending() }, EXEC_TIMEOUT_MS)
        }

        private fun timeoutIfPending() {
            val cb = pendingCallback ?: return
            pendingCallback = null
            cb(RpaResult.failure("RPA 执行超时（30s）"))
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "accessibility service connected")
    }

    override fun onDestroy() {
        instance = null
        pendingCallback = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val cb = pendingCallback ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            attemptIfReady(cb)
        }
    }

    override fun onInterrupt() {}

    private fun launchApp(pkg: String) {
        try {
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent == null) {
                finishWith(RpaResult.failure("未安装该应用：$pkg（请在手机安装对应平台 App）"))
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            // 窗口就绪由 onAccessibilityEvent 驱动；加轮询兜底（事件可能没触发）
            handler.postDelayed({ pollIfPending() }, 1500L)
        } catch (e: Exception) {
            finishWith(RpaResult.failure("调起失败：${e.message}"))
        }
    }

    private fun pollIfPending() {
        val cb = pendingCallback ?: return
        attemptIfReady(cb)
    }

    private fun attemptIfReady(cb: (RpaResult) -> Unit) {
        val root = rootInActiveWindow ?: return
        val pkg = pendingPackage ?: return
        val currentPkg = root.packageName?.toString() ?: ""
        // 目标 App 尚未到前台：稍后再试
        if (currentPkg != pkg) {
            handler.postDelayed({ if (pendingCallback != null) attemptIfReady(cb) }, 800L)
            return
        }
        val content = pendingContent ?: return
        finishWith(performDmReply(root, content))
    }

    /** 回复私信：找输入框 → 输入 → 找发送按钮 → 点击 */
    private fun performDmReply(root: AccessibilityNodeInfo, content: String): RpaResult {
        val input = findInput(root)
        if (input == null) {
            return RpaResult.failure("已打开目标 App，但未找到输入框（可能不在会话页，请先进入会话）")
        }
        val args = Bundle()
        args.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            content,
        )
        val setOk = input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        if (!setOk) {
            return RpaResult.failure("输入回复内容失败")
        }
        // 找发送按钮（中文优先，英文兜底）
        val send = findButton(root, "发送") ?: findButton(root, "Send")
        if (send != null) {
            val clickOk = send.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            return if (clickOk) {
                RpaResult.success("已输入回复并点击发送")
            } else {
                RpaResult.success("已输入回复内容，但发送按钮点击失败，请人工发送")
            }
        }
        return RpaResult.success("已输入回复内容（未找到发送按钮，请人工发送）")
    }

    private fun findInput(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var depth = 0
        while (stack.isNotEmpty() && depth < 400) {
            depth++
            val node = stack.removeLast()
            if (node.className?.toString()?.contains("EditText") == true) {
                return node
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun findButton(
        root: AccessibilityNodeInfo,
        text: String,
    ): AccessibilityNodeInfo? {
        val byText = root.findAccessibilityNodeInfosByText(text)
        for (n in byText) {
            if (n.isClickable) return n
        }
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var depth = 0
        while (stack.isNotEmpty() && depth < 400) {
            depth++
            val node = stack.removeLast()
            if (node.isClickable &&
                (node.text?.toString()?.contains(text) == true ||
                    node.contentDescription?.toString()?.contains(text) == true)
            ) {
                return node
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun finishWith(result: RpaResult) {
        val cb = pendingCallback ?: return
        pendingCallback = null
        pendingPackage = null
        pendingContent = null
        pendingPlatform = null
        cb(result)
    }
}
