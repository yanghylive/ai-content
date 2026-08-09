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

/**
 * JS 桥（H5 与壳交互，挂 window.JiuZhang）：
 * - 语音输入（B3）：H5 录音 blob → 壳转文件 → 上传 ASR → 回填文本（S5）
 * - agent 状态（S2+）：查询设备注册状态
 * - 手机逻辑（2026-08-09 产品方向：平台互动适配手机）：
 *   openApp（调起目标平台 App 登录/会话）、shareText（系统分享一键转发）、
 *   copyToClipboard（剪贴板）、getInstalledApps（检测已装平台 App）
 *
 * 所有方法返回 JSON 字符串，避免 JS 侧类型歧义。
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
     * 调起目标平台 App（登录/会话入口）。
     * @param target 包名（如 com.ss.android.ugc.aweme）或深链（如 snssdk1128://）
     * 返回 {"ok":true,"message":"已调起抖音"|"未安装"}
     */
    @JavascriptInterface
    fun openApp(target: String): String {
        val input = target.trim()
        if (input.isEmpty()) return err("target 为空")
        val intent: Intent? = if (input.contains("://")) {
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
