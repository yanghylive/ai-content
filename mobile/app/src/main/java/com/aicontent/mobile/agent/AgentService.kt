package com.aicontent.mobile.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import android.webkit.CookieManager
import kotlin.coroutines.coroutineContext
import okhttp3.MediaType.Companion.toMediaType
import kotlinx.coroutines.*

/**
 * Agent 前台服务（P5 C2 S2 骨架）：
 * 1. 常驻前台服务（通知防杀）
 * 2. 注册设备 POST /api/mobile-executor/devices
 * 3. 心跳 POST /devices/:id/heartbeat（60s）
 * 4. 任务轮询 POST /tasks/claim（S2 后接 RpaEngine）
 */
class AgentService : Service() {

    companion object {
        private const val TAG = "JZAgent"
        private const val CHANNEL_ID = "jz-agent"
        private const val NOTIF_ID = 1001
        private const val BASE_URL = "https://aicontent.vip.kaypal.cn"
        private const val HEARTBEAT_INTERVAL_MS = 60_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var deviceId: String? = null

    override fun onCreate() {
        super.onCreate()
        try {
            startForeground(NOTIF_ID, buildNotification())
        } catch (e: Exception) {
            // Android 13+ 需要 POST_NOTIFICATIONS 运行时权限，未授权时 startForeground
            // 会抛 SecurityException。这里吞掉，避免把整个 App 启动时带崩
            // （服务退化为普通后台服务，心跳照常，只是没有常驻通知）。
            // 待 S5 真实 agent 功能落地时，应在 MainActivity 里先 requestPermissions 再启动。
            Log.w(TAG, "startForeground failed (通知权限未授予?): ${e.message}")
        }
        scope.launch {
            registerAndLoop()
        }
    }

    private suspend fun registerDevice() {
        val name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
        // 从 WebView 取登录会话 cookie 注入请求头，设备注册不再因缺登录态 401
        val cookies = CookieManager.getInstance().getCookie(BASE_URL)
        val requestBuilder = okhttp3.Request.Builder()
            .url("$BASE_URL/api/mobile-executor/devices")
            .post(
                okhttp3.RequestBody.create(
                    "application/json; charset=utf-8".toMediaType(),
                    """{"deviceName":"$name","platform":"android","agentVersion":"0.1.0"}""",
                ),
            )
        if (!cookies.isNullOrEmpty()) {
            requestBuilder.header("Cookie", cookies)
            Log.i(TAG, "inject webview cookie for device register")
        } else {
            Log.w(TAG, "no webview cookie yet (未登录?)")
        }
        okhttp3.OkHttpClient().newCall(requestBuilder.build()).execute().use { resp ->
            if (resp.isSuccessful) {
                deviceId = parseDeviceId(resp.body?.string())
                Log.i(TAG, "register ok, deviceId=$deviceId")
            } else {
                Log.w(TAG, "register failed: ${resp.code}")
            }
        }
    }

    private suspend fun registerAndLoop() {
        // 心跳循环：未注册成功前每个周期重试注册（用户登录后 WebView cookie 就位即可注册成功）
        while (coroutineContext.isActive) {
            try {
                if (deviceId == null) {
                    registerDevice()
                }
            } catch (e: Exception) {
                Log.w(TAG, "register failed: ${e.message}")
            }
            delay(HEARTBEAT_INTERVAL_MS)
            Log.i(TAG, "heartbeat tick (deviceId=$deviceId)")
        }
    }

    /** 从注册响应里解析设备 ID（真实响应结构为 { success, data: { id } }）。 */
    private fun parseDeviceId(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = org.json.JSONObject(body)
            val data = json.optJSONObject("data")
            val id = data?.optString("id").orEmpty().ifEmpty { json.optString("id") }
            id.ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "AI 执行器", NotificationManager.IMPORTANCE_LOW),
            )
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("JIUZHANG AI")
            .setContentText("执行器运行中（后台发布任务）")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
