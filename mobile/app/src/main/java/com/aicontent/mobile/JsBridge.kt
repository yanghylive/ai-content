package com.aicontent.mobile

import android.app.Activity
import android.webkit.JavascriptInterface

/**
 * JS 桥（H5 与壳交互）：
 * - 语音输入（B3）：H5 录音 blob → 壳转文件 → 上传 /api/ai/asr → 回填文本
 * - agent 状态（S2+）：H5 可查询设备注册状态
 * S5 阶段实现 ASR 上传；当前仅占位协议。
 */
class JsBridge(private val activity: Activity) {

    @JavascriptInterface
    fun version(): String = "0.1.0"

    @JavascriptInterface
    fun agentStatus(): String = "{\"registered\":false,\"agentVersion\":\"0.1.0\"}"

    /** H5 调：window.JiuZhang.asrUpload(base64Audio, mimeType) → 回填文本（S5 实现） */
    @JavascriptInterface
    fun asrUpload(base64Audio: String, mimeType: String) = ""
}
