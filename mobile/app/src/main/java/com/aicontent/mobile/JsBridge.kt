package com.aicontent.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * JS 桥（H5 与壳交互，挂 window.JiuZhang）：
 * - 语音输入（B3）：H5 录音 blob → 壳转文件 → 上传 ASR → 回填文本（S5）
 * - agent 状态（S2+）：查询设备注册状态
 * - 手机逻辑（2026-08-09 产品方向：平台互动适配手机）：
 *   openApp（调起目标平台 App 登录/会话）、shareText（系统分享一键转发）、
 *   copyToClipboard（剪贴板）、getInstalledApps（检测已装平台 App）
 *
 * 所有方法返回 JSON 字符串，避免 JS 侧类型歧义。
 * 返回键处理不走桥：壳用 doUpdateVisitedHistory 维护历史栈（见 MainActivity）。
 */
class JsBridge(private val activity: Activity) {

    @JavascriptInterface
    fun version(): String = "0.2.0"

    @JavascriptInterface
    fun agentStatus(): String = "{\"registered\":false,\"agentVersion\":\"0.1.0\"}"

    /** H5 调：window.JiuZhang.asrUpload(base64Audio, mimeType) → 回填文本（S5 实现） */
    @JavascriptInterface
    fun asrUpload(base64Audio: String, mimeType: String) = ""

    /**
     * App 内微信一键登录（2026-08-11，需微信开放平台企业资质 AppID）。
     * 当前未接入微信 SDK（WXApi）时返回未开通提示；接入后：拉起微信授权 →
     * 回调取 code → 回传 {"ok":true,"code":"..."} 由 H5 调 /api/auth/wechat-app-login 换会话。
     */
    @JavascriptInterface
    fun wechatLogin(): String {
        val appId = BuildConfig.WECHAT_APP_ID?.takeIf { it.isNotBlank() }
        if (appId == null) {
            return err("微信一键登录未开通（需微信开放平台企业资质 AppID），请先用账号密码或扫码登录")
        }
        // TODO(wechat-sdk): 接入 com.tencent.mm.opensdk:wechat-sdk-android，
        // 用 appId 初始化 IWXAPI → sendReq(SendAuth.Req(scope="snsapi_userinfo"))，
        // 在 WXEntryActivity onResp 取 code 后经回调回传 H5。
        return err("微信 SDK 接入中，请先用账号密码或扫码登录")
    }

    /**
     * 调起目标平台 App（登录/会话入口）。
     * @param target 包名（如 com.ss.android.ugc.aweme）或深链（如 snssdk1128://）
     * 返回 {"ok":true,"message":"已调起抖音"|"未安装"}
     */
    @JavascriptInterface
    fun openApp(target: String): String {
        val input = target.trim()
        if (input.isEmpty()) return err("target 为空")
        val intent = if (input.contains("://")) {
            try {
                Intent(Intent.ACTION_VIEW, Uri.parse(input))
            } catch (e: Exception) {
                return err("深链格式无效：$input")
            }
        } else {
            activity.packageManager.getLaunchIntentForPackage(input)
        } ?: return err("未安装该应用：$input")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            activity.startActivity(intent)
            ok("已调起 ${packageLabel(input)}")
        } catch (e: ActivityNotFoundException) {
            err("未安装该应用：$input")
        } catch (e: SecurityException) {
            err("无法调起（权限受限）：$input")
        }
    }

    /** 系统分享面板（一键转发）：把文案分享到任意 App */
    @JavascriptInterface
    fun shareText(text: String): String {
        if (text.isEmpty()) return err("分享内容为空")
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            activity.startActivity(Intent.createChooser(send, "转发到"))
            ok("已唤起系统分享")
        } catch (e: ActivityNotFoundException) {
            err("系统没有可用的分享应用")
        }
    }

    /** 复制文本到剪贴板 */
    @JavascriptInterface
    fun copyToClipboard(text: String): String {
        if (text.isEmpty()) return err("复制内容为空")
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("JIUZHANG AI", text))
        return ok("已复制到剪贴板")
    }

    /**
     * 检测已安装的平台 App。返回 {"installed":[{"key":"douyin","package":"...","installed":true}, ...]}
     */
    @JavascriptInterface
    fun getInstalledApps(): String {
        val known = listOf(
            "douyin" to "com.ss.android.ugc.aweme",
            "xiaohongshu" to "com.xingin.xhs",
            "shipinhao" to "com.tencent.mm",
            "kuaishou" to "com.smile.gifmaker",
            "bilibili" to "tv.danmaku.bili",
            "weibo" to "com.sina.weibo",
            "zhihu" to "com.zhihu.android",
            "toutiao" to "com.ss.android.article.news",
        )
        val arr = org.json.JSONArray()
        for ((key, pkg) in known) {
            val item = JSONObject()
            item.put("key", key)
            item.put("package", pkg)
            item.put("installed", isAppInstalled(pkg))
            arr.put(item)
        }
        return "{\"ok\":true,\"installed\":$arr}"
    }

    /** RPA 无障碍执行器状态（前端展示「全自动执行器」是否可用） */
    @JavascriptInterface
    fun rpaStatus(): String {
        val enabled = com.aicontent.mobile.agent.RpaAccessibilityService.isEnabled()
        return "{\"ok\":true,\"enabled\":$enabled}"
    }

    /**
     * 执行 MAI-UI 结构化动作序列（PRD M2/M3）。
     * 同步等待执行结果（最长 95s）：H5 调 window.JiuZhang.executeActions(json) 直接拿结果。
     * 动作来自 /api/mai-ui/actions 规划；ask_user 会暂停并返回 ASK_USER: 前缀，
     * H5 用 resumeAfterAsk 继续/中止。
     */
    @JavascriptInterface
    fun executeActions(actionsJson: String, taskId: String): String {
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<String>(1)
        com.aicontent.mobile.agent.RpaAccessibilityService.executeActions(actionsJson, taskId) { result ->
            holder[0] = "{\"ok\":${result.ok},\"message\":\"${escapeJson(result.message)}\"}"
            latch.countDown()
        }
        try {
            if (!latch.await(95, TimeUnit.SECONDS)) {
                return "{\"ok\":false,\"message\":\"动作执行超时\"}"
            }
        } catch (_: InterruptedException) {
            return "{\"ok\":false,\"message\":\"动作执行被中断\"}"
        }
        return holder[0] ?: "{\"ok\":false,\"message\":\"执行结果丢失\"}"
    }

    /** ask_user 暂停后：H5 答复继续（true）或中止（false）；currentHash 审批动作 hash（防篡改） */
    @JavascriptInterface
    fun resumeAfterAsk(proceed: Boolean, approvalId: String, currentHash: String): String {
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<String>(1)
        com.aicontent.mobile.agent.RpaAccessibilityService.resumeAfterAsk(proceed, approvalId, currentHash) { result ->
            holder[0] = "{\"ok\":${result.ok},\"message\":\"${escapeJson(result.message)}\"}"
            latch.countDown()
        }
        try {
            latch.await(5, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
        return holder[0] ?: "{\"ok\":false,\"message\":\"无响应\"}"
    }

    /** 中止正在执行的动作序列。 */
    @JavascriptInterface
    fun cancelActions(): String {
        com.aicontent.mobile.agent.RpaAccessibilityService.cancelActions()
        return "{\"ok\":true,\"message\":\"已取消\"}"
    }

    /** 暂停执行（M2） */
    @JavascriptInterface
    fun pauseActions(): String {
        val r = com.aicontent.mobile.agent.RpaAccessibilityService.pauseActions()
        return "{\"ok\":${r.ok},\"message\":\"${escapeJson(r.message)}\"}"
    }

    /** 继续执行（M2） */
    @JavascriptInterface
    fun resumeActions(): String {
        val r = com.aicontent.mobile.agent.RpaAccessibilityService.resumeActions()
        return "{\"ok\":${r.ok},\"message\":\"${escapeJson(r.message)}\"}"
    }

    /**
     * 截取当前屏幕。
     * 优先级：MediaProjection（兼容 Android 8+，需授权）→ 无障碍 takeScreenshot（Android 11+）。
     * 返回 {"ok":true,"message":"data:image/jpeg;base64,xxx","width":540,...} 或错误。
     */
    @JavascriptInterface
    fun captureScreen(): String {
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<String>(1)
        // 是否已回退过无障碍（MediaProjection 失败后仅回退一次，避免无限重试）
        var fellBackToAccessibility = false
        lateinit var done: (com.aicontent.mobile.agent.RpaResult) -> Unit
        done = fun(result: com.aicontent.mobile.agent.RpaResult) {
            if (result.ok) {
                // 消息格式: data:image/jpeg;base64,xxx|w=540&h=1200&sw=1080&sh=2400
                val meta = Regex("\\|w=(\\d+)&h=(\\d+)&sw=(\\d+)&sh=(\\d+)\$").find(result.message)
                if (meta != null) {
                    val dataUrl = result.message.substring(0, meta.range.first)
                    holder[0] = "{\"ok\":true,\"message\":\"${escapeJson(dataUrl)}\"," +
                        "\"width\":${meta.groupValues[1]},\"height\":${meta.groupValues[2]}," +
                        "\"screenWidth\":${meta.groupValues[3]},\"screenHeight\":${meta.groupValues[4]}}"
                } else {
                    holder[0] = "{\"ok\":true,\"message\":\"${escapeJson(result.message)}\"}"
                }
                latch.countDown()
                return
            }
            if (!fellBackToAccessibility &&
                android.os.Build.VERSION.SDK_INT >= 30 &&
                com.aicontent.mobile.agent.MediaProjectionCapture.hasPermission()
            ) {
                // MediaProjection 失败 → 回退无障碍 takeScreenshot（Android 11+，仅一次）
                fellBackToAccessibility = true
                com.aicontent.mobile.agent.RpaAccessibilityService.captureScreen(done)
                return
            }
            holder[0] = "{\"ok\":false,\"message\":\"${escapeJson(result.message)}\"}"
            latch.countDown()
        }
        // 1) 已授权 MediaProjection → 优先（覆盖 Android 8+）
        if (com.aicontent.mobile.agent.MediaProjectionCapture.hasPermission()) {
            com.aicontent.mobile.agent.MediaProjectionCapture.capture(activity, 540, 1200, done)
        } else {
            // 2) Android 11+ 无障碍截图（置回退标志，避免无障碍失败再回退自己）
            fellBackToAccessibility = true
            com.aicontent.mobile.agent.RpaAccessibilityService.captureScreen(done)
        }
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                return "{\"ok\":false,\"message\":\"截图超时\"}"
            }
        } catch (_: InterruptedException) {
            return "{\"ok\":false,\"message\":\"截图被中断\"}"
        }
        return holder[0] ?: "{\"ok\":false,\"message\":\"截图结果丢失\"}"
    }

    /** 发起屏幕录制授权（老设备 Android 8-10 截屏前需用户授权系统弹窗） */
    @JavascriptInterface
    fun requestScreenCapture(): String {
        val activity = activity as? android.app.Activity
        if (activity == null) return "{\"ok\":false,\"message\":\"当前无 Activity 上下文\"}"
        activity.runOnUiThread {
            com.aicontent.mobile.agent.MediaProjectionCapture.requestAuth(activity)
        }
        return "{\"ok\":true,\"message\":\"已发起屏幕录制授权，请在系统弹窗点击允许\"}"
    }

    private fun escapeJson(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ")

    /**
     * H5 主题切换时同步原生状态栏（沉浸式下状态栏图标/底色需随浅深色反色）。
     * @param mode "light" 或 "dark"
     */
    @JavascriptInterface
    fun setThemeMode(mode: String) {
        (activity as? MainActivity)?.applyThemeMode(mode)
    }

    private fun isAppInstalled(pkg: String): Boolean {
        return try {
            activity.packageManager.getPackageInfo(pkg, 0) != null
        } catch (e: Exception) {
            false
        }
    }

    private fun packageLabel(target: String): String {
        val map = mapOf(
            "com.ss.android.ugc.aweme" to "抖音",
            "com.xingin.xhs" to "小红书",
            "com.tencent.mm" to "微信/视频号",
            "com.smile.gifmaker" to "快手",
            "tv.danmaku.bili" to "B站",
            "com.sina.weibo" to "微博",
            "com.zhihu.android" to "知乎",
            "com.ss.android.article.news" to "头条",
        )
        val clean = target.substringBefore("://")
        return map[clean] ?: clean
    }

    private fun ok(message: String): String =
        JSONObject().put("ok", true).put("message", message).toString()

    private fun err(message: String): String =
        JSONObject().put("ok", false).put("message", message).toString()
}
