package com.aicontent.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.webkit.*
import androidx.activity.OnBackPressedCallback
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

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // debug 包开启 WebView 远程调试（CDP 自动化测试用；release 不暴露）
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this)
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
            // UA 带 App 版本（跟随 BuildConfig，升级自动同步，服务端可识别版本）
            userAgentString =
                "${webView.settings.userAgentString} JIUZHANG-Mobile/${BuildConfig.VERSION_NAME}"
            // 系统字体放大不缩放 H5（无障碍放大由 H5 自带 hook 处理，避免 WebView 二次缩放撑爆布局）
            textZoom = 100
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

            // 访问历史栈：硬导航和 SPA pushState 软导航都会回调（isReload 除外）。
            // WebView 原生栈不感知 pushState（canGoBack 恒 false），壳自己维护 URL 栈：
            //   前进 → push；回退（新 URL == 栈顶下一个）→ pop。返回键据此决定回退还是退出。
            override fun doUpdateVisitedHistory(
                view: WebView?,
                url: String?,
                isReload: Boolean,
            ) {
                super.doUpdateVisitedHistory(view, url, isReload)
                if (isReload || url.isNullOrBlank()) return
                when {
                    visitStack.isEmpty() -> visitStack.addLast(url)
                    visitStack.last() == url -> Unit // 同 URL 重复回调（Next.js 软导航多次触发），忽略
                    visitStack.size >= 2 && visitStack.elementAt(visitStack.size - 2) == url -> visitStack.removeLast() // 回退
                    else -> visitStack.addLast(url)
                }
                Log.i("JIUZHANG", "visit stack(${visitStack.size}): ${visitStack.take(3)}")
            }
            // 登录态：H5 自行管理（cookie/session），壳不干预
        }

        // 启动 agent 前台服务（S2：注册设备 + 心跳）
        startForegroundServiceCompat()

        // 系统返回键（WebView 原生栈不感知 SPA pushState，由壳 URL 栈兜底）：
        //   1) WebView 原生栈可回退（整页硬导航）→ goBack()
        //   2) 壳栈 > 1（有 SPA 软导航历史）→ history.back()（栈在 doUpdateVisitedHistory 回调里出栈）
        //   3) 首页/无历史 → 退出 App
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    Log.i("JIUZHANG", "back: canGoBack=${webView.canGoBack()} stack=${visitStack.size} url=${webView.url}")
                    when {
                        webView.canGoBack() -> webView.goBack()
                        visitStack.size > 1 -> webView.evaluateJavascript("window.history.back()", null)
                        else -> {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            },
        )

        webView.loadUrl(HOME_URL)
    }

    /** 壳层访问历史栈（pushState 软导航也入栈；history.back 出栈） */
    private val visitStack = ArrayDeque<String>()

    private fun startForegroundServiceCompat() {
        val intent = Intent(this, AgentService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
