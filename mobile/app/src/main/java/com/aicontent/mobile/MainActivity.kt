package com.aicontent.mobile

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
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
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: LinearLayout
    private lateinit var swipeRefresh: SwipeRefreshLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // debug 包开启 WebView 远程调试（CDP 自动化测试用；release 不暴露）
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // 沉浸式状态栏：内容延伸到状态栏区域，状态栏图标按浅/深主题用反色
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }

        webView = WebView(this)

        // 下拉刷新容器（批次 C #11）：仅 WebView 滚动到顶时允许下拉，避免手势冲突
        swipeRefresh = SwipeRefreshLayout(this).apply {
            setColorSchemeResources(android.R.color.holo_blue_dark, android.R.color.holo_orange_light)
            isEnabled = true
            setOnRefreshListener {
                webView.reload()
                // 刷新结束由 onPageFinished 收起指示器（见 webViewClient）
            }
            addView(
                webView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        // 滚动到顶才允许下拉（防列表中部误触）
        webView.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            swipeRefresh.isEnabled = scrollY == 0 && errorView.visibility != View.VISIBLE
        }

        val root = FrameLayout(this).apply {
            addView(
                swipeRefresh,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }

        // 顶部线性加载进度条（H5 加载时显示，加载完淡出）
        progressBar = ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal,
        ).apply {
            max = 100
            progress = 0
            visibility = View.GONE
            // 进度条可点击穿透（不拦截 WebView 触摸）
            isClickable = false
        }
        root.addView(
            progressBar,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                progressBarHeight(),
                android.view.Gravity.TOP,
            ),
        )

        // 断网/加载失败错误视图（品牌色底 + 重试按钮）
        errorView = buildErrorView()
        root.addView(
            errorView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        errorView.visibility = View.GONE

        setContentView(root)

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

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                // 加载进度条：<100 显示，==100 隐藏
                if (newProgress < 100) {
                    if (progressBar.visibility != View.VISIBLE) progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                    progressBar.progress = 0
                }
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
                val code = error?.errorCode ?: -1
                Log.e(
                    "JIUZHANG",
                    "load error ${request?.url} -> code=$code ${error?.description}",
                )
                // 仅主资源加载失败才显示错误页；过滤后台请求/取消(code=-1)与子资源
                if (request?.isForMainFrame == true && code != -1) {
                    runOnUiThread {
                        webView.visibility = View.GONE
                        errorView.visibility = View.VISIBLE
                    }
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                // 新导航开始：恢复 webview（进度条在 onProgressChanged 显示），错误页由 onReceivedError 决定
                if (errorView.visibility == View.VISIBLE) {
                    errorView.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // 下拉刷新完成：收起指示器
                if (swipeRefresh.isRefreshing) {
                    swipeRefresh.isRefreshing = false
                }
                // 注意：失败导航也会触发 onPageFinished（url 可能为 null/原地址），
                // 错误页恢复统一在 onPageStarted 处理，这里不做，避免错误页被立即隐藏。
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
                        // 登录页按返回 = 退出 App（避免 today→login 重定向链让栈恒>1 退不出）
                        webView.url?.contains("/login") == true -> {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
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

    /** 进度条高度（dp→px） */
    private fun progressBarHeight(): Int =
        (resources.displayMetrics.density * 3).toInt()

    /** 断网/加载失败错误视图：品牌色底 + 文案 + 重试按钮 */
    private fun buildErrorView(): LinearLayout {
        val bg = if (BuildConfig.DEBUG) Color.parseColor("#0d1b2f") else Color.parseColor("#0d1b2f")
        val retry = TextView(this).apply {
            text = "重试"
            textSize = 15f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#2f6db4"))
            gravity = android.view.Gravity.CENTER
        }
        // 用 padding 直接实现（避免依赖 dimen 资源）
        retry.setPadding(dp(20), dp(10), dp(20), dp(10))
        retry.setOnClickListener {
            // 重新加载首页
            errorView.visibility = View.GONE
            webView.visibility = View.VISIBLE
            webView.loadUrl(HOME_URL)
        }
        val label = TextView(this).apply {
            text = "网络开小差了，请检查网络后重试"
            textSize = 14f
            setTextColor(Color.parseColor("#d7e6f8"))
            gravity = android.view.Gravity.CENTER
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setBackgroundColor(bg)
            addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })
            addView(retry, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
    }

    /** dp→px */
    private fun dp(v: Int): Int = (resources.displayMetrics.density * v).toInt()

    /**
     * H5 主题联动原生状态栏：浅色 → 深色状态栏图标 + 浅底；深色 → 浅色图标 + 深底。
     * 由 JsBridge.setThemeMode 从 H5 调用（沉浸式窗口，状态栏覆盖在 H5 上）。
     */
    fun applyThemeMode(mode: String) {
        runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val light = mode != "dark"
                    val vis = window.decorView.systemUiVisibility
                    if (light) {
                        window.decorView.systemUiVisibility = vis or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    } else {
                        window.decorView.systemUiVisibility = vis and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                    }
                }
                window.statusBarColor = Color.parseColor(if (mode != "dark") "#eef2f7" else "#17151d")
            } catch (e: Exception) {
                Log.w("JIUZHANG", "applyThemeMode failed: ${e.message}")
            }
        }
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
