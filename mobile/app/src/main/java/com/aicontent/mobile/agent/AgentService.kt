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
import com.aicontent.mobile.BuildConfig
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

    /** 采集设备能力（P1-14：model/系统版本/屏幕/无障碍/截图权限/电量/前台App） */
    private fun collectCapabilities(): JSONObject {
        val cap = JSONObject()
        cap.put("model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
        cap.put("androidVersion", android.os.Build.VERSION.RELEASE)
        cap.put("apiLevel", android.os.Build.VERSION.SDK_INT)
        val dm = resources.displayMetrics
        cap.put(
            "screen",
            JSONObject().put("width", dm.widthPixels).put("height", dm.heightPixels),
        )
        cap.put("accessibilityEnabled", RpaAccessibilityService.isEnabled())
        // 截图权限：Android 11+ 且无障碍已开启可 takeScreenshot；或 MediaProjection 已授权可抓帧
        // （此前只看 SDK_INT>=30，未检查无障碍是否真正开启，P3 数据准确性）
        val canScreenshot =
            (android.os.Build.VERSION.SDK_INT >= 30 && RpaAccessibilityService.isEnabled()) ||
                MediaProjectionCapture.hasPermission()
        cap.put("screenshotPermission", canScreenshot)
        try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
            cap.put("battery", bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY))
        } catch (e: Exception) {
            cap.put("battery", -1)
        }
        RpaAccessibilityService.foregroundPackage()?.let { cap.put("foregroundApp", it) }
        return cap
    }

    private suspend fun registerDevice() {
        val name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
        val uuid = deviceUuid ?: ""
        val caps = collectCapabilities().toString()
        val json = """{"deviceName":"$name","platform":"android","agentVersion":"${BuildConfig.VERSION_NAME}","deviceUuid":"$uuid","capabilities":$caps}"""
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
        // 领取任务（失败/无任务统一 delay 退避，避免后端异常时忙轮询打爆接口）
        val task: JSONObject? = try {
            val resp = postJson(
                "$BASE_URL/api/mobile-executor/tasks/claim",
                """{"deviceId":"$did"}""",
            )
            try {
                if (!resp.isSuccessful) {
                    Log.w(TAG, "claim failed: ${resp.code}")
                    null
                } else {
                    val body = resp.body?.string()
                    val data = if (body.isNullOrBlank()) null
                    else JSONObject(body).optJSONObject("data")
                    if (data == null || data.isNull("id")) null else data
                }
            } finally {
                resp.close()
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
                    RpaAccessibilityService.execute(platform, content, taskId) { r ->
                        cont.resume(r)
                    }
                }
            }
        }

        // 回传（P0-5 归属校验带 deviceId + P0-7 unknown 三态；网络抖动重试 3 次，
        // 否则 report 失败会让任务卡 executing + 账号锁到租约过期）
        val msg = result.message.replace("\"", "\\\"")
        val reportBody = when {
            result.ok -> """{"status":"done","deviceId":"$did","result":{"message":"$msg","platform":"$platform"}}"""
            result.status == "unknown" -> """{"status":"unknown","deviceId":"$did","error":"$msg"}"""
            else -> """{"status":"failed","deviceId":"$did","error":"$msg"}"""
        }
        var reported = false
        for (attempt in 1..3) {
            try {
                postJson(
                    "$BASE_URL/api/mobile-executor/tasks/$taskId/status",
                    reportBody,
                ).use { resp ->
                    if (resp.isSuccessful) {
                        reported = true
                        Log.i(TAG, "report ok: ${resp.code}")
                    } else {
                        Log.w(TAG, "report non-2xx: ${resp.code}")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "report attempt $attempt failed: ${e.message}")
            }
            if (reported) break
            if (attempt < 3) delay(5_000L)
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
        // P1-13：注册成功后，心跳与任务领取拆成两个独立协程，互不阻塞
        while (deviceId == null && coroutineContext.isActive) {
            registerDevice()
            if (deviceId == null) delay(10_000L)
        }
        if (deviceId == null) return
        coroutineScope {
            launch { heartbeatLoop() }
            launch { claimLoop() }
        }
    }

    /** 心跳独立循环：固定 60s 一次，不受任务执行时长影响（P1-13） */
    private suspend fun heartbeatLoop() {
        while (coroutineContext.isActive) {
            try {
                heartbeat()
            } catch (e: Exception) {
                Log.w(TAG, "heartbeat error: ${e.message}")
            }
            delay(HEARTBEAT_INTERVAL_MS)
        }
    }

    /** 任务领取独立循环：15s 轮询；执行任务时阻塞本循环但不影响心跳（P1-13） */
    private suspend fun claimLoop() {
        while (coroutineContext.isActive) {
            try {
                claimAndExecute()
            } catch (e: Exception) {
                Log.w(TAG, "claim loop error: ${e.message}")
                delay(5_000L)
            }
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
