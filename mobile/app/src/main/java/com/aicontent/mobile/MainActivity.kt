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
        const val HOME_URL = "https://aicontent.vip.kaypal.cn/today"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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

        // ChromeClient：把 H5 console 转 logcat（tag JIUZHANG），并支持 target=_blank
        // 在当前 WebView 内打开（手机 WebView 默认不支持多窗口，不处理则授权页按钮点不动）
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

            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?,
            ): Boolean {
                // 把新窗口（target=_blank）在当前 WebView 内打开，保留 /today 历史
                val newWebView = WebView(this@MainActivity).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            // 授权页加载完，把控制权交还主 WebView
                            (view?.parent as? android.view.ViewGroup)?.removeView(view)
                            setContentView(webView)
                        }
                    }
                }
                newWebView.webChromeClient = this
                val transport = resultMsg?.obj as? WebView.WebViewTransport
                transport?.webView = newWebView
                resultMsg?.sendToTarget()
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
