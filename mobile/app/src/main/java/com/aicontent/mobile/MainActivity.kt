package com.aicontent.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Log
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
        // debug 包 → BuildConfig.HOME_BASE（gradle -PhomeBase= 注入；默认 10.0.2.2 本机联调，
        //   传 https://aicontent.vip.kaypal.cn 即出线上真机包）
        // release 包 → 生产线上
        val HOME_URL =
            if (BuildConfig.DEBUG) "${BuildConfig.HOME_BASE}/today"
            else "https://aicontent.vip.kaypal.cn/today"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // debug 包开启 WebView 远程调试（CDP 自动化测试用；release 不暴露）
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val webView = WebView(this)
        setContentView(webView)

        // 清掉旧的 HttpCache：Next.js 静态资源默认 max-age=2592000 + immutable，
        // 老的 APK 装了之后再升级 H5，WebView 仍可能命中上一次部署的 chunk hash，
        // 导致 fetch base URL 走旧 fallback。每启启动清一次就够了。
        webView.clearCache(true)
        webView.clearHistory()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "${webView.settings.userAgentString} JIUZHANG-Mobile/0.1.0"
            // 服务器永远是真值，APK WebView 不要拿本地缓存的 chunk
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        // JS 桥：语音输入（B3：H5 录音 → Android 上传 ASR → 回填文本）——S5 接
        webView.addJavascriptInterface(JsBridge(this), "JiuZhang")

        // ChromeClient：把 H5 console 转 logcat（tag JIUZHANG），真机可 adb logcat -s JIUZHANG
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                val level = when (message.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                    ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                    else -> Log.INFO
                }
                Log.println(
                    level,
                    "JIUZHANG",
                    "[${message.sourceId()}:${message.lineNumber()}] ${message.message()}",
                )
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedHttpAuthRequest(
                view: WebView?,
                handler: HttpAuthHandler?,
                host: String?,
                realm: String?,
            ) = Unit

            // 所有导航（含 kaypal.cn 授权页）都留在当前 WebView，不甩给外部浏览器，
            // 否则授权完回不到壳里。未开 setSupportMultipleWindows，target=_blank
            // 也会走这里，不需要 onCreateWindow。
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean = false

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                Log.e(
                    "JIUZHANG",
                    "load error ${request?.url} -> ${error?.errorCode} ${error?.description}",
                )
            }
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
