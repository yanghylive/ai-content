package com.aicontent.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import com.aicontent.mobile.agent.AgentService

/**
 * JIUZHANG AI WebView 壳（P5 C 组 S1）
 * 加载 H5 前端（aicontent.vip.kaypal.cn），JS 桥注入登录/语音能力。
 * agent 前台服务随壳启动（注册设备 + 心跳，S2 起任务轮询）。
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val HOME_URL = "https://aicontent.vip.kaypal.cn/today"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "${webView.settings.userAgentString} JIUZHANG-Mobile/0.1.0"
        }

        // JS 桥：语音输入（B3：H5 录音 → Android 上传 ASR → 回填文本）——S5 接
        webView.addJavascriptInterface(JsBridge(this), "JiuZhang")

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedHttpAuthRequest(
                view: WebView?,
                handler: HttpAuthHandler?,
                host: String?,
                realm: String?,
            ) = Unit
            // 登录态：H5 自行管理（cookie/session），壳不干预
        }

        // 启动 agent 前台服务（S2：注册设备 + 心跳）
        startForegroundServiceCompat()

        webView.loadUrl(HOME_URL)
    }

    private fun startForegroundServiceCompat() {
        val intent = Intent(this, AgentService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
