package com.aicontent.mobile.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.ByteArrayOutputStream
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** RPA 执行结果 */
data class RpaResult(
    val ok: Boolean,
    val message: String,
    val status: String = if (ok) "success" else "failure", // success | failure | unknown
) {
    companion object {
        fun success(m: String) = RpaResult(true, m, "success")
        fun failure(m: String) = RpaResult(false, m, "failure")
        fun unknown(m: String) = RpaResult(false, m, "unknown")
    }
}

/** 获客语义动作（P0-1 阶段 A：与后端 ACQUISITION_ACTION_TYPES 对齐） */
data class AcqAction(
    val type: String, // search/read_results/identify_lead/open_profile/generate_draft/send_dm/save_lead
    val keyword: String = "",
    val content: String = "",
)

/**
 * RPA 无障碍执行引擎（C2 全自动）：
 * 驱动目标平台 App 完成「回复私信（dm-reply）」：
 * 1. 调起目标 App（平台包名）
 * 2. 等目标窗口就绪（onAccessibilityEvent 驱动 + 轮询兜底）
 * 3. 找输入框（EditText）→ ACTION_SET_TEXT 输入回复内容
 * 4. 找「发送」按钮 → ACTION_CLICK
 * 5. 回调执行结果
 *
 * AgentService 通过 companion.instance.execute() 调用；执行编排在主线程 Handler。
 */
class RpaAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "JZRpa"
        private const val EXEC_TIMEOUT_MS = 30_000L

        @Volatile
        var instance: RpaAccessibilityService? = null
            private set

        /** 平台 key → 包名（与前端 mobile-bridge / JsBridge 保持一致） */
        val PLATFORM_PACKAGES = mapOf(
            "douyin" to "com.ss.android.ugc.aweme",
            "xiaohongshu" to "com.xingin.xhs",
            "shipinhao" to "com.tencent.mm",
            "gongzhonghao" to "com.tencent.mm",
            "kuaishou" to "com.smile.gifmaker",
            "bilibili" to "tv.danmaku.bili",
            "weibo" to "com.sina.weibo",
            "zhihu" to "com.zhihu.android",
            "toutiao" to "com.ss.android.article.news",
        )

        @Volatile
        private var pendingCallback: ((RpaResult) -> Unit)? = null
        @Volatile
        private var pendingPackage: String? = null
        @Volatile
        private var pendingContent: String? = null
        @Volatile
        private var pendingPlatform: String? = null

        private val handler = Handler(Looper.getMainLooper())

        private const val EXEC_BASE_URL = "https://aicontent.vip.kaypal.cn"
        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .build()

        /** 读取持久化的设备 token（P0-4，与 AgentService 同 prefs） */
        private fun deviceToken(): String? {
            val svc = instance ?: return null
            val prefs = svc.getSharedPreferences("jz_agent", android.content.Context.MODE_PRIVATE)
            return prefs.getString("device_token", null)
        }

        /** 执行前消费审批（P0-3）：设备 token 认证调 consume，校验审批一次性 */
        private fun consumeApproval(approvalId: String): Boolean {
            val token = deviceToken() ?: return false
            return try {
                val body = "{\"currentHash\":null}".toRequestBody("application/json; charset=utf-8".toMediaType())
                val req = Request.Builder()
                    .url("$EXEC_BASE_URL/api/mobile-executor/approvals/$approvalId/consume")
                    .header("x-device-token", token)
                    .post(body)
                    .build()
                httpClient.newCall(req).execute().use { it.isSuccessful }
            } catch (e: Exception) {
                Log.w(TAG, "consumeApproval failed: ${e.message}")
                false
            }
        }

        fun isEnabled(): Boolean = instance != null

        /** 当前前台 App 包名（供设备能力上报 P1-14；无障碍未开启返回 null） */
        fun foregroundPackage(): String? =
            instance?.rootInActiveWindow?.packageName?.toString()

        /**
         * 执行 RPA 动作（AgentService 调用）。
         * @param platform 平台 key（douyin/xiaohongshu/shipinhao...）
         * @param content  回复内容
         */
        fun execute(
            platform: String,
            content: String,
            taskId: String,
            callback: (RpaResult) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                callback(RpaResult.failure("无障碍服务未开启（请在系统设置中开启 JIUZHANG AI 的无障碍权限）"))
                return
            }
            val pkg = PLATFORM_PACKAGES[platform]
            if (pkg == null) {
                callback(RpaResult.failure("不支持的平台：$platform"))
                return
            }
            if (content.isBlank()) {
                callback(RpaResult.failure("回复内容为空"))
                return
            }
            pendingPlatform = platform
            pendingPackage = pkg
            pendingContent = content
            pendingCallback = callback
            // P1-12：publish 路径也建 Run（发布任务可追溯 + 断点）
            pubTaskId = taskId.ifBlank { null }
            pubRunId = null
            pubFinishStatus = null
            if (pubTaskId != null) {
                startRunRemote(pubTaskId!!) { rid ->
                    pubRunId = rid
                    // 快速失败时 finish 先于 runId 就绪，这里补 finish（防 Run 泄漏）
                    if (rid != null) {
                        pubFinishStatus?.let {
                            finishRunRemote(rid, it)
                            pubFinishStatus = null
                            pubRunId = null
                        }
                    }
                }
            }
            handler.post { svc.launchApp(pkg) }
            handler.postDelayed({ timeoutIfPending() }, EXEC_TIMEOUT_MS)
        }

        private fun timeoutIfPending() {
            val cb = pendingCallback ?: return
            pendingCallback = null
            cb(RpaResult.failure("RPA 执行超时（30s）"))
        }


        @Volatile
        private var acqCallback: ((RpaResult) -> Unit)? = null
        @Volatile
        private var acqActions: List<AcqAction>? = null
        @Volatile
        private var acqIndex = 0

        /**
         * 执行获客语义动作序列（P0-1 阶段 A 骨架）。
         * search/send_dm 复用现有无障碍输入能力；read_results/identify_lead 等
         * 需真机定位小红书 UI，阶段 A 记录 TODO 后跳过（不中断）。
         */
        fun executeAcquisition(platform: String, actionsJson: String, callback: (RpaResult) -> Unit) {
            val svc = instance ?: run {
                callback(RpaResult.failure("无障碍服务未开启"))
                return
            }
            val pkg = PLATFORM_PACKAGES[platform] ?: run {
                callback(RpaResult.failure("不支持的平台：$platform"))
                return
            }
            val actions = try {
                parseAcquisitionActions(actionsJson)
            } catch (e: Exception) {
                callback(RpaResult.failure("获客动作解析失败：${e.message}"))
                return
            }
            if (actions.isEmpty()) {
                callback(RpaResult.failure("获客动作序列为空"))
                return
            }
            acqCallback = callback
            acqActions = actions
            acqIndex = 0
            handler.post { svc.launchAppForAcquisition(pkg) }
        }

        private fun parseAcquisitionActions(json: String): List<AcqAction> {
            val arr = JSONArray(json)
            val out = ArrayList<AcqAction>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                out.add(
                    AcqAction(
                        type = o.optString("type", ""),
                        keyword = o.optString("keyword", ""),
                        content = o.optString("content", ""),
                    ),
                )
            }
            return out
        }

        private fun finishAcquisition(result: RpaResult) {
            val cb = acqCallback ?: return
            acqCallback = null
            acqActions = null
            cb(result)
        }

        private const val MAI_UI_TIMEOUT_MS = 90_000L

        @Volatile
        private var maiActions: List<MaiUiAction>? = null
        @Volatile
        private var maiIndex = 0
        @Volatile
        private var maiCallback: ((RpaResult) -> Unit)? = null
        @Volatile
        private var maiPausedForAsk = false
        @Volatile
        private var maiPaused = false
        @Volatile
        private var maiTaskId: String? = null
        @Volatile
        private var maiRunId: String? = null
        @Volatile
        private var pubTaskId: String? = null
        @Volatile
        private var pubRunId: String? = null
        @Volatile
        private var pubFinishStatus: String? = null
        @Volatile
        private var maiFinishStatus: String? = null

        /**
         * 执行 MAI-UI 规划的结构化动作序列（H5 调 window.JiuZhang.executeActions）。
         * 动作：click/input/swipe/wait/back/home/ask_user/done。
         * ask_user 不自动执行，暂停并回调（由 H5 弹人工确认）。
         */
        fun executeActions(actionsJson: String, taskId: String, callback: (RpaResult) -> Unit) {
            val svc = instance
            if (svc == null) {
                callback(RpaResult.failure("无障碍服务未开启（请在系统设置中开启 JIUZHANG AI 的无障碍权限）"))
                return
            }
            val actions = try {
                parseActions(actionsJson)
            } catch (e: Exception) {
                callback(RpaResult.failure("动作序列解析失败：${e.message}"))
                return
            }
            if (actions.isEmpty()) {
                callback(RpaResult.failure("动作序列为空"))
                return
            }
            if (maiCallback != null) {
                callback(RpaResult.failure("已有动作序列正在执行，请稍后再试"))
                return
            }
            maiActions = actions
            maiIndex = 0
            maiCallback = callback
            maiPausedForAsk = false
            maiPaused = false
            // P1-12：绑定任务 → 创建 Run（异步），执行中逐步上报 + 本地 checkpoint
            maiTaskId = taskId.ifBlank { null }
            maiRunId = null
            maiFinishStatus = null
            if (maiTaskId != null) {
                startRunRemote(maiTaskId!!) { rid ->
                    maiRunId = rid
                    // 快速失败时 finish 先于 runId 就绪，这里补 finish（防 Run 泄漏）
                    if (rid != null) {
                        maiFinishStatus?.let {
                            finishRunRemote(rid, it)
                            maiFinishStatus = null
                            maiRunId = null
                        }
                    }
                }
            }
            handler.post { svc.stepMaiActions() }
            handler.postDelayed({ timeoutMaiIfPending() }, MAI_UI_TIMEOUT_MS)
        }

        fun cancelActions() {
            val cb = maiCallback ?: return
            maiCallback = null
            maiActions = null
            maiPaused = false
            cb(RpaResult.failure("动作执行已取消"))
        }

        /** 暂停执行（M2：等待中不推进，resumeActions 继续） */
        fun pauseActions(): RpaResult {
            if (maiCallback == null) return RpaResult.failure("当前无执行中的动作")
            if (maiPausedForAsk) return RpaResult.failure("当前等待人工确认中，无需暂停")
            maiPaused = true
            return RpaResult.success("已暂停（剩余 ${(maiActions?.size ?: 0) - maiIndex} 步）")
        }

        /** 继续执行 */
        fun resumeActions(): RpaResult {
            val svc = instance
            if (svc == null) return RpaResult.failure("无障碍服务未开启")
            if (maiCallback == null) return RpaResult.failure("当前无执行中的动作")
            if (!maiPaused) return RpaResult.failure("当前未处于暂停状态")
            maiPaused = false
            handler.post { svc.stepMaiActions() }
            return RpaResult.success("已继续执行")
        }

        /** H5 对 ask_user 的答复：true=继续，false=中止；approvalId 非空时执行器校验审批（P0-3） */
        fun resumeAfterAsk(proceed: Boolean, approvalId: String, callback: (RpaResult) -> Unit) {
            val svc = instance ?: run {
                callback(RpaResult.failure("无障碍服务未开启"))
                return
            }
            val cb = maiCallback ?: run {
                callback(RpaResult.failure("当前无等待中的确认"))
                return
            }
            if (!maiPausedForAsk) {
                callback(RpaResult.failure("当前无等待中的确认"))
                return
            }
            maiPausedForAsk = false
            if (!proceed) {
                finishMai(cb, RpaResult.failure("用户中止了动作序列"))
                return
            }
            // P0-3：审批通过后，执行器校验审批已消费（设备 token 调 consume），防绕过前端审批
            if (approvalId.isNotEmpty()) {
                Thread {
                    val ok = consumeApproval(approvalId)
                    if (ok) {
                        // P1-11：审批通过 → Run 恢复 running
                        maiRunId?.let { setRunStatusRemote(it, "running") }
                        handler.post { svc.stepMaiActions() }
                        callback(RpaResult.success("审批校验通过，已继续执行"))
                    } else {
                        handler.post { finishMai(cb, RpaResult.failure("审批校验失败：审批无效或已消费，已中止")) }
                        callback(RpaResult.failure("审批校验失败：审批无效或已消费"))
                    }
                }.start()
                return
            }
            // P1-11：无审批直接继续 → Run 恢复 running
            maiRunId?.let { setRunStatusRemote(it, "running") }
            handler.post { svc.stepMaiActions() }
            callback(RpaResult.success("已继续执行"))
        }

        private fun parseActions(json: String): List<MaiUiAction> {
            val arr = JSONArray(json)
            val out = mutableListOf<MaiUiAction>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val action = o.optString("action", "")
                if (action.isBlank()) continue
                val bounds = mutableListOf<Int>()
                val bArr = o.optJSONArray("bounds")
                if (bArr != null) {
                    for (j in 0 until bArr.length()) bounds.add(bArr.optInt(j))
                }
                out.add(
                    MaiUiAction(
                        action = action,
                        target = o.optString("target").ifBlank { null },
                        bounds = bounds.takeIf { it.size == 4 },
                        text = o.optString("text").ifBlank { null },
                        direction = o.optString("direction").ifBlank { null },
                        distance = o.optInt("distance", 0).takeIf { it > 0 },
                        ms = o.optInt("ms", 0).takeIf { it > 0 },
                        question = o.optString("question").ifBlank { null },
                        summary = o.optString("summary").ifBlank { null },
                    ),
                )
            }
            return out
        }

        private fun timeoutMaiIfPending() {
            val cb = maiCallback ?: return
            if (maiPausedForAsk) return // ask_user 等待中不算超时
            finishMai(cb, RpaResult.failure("动作执行超时（90s）"))
        }

        /** 截取当前屏幕（无障碍 takeScreenshot，需 Android 11+ / API 30+）。回调返回 base64 PNG。 */
        fun captureScreen(callback: (RpaResult) -> Unit) {
            val svc = instance
            if (svc == null) {
                callback(RpaResult.failure("无障碍服务未开启（请在系统设置中开启 JIUZHANG AI 的无障碍权限）"))
                return
            }
            if (Build.VERSION.SDK_INT < 30) {
                callback(RpaResult.failure("当前系统不支持系统截图（需 Android 11+），请升级系统"))
                return
            }
            try {
                val callbackExecutor = java.util.concurrent.Executor { r -> r.run() }
                svc.takeScreenshot(
                    android.view.Display.DEFAULT_DISPLAY,
                    callbackExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                            try {
                                val hb = screenshot.hardwareBuffer
                                val wrapped = Bitmap.wrapHardwareBuffer(hb, screenshot.colorSpace)
                                if (wrapped == null) {
                                    hb.close()
                                    callback(RpaResult.failure("截图位图转换失败"))
                                    return
                                }
                                val bmp = wrapped.copy(Bitmap.Config.ARGB_8888, false)
                                wrapped.recycle()
                                hb.close()
                                val out = ByteArrayOutputStream()
                                val scaled = scaleForShare(bmp)
                                scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
                                if (!scaled.isRecycled && scaled !== bmp) scaled.recycle()
                                bmp.recycle()
                                val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                                val dm = svc.resources.displayMetrics
                                callback(
                                    RpaResult.success(
                                        "data:image/jpeg;base64,$b64" +
                                            "|w=${scaled.width}&h=${scaled.height}" +
                                            "&sw=${dm.widthPixels}&sh=${dm.heightPixels}",
                                    ),
                                )
                            } catch (e: Exception) {
                                callback(RpaResult.failure("截图编码失败：${e.message}"))
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            callback(RpaResult.failure("系统截图失败（code=$errorCode）"))
                        }
                    },
                )
            } catch (e: Exception) {
                callback(RpaResult.failure("截图调用失败：${e.message}"))
            }
        }

        /** 大图等比缩到宽 ≤540 再编码（控制 base64 体积 + qwen-vl-max 视觉输入稳定性） */
        private fun scaleForShare(bmp: Bitmap): Bitmap {
            val maxW = 540
            val w = bmp.width
            val h = bmp.height
            if (w <= maxW) return bmp
            val nh = (h.toLong() * maxW / w).toInt()
            return Bitmap.createScaledBitmap(bmp, maxW, nh, true)
        }

        private fun finishMai(cb: (RpaResult) -> Unit, result: RpaResult) {
            // P1-12：收尾 Run（completed/failed/unknown）；runId 未就绪时缓存 status 待补
            val maiStatus =
                if (result.ok) "completed"
                else if (result.status == "unknown") "unknown" else "failed"
            val maiRid = maiRunId
            maiRunId = null
            if (maiRid != null) {
                finishRunRemote(maiRid, maiStatus)
            } else {
                maiFinishStatus = maiStatus
            }
            clearCheckpoint()
            maiCallback = null
            maiActions = null
            maiPausedForAsk = false
            maiPaused = false
            maiTaskId = null
            maiRunId = null
            cb(result)
        }

        // ===== P1-12 Run/Step 持久化（后端上报 + 本地 checkpoint） =====

        /** 异步创建 Run（领取执行会话），runId 经 assign 回调回填 */
        private fun startRunRemote(taskId: String, assign: (String?) -> Unit) {
            val token = deviceToken() ?: return
            Thread {
                try {
                    val body = "{}".toRequestBody("application/json; charset=utf-8".toMediaType())
                    val req = Request.Builder()
                        .url("$EXEC_BASE_URL/api/mobile-executor/tasks/$taskId/run")
                        .header("x-device-token", token)
                        .post(body)
                        .build()
                    httpClient.newCall(req).execute().use { resp ->
                        if (resp.isSuccessful) {
                            val json = JSONObject(resp.body?.string() ?: "{}")
                            val data = json.optJSONObject("data") ?: json
                            val rid = data.optString("id").ifBlank { null }
                            assign(rid)
                            persistCheckpoint(taskId, rid, 0)
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "startRunRemote failed: ${e.message}")
                }
            }.start()
        }

        /** 异步上报单步进度（fire-and-forget，不阻塞执行） */
        private fun reportStepRemote(runId: String, stepIndex: Int, type: String, status: String) {
            val token = deviceToken() ?: return
            Thread {
                try {
                    val body = JSONObject()
                        .put("stepIndex", stepIndex)
                        .put("type", type)
                        .put("status", status)
                        .put("checkpoint", "$stepIndex:$type")
                        .toString()
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val req = Request.Builder()
                        .url("$EXEC_BASE_URL/api/mobile-executor/runs/$runId/step")
                        .header("x-device-token", token)
                        .post(body)
                        .build()
                    httpClient.newCall(req).execute().use { }
                } catch (e: Exception) {
                    Log.w(TAG, "reportStepRemote failed: ${e.message}")
                }
            }.start()
        }

        /** 异步收尾 Run */
        private fun finishRunRemote(runId: String, status: String) {
            val token = deviceToken() ?: return
            Thread {
                try {
                    val body = JSONObject().put("status", status).toString()
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val req = Request.Builder()
                        .url("$EXEC_BASE_URL/api/mobile-executor/runs/$runId/finish")
                        .header("x-device-token", token)
                        .post(body)
                        .build()
                    httpClient.newCall(req).execute().use { }
                } catch (e: Exception) {
                    Log.w(TAG, "finishRunRemote failed: ${e.message}")
                }
            }.start()
        }

        /** 异步更新 Run 状态（P1-11：ask_user→awaiting_approval，恢复→running） */
        private fun setRunStatusRemote(runId: String, status: String) {
            val token = deviceToken() ?: return
            Thread {
                try {
                    val body = JSONObject().put("status", status).toString()
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val req = Request.Builder()
                        .url("$EXEC_BASE_URL/api/mobile-executor/runs/$runId/status")
                        .header("x-device-token", token)
                        .post(body)
                        .build()
                    httpClient.newCall(req).execute().use { }
                } catch (e: Exception) {
                    Log.w(TAG, "setRunStatusRemote failed: ${e.message}")
                }
            }.start()
        }

        /** 本地 checkpoint 持久化（断点恢复：App 被杀后能读回执行到哪一步） */
        private fun persistCheckpoint(taskId: String?, runId: String?, stepIndex: Int) {
            val svc = instance ?: return
            val prefs = svc.getSharedPreferences("jz_agent", android.content.Context.MODE_PRIVATE)
            prefs.edit()
                .putString("checkpoint_task_id", taskId)
                .putString("checkpoint_run_id", runId)
                .putInt("checkpoint_step_index", stepIndex)
                .apply()
        }

        private fun clearCheckpoint() {
            val svc = instance ?: return
            val prefs = svc.getSharedPreferences("jz_agent", android.content.Context.MODE_PRIVATE)
            prefs.edit()
                .remove("checkpoint_task_id")
                .remove("checkpoint_run_id")
                .remove("checkpoint_step_index")
                .apply()
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "accessibility service connected")
    }

    override fun onDestroy() {
        instance = null
        pendingCallback = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val cb = pendingCallback ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            attemptIfReady(cb)
        }
    }

    override fun onInterrupt() {}

    /** 获客：启动平台 App（阶段 A，自管理窗口等待，不复用 publish 的 finishWith） */
    private fun launchAppForAcquisition(pkg: String) {
        try {
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent == null) {
                finishAcquisition(RpaResult.failure("未安装该应用：$pkg（请在手机安装对应平台 App）"))
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            handler.postDelayed({ stepAcquisition() }, 2500L)
        } catch (e: Exception) {
            finishAcquisition(RpaResult.failure("调起失败：${e.message}"))
        }
    }

    /** 获客语义动作串行执行（阶段 A 骨架） */
    private fun stepAcquisition() {
        val actions = acqActions ?: return
        if (acqIndex >= actions.size) {
            finishAcquisition(RpaResult.success("获客动作序列完成（${actions.size} 步，阶段A骨架）"))
            return
        }
        val act = actions[acqIndex]
        val root = rootInActiveWindow
        when (act.type) {
            "search" -> {
                val input = root?.let { findInput(it) }
                if (input == null) {
                    finishAcquisition(RpaResult.failure("search：未找到输入框（需真机定位平台搜索入口）"))
                    return
                }
                val args = Bundle()
                args.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    act.keyword,
                )
                input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                Log.i(TAG, "acq search: 已输入关键词 ${act.keyword}")
            }
            "send_dm" -> {
                val input = root?.let { findInput(it) }
                if (input == null) {
                    finishAcquisition(RpaResult.failure("send_dm：未找到输入框（需真机定位私信输入框）"))
                    return
                }
                val args = Bundle()
                args.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    act.content,
                )
                input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                val send = root?.let { findButton(it, "发送") ?: findButton(it, "Send") }
                send?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                Log.i(TAG, "acq send_dm: 已尝试发送")
            }
            else -> {
                // 阶段 A 骨架：read_results/identify_lead/open_profile/generate_draft/save_lead
                // 需真机定位小红书 UI，先记录并跳过（不中断整个序列）
                Log.w(TAG, "acq 阶段A骨架：动作 ${act.type} 待真机实现（跳过）")
            }
        }
        acqIndex++
        handler.postDelayed({ stepAcquisition() }, 1200L)
    }

    private fun launchApp(pkg: String) {
        try {
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent == null) {
                finishWith(RpaResult.failure("未安装该应用：$pkg（请在手机安装对应平台 App）"))
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            pubRunId?.let { reportStepRemote(it, 0, "launch", "done") }
            // 窗口就绪由 onAccessibilityEvent 驱动；加轮询兜底（事件可能没触发）
            handler.postDelayed({ pollIfPending() }, 1500L)
        } catch (e: Exception) {
            finishWith(RpaResult.failure("调起失败：${e.message}"))
        }
    }

    private fun pollIfPending() {
        val cb = pendingCallback ?: return
        attemptIfReady(cb)
    }

    private fun attemptIfReady(cb: (RpaResult) -> Unit) {
        val root = rootInActiveWindow ?: return
        val pkg = pendingPackage ?: return
        val currentPkg = root.packageName?.toString() ?: ""
        // 目标 App 尚未到前台：稍后再试
        if (currentPkg != pkg) {
            handler.postDelayed({ if (pendingCallback != null) attemptIfReady(cb) }, 800L)
            return
        }
        val content = pendingContent ?: return
        // 输入 + 点击发送；点击成功后异步回读确认（P0-7 防重复外发）
        val clicked = performDmReplyClick(root, content)
        if (clicked) {
            handler.postDelayed({
                if (pendingCallback == null) return@postDelayed
                val r2 = rootInActiveWindow
                val result = if (r2 != null && inputCleared(r2, content)) {
                    RpaResult.success("已回复并确认发送成功")
                } else {
                    RpaResult.unknown("已点击发送，但无法确认是否成功（请人工核对，避免重复发送）")
                }
                pubRunId?.let { reportStepRemote(it, 3, "verify", result.status) }
                finishWith(result)
            }, 1500L)
        }
    }

    /** 发送后回读：输入框文本已清空（或不再等于待发内容）视为发送成功 */
    private fun inputCleared(root: AccessibilityNodeInfo, content: String): Boolean {
        val input = findInput(root) ?: return true // 输入框消失（可能发送后收起）视为成功
        val text = input.text?.toString()?.trim() ?: ""
        return text.isEmpty() || text != content
    }

    /** 回复私信：找输入框 → 输入 → 找发送按钮 → 点击；失败直接 finishWith，成功返回 true 交回读确认 */
    private fun performDmReplyClick(root: AccessibilityNodeInfo, content: String): Boolean {
        val input = findInput(root)
        if (input == null) {
            finishWith(RpaResult.failure("已打开目标 App，但未找到输入框（可能不在会话页，请先进入会话）"))
            return false
        }
        val args = Bundle()
        args.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            content,
        )
        val setOk = input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        if (!setOk) {
            finishWith(RpaResult.failure("输入回复内容失败"))
            return false
        }
        pubRunId?.let { reportStepRemote(it, 1, "input", "done") }
        // 找发送按钮（中文优先，英文兜底）
        val send = findButton(root, "发送") ?: findButton(root, "Send")
        if (send == null) {
            // P0-6：未找到发送按钮 = 失败，不得报成功（假成功率=0）
            finishWith(RpaResult.failure("已输入回复内容，但未找到发送按钮，未发送"))
            return false
        }
        val clickOk = send.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (!clickOk) {
            // P0-6：点击失败 = 失败，不得报成功（否则错误释放租约）
            finishWith(RpaResult.failure("已输入回复内容，但发送按钮点击失败，未发送"))
            return false
        }
        pubRunId?.let { reportStepRemote(it, 2, "send", "done") }
        return true
    }

    private fun findInput(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var depth = 0
        while (stack.isNotEmpty() && depth < 400) {
            depth++
            val node = stack.removeLast()
            if (node.className?.toString()?.contains("EditText") == true) {
                return node
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun findButton(
        root: AccessibilityNodeInfo,
        text: String,
    ): AccessibilityNodeInfo? {
        val byText = root.findAccessibilityNodeInfosByText(text)
        for (n in byText) {
            if (n.isClickable) return n
        }
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var depth = 0
        while (stack.isNotEmpty() && depth < 400) {
            depth++
            val node = stack.removeLast()
            if (node.isClickable &&
                (node.text?.toString()?.contains(text) == true ||
                    node.contentDescription?.toString()?.contains(text) == true)
            ) {
                return node
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun finishWith(result: RpaResult) {
        val cb = pendingCallback ?: return
        pendingCallback = null
        pendingPackage = null
        pendingContent = null
        pendingPlatform = null
        // P1-12：publish 收尾 Run（completed/failed/unknown）；runId 未就绪时缓存 status 待补
        val pubStatus =
            if (result.ok) "completed"
            else if (result.status == "unknown") "unknown" else "failed"
        val pubRid = pubRunId
        pubTaskId = null
        pubRunId = null
        if (pubRid != null) {
            finishRunRemote(pubRid, pubStatus)
        } else {
            pubFinishStatus = pubStatus
        }
        cb(result)
    }

    private fun stepMaiActions() {
        // M2 暂停：不推进，轮询等待 resume
        if (maiPaused) {
            handler.postDelayed({ stepMaiActions() }, 300L)
            return
        }
        val actions = maiActions ?: return
        val cb = maiCallback ?: return
        if (maiIndex >= actions.size) {
            finishMai(cb, RpaResult.success("动作序列执行完成（${actions.size} 步）"))
            return
        }
        val act = actions[maiIndex]
        // P1（复查 2026-08-22）：wait 不阻塞无障碍服务主线程——原实现
        // Thread.sleep 最长 10s 会卡死事件处理与后续动作。改为 postDelayed
        // 异步延时后继续下一步，期间主线程仍可响应暂停/超时/新无障碍事件。
        if (act.action == "wait") {
            val ms = (act.ms?.toLong() ?: 1000L).coerceIn(0L, 10000L)
            maiRunId?.let { reportStepRemote(it, maiIndex, "wait", "done") }
            maiIndex++
            persistCheckpoint(maiTaskId, maiRunId, maiIndex)
            handler.postDelayed({ stepMaiActions() }, ms)
            return
        }
        val result = performOneAction(act)
        when {
            result.ok && act.action != "done" -> {
                maiRunId?.let { reportStepRemote(it, maiIndex, act.action, "done") }
                maiIndex++
                persistCheckpoint(maiTaskId, maiRunId, maiIndex)
                handler.postDelayed({ stepMaiActions() }, 250L)
            }
            act.action == "ask_user" -> {
                maiRunId?.let { reportStepRemote(it, maiIndex, "ask_user", "pending") }
                persistCheckpoint(maiTaskId, maiRunId, maiIndex)
                // P1-11：服务端标记 Run 为 awaiting_approval（审批状态持久化）
                maiRunId?.let { setRunStatusRemote(it, "awaiting_approval") }
                maiPausedForAsk = true
                // 暂停，等 H5 resumeAfterAsk
                cb(
                    RpaResult.failure(
                        "ASK_USER:${act.question ?: "需要人工确认"}|step=${maiIndex + 1}",
                    ),
                )
            }
            act.action == "done" -> {
                maiRunId?.let { reportStepRemote(it, maiIndex, "done", "done") }
                finishMai(cb, RpaResult.success("任务完成：${act.summary ?: "done"}"))
            }
            else -> {
                // 失败但非 done/ask_user：带步号返回错误
                maiRunId?.let { reportStepRemote(it, maiIndex, act.action, "failed") }
                finishMai(cb, RpaResult.failure("第 ${maiIndex + 1} 步（${act.action}）执行失败：${result.message}"))
            }
        }
    }

    /** 执行单个动作，返回是否成功。 */
    private fun performOneAction(act: MaiUiAction): RpaResult {
        return when (act.action) {
            "click" -> performClick(act)
            "input" -> performInput(act)
            "swipe" -> performSwipe(act)
            "wait" -> {
                // P1（复查 2026-08-22）：wait 已由 stepMaiActions 异步处理
                // （postDelayed），这里不再阻塞主线程；防御性直接成功返回。
                RpaResult.success("wait（异步）")
            }
            "back" -> {
                if (performGlobalAction(GLOBAL_ACTION_BACK)) RpaResult.success("back")
                else RpaResult.failure("back 执行失败")
            }
            "home" -> {
                if (performGlobalAction(GLOBAL_ACTION_HOME)) RpaResult.success("home")
                else RpaResult.failure("home 执行失败")
            }
            "ask_user" -> RpaResult.success("ask_user（暂停待确认）")
            "done" -> RpaResult.success("done")
            else -> RpaResult.failure("未知动作类型：${act.action}")
        }
    }

    private fun performClick(act: MaiUiAction): RpaResult {
        // 优先 bounds 中心 dispatchGesture；无 bounds 用 target 文本找可点击节点
        val bounds = act.bounds
        if (bounds != null && bounds.size == 4) {
            val cx = (bounds[0] + bounds[2]) / 2f
            val cy = (bounds[1] + bounds[3]) / 2f
            val dm = resources.displayMetrics
            if (cx < 0 || cy < 0 || cx > dm.widthPixels || cy > dm.heightPixels) {
                return RpaResult.failure("bounds 超出屏幕范围（${bounds.joinToString()}）")
            }
            return gestureTap(cx, cy)
        }
        val root = rootInActiveWindow ?: return RpaResult.failure("无活跃窗口")
        val target = act.target ?: return RpaResult.failure("click 缺 target 与 bounds")
        val node = findClickableByText(root, target)
        if (node == null) return RpaResult.failure("未找到可点击元素：$target")
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)
        if (rect.isEmpty) return RpaResult.failure("元素无有效区域：$target")
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return if (ok) RpaResult.success("click($target)")
        else RpaResult.failure("点击元素失败：$target")
    }

    private fun performInput(act: MaiUiAction): RpaResult {
        val root = rootInActiveWindow ?: return RpaResult.failure("无活跃窗口")
        val text = act.text ?: return RpaResult.failure("input 缺 text")
        val input = findInput(root)
        if (input == null) return RpaResult.failure("未找到输入框")
        // 先点击输入框获得焦点
        input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val args = Bundle()
        args.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            text,
        )
        val ok = input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        return if (ok) RpaResult.success("input($text)")
        else RpaResult.failure("输入失败")
    }

    private fun performSwipe(act: MaiUiAction): RpaResult {
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat()
        val h = dm.heightPixels.toFloat()
        val distance = (act.distance ?: 300).toFloat().coerceIn(50f, maxOf(w, h))
        val dir = act.direction ?: "up"
        val (x1, y1, x2, y2) = when (dir) {
            "up" -> arrayOf(w / 2, h * 0.8f, w / 2, (h * 0.8f) - distance)
            "down" -> arrayOf(w / 2, h * 0.2f, w / 2, (h * 0.2f) + distance)
            "left" -> arrayOf(w * 0.8f, h / 2, (w * 0.8f) - distance, h / 2)
            "right" -> arrayOf(w * 0.2f, h / 2, (w * 0.2f) + distance, h / 2)
            else -> return RpaResult.failure("未知滑动方向：$dir")
        }
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
            .build()
        val ok = dispatchGesture(gesture, null, null)
        return if (ok) RpaResult.success("swipe($dir)")
        else RpaResult.failure("swipe 执行失败")
    }

    private fun gestureTap(x: Float, y: Float): RpaResult {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        val ok = dispatchGesture(gesture, null, null)
        return if (ok) RpaResult.success("tap($x,$y)")
        else RpaResult.failure("tap 执行失败")
    }

    private fun findClickableByText(
        root: AccessibilityNodeInfo,
        text: String,
    ): AccessibilityNodeInfo? {
        val byText = root.findAccessibilityNodeInfosByText(text)
        for (n in byText) {
            if (n.isClickable) return n
        }
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var depth = 0
        while (stack.isNotEmpty() && depth < 400) {
            depth++
            val node = stack.removeLast()
            if (node.isClickable &&
                (node.text?.toString()?.contains(text) == true ||
                    node.contentDescription?.toString()?.contains(text) == true)
            ) {
                return node
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { stack.add(it) }
            }
        }
        return null
    }
}

/** MAI-UI 结构化动作（与前端 /api/mai-ui/actions 返回对齐） */
data class MaiUiAction(
    val action: String,
    val target: String? = null,
    val bounds: List<Int>? = null,
    val text: String? = null,
    val direction: String? = null,
    val distance: Int? = null,
    val ms: Int? = null,
    val question: String? = null,
    val summary: String? = null,
)
