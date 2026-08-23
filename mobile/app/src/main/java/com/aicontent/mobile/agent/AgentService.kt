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
import kotlin.coroutines.resume
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.json.JSONObject

/**
 * Agent 前台服务（C2 全自动）：
 * 1. 常驻前台服务（通知防杀）
 * 2. 注册设备 POST /api/mobile-executor/devices
 * 3. 心跳 POST /devices/:id/heartbeat（60s）
 * 4. 任务轮询 POST /tasks/claim → 执行（RpaAccessibilityService）→ 状态回传
 */
class AgentService : Service() {

    companion object {
        private const val TAG = "JZAgent"
        private const val CHANNEL_ID = "jz-agent"
        private const val NOTIF_ID = 1001
        private const val BASE_URL = "https://aicontent.vip.kaypal.cn"
        private const val HEARTBEAT_INTERVAL_MS = 60_000L
        private const val CLAIM_INTERVAL_MS = 15_000L
        private const val PREFS = "jz_agent"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_DEVICE_UUID = "device_uuid"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private var deviceId: String? = null
    private var deviceToken: String? = null
    private var deviceUuid: String? = null
    // 生产 API 偶发慢响应：默认 10s 超时会导致心跳/领取频繁 timeout（2026-08-09 实测）
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    override fun onCreate() {
        super.onCreate()
        try {
            startForeground(NOTIF_ID, buildNotification())
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed (通知权限未授予?): ${e.message}")
        }
        deviceId = prefs.getString(KEY_DEVICE_ID, null)
        deviceToken = prefs.getString(KEY_DEVICE_TOKEN, null)
        deviceUuid = prefs.getString(KEY_DEVICE_UUID, null) ?: java.util.UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_DEVICE_UUID, it).apply()
        }
        scope.launch {
            registerAndLoop()
        }
    }

    private fun authHeaders(): String? =
        CookieManager.getInstance().getCookie(BASE_URL)

    /** 设备 token header（P0-4：heartbeat/claim/status 用，不再复用 Cookie 伪造 deviceId） */
    private fun deviceTokenHeaders(): String? = deviceToken

    private fun postJson(url: String, json: String?): okhttp3.Response {
        val rb = Request.Builder().url(url)
        val body = json?.let {
            RequestBody.create("application/json; charset=utf-8".toMediaType(), it)
        } ?: RequestBody.create(null, ByteArray(0))
        rb.post(body)
        authHeaders()?.let { rb.header("Cookie", it) }
        deviceTokenHeaders()?.let { rb.header("x-device-token", it) }
        return client.newCall(rb.build()).execute()
    }

    private fun getJson(url: String): okhttp3.Response {
        val rb = Request.Builder().url(url)
        authHeaders()?.let { rb.header("Cookie", it) }
        return client.newCall(rb.build()).execute()
    }

    private suspend fun registerDevice() {
        val name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
        val uuid = deviceUuid ?: ""
        val json = """{"deviceName":"$name","platform":"android","agentVersion":"0.2.2","deviceUuid":"$uuid"}"""
        try {
            postJson("$BASE_URL/api/mobile-executor/devices", json).use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string()
                    deviceId = parseDeviceId(body)
                    val newToken = parseDeviceToken(body)
                    if (newToken != null) {
                        deviceToken = newToken
                        prefs.edit()
                            .putString(KEY_DEVICE_ID, deviceId)
                            .putString(KEY_DEVICE_TOKEN, newToken)
                            .apply()
                    }
                    Log.i(TAG, "register ok, deviceId=$deviceId token=${newToken != null}")
                } else {
                    Log.w(TAG, "register failed: ${resp.code}")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "register error: ${e.message}")
        }
    }

    private fun parseDeviceToken(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = JSONObject(body)
            val data = json.optJSONObject("data")
            val token = data?.optString("deviceToken").orEmpty().ifEmpty { json.optString("deviceToken") }
            token.ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun claimAndExecute() {
        val did = deviceId ?: return
        // 领取任务
        val task: JSONObject? = try {
            postJson(
                "$BASE_URL/api/mobile-executor/tasks/claim",
                """{"deviceId":"$did"}""",
            ).use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "claim failed: ${resp.code}")
                    return
                }
                val body = resp.body?.string() ?: return
                val data = JSONObject(body).optJSONObject("data")
                if (data == null || data.isNull("id")) null else data
            }
        } catch (e: Exception) {
            Log.w(TAG, "claim error: ${e.message}")
            null
        }
        if (task == null) {
            delay(CLAIM_INTERVAL_MS)
            return
        }

        val taskId = task.optString("id")
        val payload = task.optJSONObject("payload") ?: JSONObject()
        val type = task.optString("type", "publish")
        val platform = payload.optString("platform", "")
        val content = payload.optString("content", "")
        Log.i(TAG, "task claimed: $taskId type=$type platform=$platform content=${content.take(30)}")

        // running
        try {
            postJson(
                "$BASE_URL/api/mobile-executor/tasks/$taskId/status",
                """{"status":"running"}""",
            ).use { }
        } catch (e: Exception) {
            Log.w(TAG, "report running failed: ${e.message}")
        }

        // 执行 RPA（主线程编排）：按任务 type 分发
        val result = withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
                if (type == "acquisition") {
                    // P0-1 获客语义动作序列（阶段 A 骨架）
                    val actionsJson = payload.optJSONArray("actions")?.toString() ?: "[]"
                    RpaAccessibilityService.executeAcquisition(platform, actionsJson) { r ->
                        cont.resume(r)
                    }
                } else {
                    RpaAccessibilityService.execute(platform, content) { r ->
                        cont.resume(r)
                    }
                }
            }
        }

        // 回传（P0-5 归属校验带 deviceId + P0-7 unknown 三态）
        try {
            val msg = result.message.replace("\"", "\\\"")
            when {
                result.ok -> postJson(
                    "$BASE_URL/api/mobile-executor/tasks/$taskId/status",
                    """{"status":"done","deviceId":"$did","result":{"message":"$msg","platform":"$platform"}}""",
                ).use { resp -> Log.i(TAG, "report done: ${resp.code}") }
                result.status == "unknown" -> postJson(
                    "$BASE_URL/api/mobile-executor/tasks/$taskId/status",
                    """{"status":"unknown","deviceId":"$did","error":"$msg"}""",
                ).use { resp -> Log.i(TAG, "report unknown: ${resp.code}") }
                else -> postJson(
                    "$BASE_URL/api/mobile-executor/tasks/$taskId/status",
                    """{"status":"failed","deviceId":"$did","error":"$msg"}""",
                ).use { resp -> Log.i(TAG, "report failed: ${resp.code}") }
            }
        } catch (e: Exception) {
            Log.w(TAG, "report failed: ${e.message}")
        }
        delay(5_000L)
    }

    private suspend fun heartbeat() {
        val did = deviceId ?: return
        try {
            postJson("$BASE_URL/api/mobile-executor/devices/$did/heartbeat", null).use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "heartbeat failed: ${resp.code}")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "heartbeat error: ${e.message}")
        }
    }

    private suspend fun registerAndLoop() {
        while (coroutineContext.isActive) {
            try {
                if (deviceId == null) {
                    registerDevice()
                } else {
                    heartbeat()
                    claimAndExecute()
                }
            } catch (e: Exception) {
                Log.w(TAG, "loop error: ${e.message}")
                delay(5_000L)
            }
            delay(HEARTBEAT_INTERVAL_MS)
            Log.i(TAG, "heartbeat tick (deviceId=$deviceId)")
        }
    }

    private fun parseDeviceId(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = JSONObject(body)
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
            .setContentText("执行器运行中（自动回复任务）")
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
