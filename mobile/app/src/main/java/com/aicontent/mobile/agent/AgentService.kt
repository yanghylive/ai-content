package com.aicontent.mobile.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
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
        startForeground(NOTIF_ID, buildNotification())
        scope.launch {
            registerAndLoop()
        }
    }

    private suspend fun registerAndLoop() {
        try {
            // S2：设备注册（deviceName = 本机型号；鉴权走 H5 会话 cookie，需 S5 接登录态）
            val name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
            val resp = okhttp3.OkHttpClient().newCall(
                okhttp3.Request.Builder()
                    .url("$BASE_URL/api/mobile-executor/devices")
                    .post(
                        okhttp3.RequestBody.create(
                            "application/json; charset=utf-8".toMediaType(),
                            """{"deviceName":"$name","platform":"android","agentVersion":"0.1.0"}""",
                        ),
                    )
                    .build(),
            ).execute()
            // 注册需登录态（H5 cookie）——S5 从 WebView cookie 注入；当前循环重试
            Log.i(TAG, "register resp: ${resp.code}")
        } catch (e: Exception) {
            Log.w(TAG, "register failed: ${e.message}")
        }

        // 心跳循环（S2 骨架：注册成功后定时上报；当前打印占位）
        while (coroutineContext.isActive) {
            delay(HEARTBEAT_INTERVAL_MS)
            Log.i(TAG, "heartbeat tick (deviceId=$deviceId)")
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
