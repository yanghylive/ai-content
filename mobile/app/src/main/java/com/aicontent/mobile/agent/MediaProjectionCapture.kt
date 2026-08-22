package com.aicontent.mobile.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * MediaProjection 截图（兼容 Android 8-10，无障碍 takeScreenshot 需 API 30+）。
 * 授权流程：H5 调 JsBridge.requestScreenCapture → MainActivity 起系统授权弹窗 →
 * onActivityResult 保存投影 → 之后 captureScreen 优先用 MediaProjection 抓帧。
 * Android 14+（targetSdk 35）createVirtualDisplay 若无前台服务可能受限，异常时由
 * JsBridge fallback 回无障碍 takeScreenshot。
 */
object MediaProjectionCapture {
    private const val TAG = "JZMediaProjection"

    private var projection: MediaProjection? = null
    private var projectionResult: Pair<Int, Intent>? = null
    private var pendingCallback: ((RpaResult) -> Unit)? = null

    /** 是否有可用授权 */
    fun hasPermission(): Boolean = projection != null || projectionResult != null

    /** Activity 处理授权结果（MainActivity.onActivityResult 调用） */
    fun onActivityResult(
        context: Context,
        resultCode: Int,
        data: Intent?,
    ) {
        if (resultCode != Activity.RESULT_OK || data == null) {
            pendingCallback?.invoke(RpaResult.failure("用户未授权屏幕录制，无法截屏"))
            pendingCallback = null
            return
        }
        projectionResult = resultCode to data
        projection = getProjectionManager(context)
            ?.getMediaProjection(resultCode, data)
        Log.i(TAG, "MediaProjection 授权成功")
        pendingCallback?.invoke(RpaResult.success("已授权屏幕录制，可以截屏了"))
        pendingCallback = null
    }

    /** 发起授权（MainActivity 调） */
    fun requestAuth(activity: Activity) {
        val mpm = getProjectionManager(activity) ?: return
        val intent = mpm.createScreenCaptureIntent()
        activity.startActivityForResult(intent, REQ_CODE)
    }

    /** 带回调的授权（JsBridge 用） */
    fun requestAuthWithCallback(activity: Activity, callback: (RpaResult) -> Unit) {
        pendingCallback = callback
        requestAuth(activity)
    }

    /**
     * MediaProjection 抓一帧。
     * @param width  目标宽度（截图输出宽度，对应 H5 规划坐标系）
     * @param height 目标高度
     */
    fun capture(
        context: Context,
        width: Int = 540,
        height: Int = 1200,
        callback: (RpaResult) -> Unit,
    ) {
        val proj = projection
        if (proj == null) {
            val result = projectionResult
            if (result == null) {
                callback(RpaResult.failure("未授权屏幕录制"))
                return
            }
            projection = getProjectionManager(context)
                ?.getMediaProjection(result.first, result.second)
            if (projection == null) {
                callback(RpaResult.failure("屏幕录制授权失效，请重新授权"))
                return
            }
        }
        val dm: DisplayMetrics = context.resources.displayMetrics
        val screenWidth = dm.widthPixels
        val screenHeight = dm.heightPixels

        val imageReader = ImageReader.newInstance(
            screenWidth,
            screenHeight,
            PixelFormat.RGBA_8888,
            2,
        )
        val latch = CountDownLatch(1)
        val holder = arrayOfNulls<String>(1)

        val onImage: (Image?) -> Unit = { image ->
            try {
                if (image == null) {
                    holder[0] = "NO_IMAGE"
                } else {
                    val bitmap = imageToBitmap(image)
                    image.close()
                    if (bitmap == null) {
                        holder[0] = "NO_BITMAP"
                    } else {
                        val scaled = scaleForShare(bitmap, width, height)
                        val out = ByteArrayOutputStream()
                        scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
                        if (!scaled.isRecycled && scaled !== bitmap) scaled.recycle()
                        bitmap.recycle()
                        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                        val w = scaled.width
                        val h = scaled.height
                        holder[0] =
                            "data:image/jpeg;base64,$b64|w=$w&h=$h&sw=$screenWidth&sh=$screenHeight"
                    }
                }
            } catch (e: Exception) {
                holder[0] = "ERR:${e.message}"
            } finally {
                latch.countDown()
            }
        }

        imageReader.setOnImageAvailableListener({ reader -> onImage(reader.acquireLatestImage()) }, null)

        // 重新读取当前投影实例（可能刚在此前赋值）
        val activeProj = projection ?: run {
            callback(RpaResult.failure("屏幕录制授权不可用"))
            return
        }
        var vd: VirtualDisplay? = null
        try {
            // API 34+ createVirtualDisplay 在 MediaProjection 实例上
            vd = activeProj.createVirtualDisplay(
                "JIUZHANG-Capture",
                screenWidth,
                screenHeight,
                dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.surface,
                null,
                null,
            )
            // 等待一帧
            if (!latch.await(3, TimeUnit.SECONDS)) {
                callback(RpaResult.failure("截屏超时"))
                vd?.release()
                imageReader.close()
                return
            }
        } catch (e: Exception) {
            vd?.release()
            imageReader.close()
            callback(RpaResult.failure("屏幕录制受限：${e.message}"))
            return
        }

        vd?.release()
        imageReader.close()

        val result = holder[0] ?: "NO_RESULT"
        if (result.startsWith("ERR:")) {
            callback(RpaResult.failure(result.substring(4)))
        } else if (result == "NO_IMAGE" || result == "NO_BITMAP") {
            callback(RpaResult.failure("截图失败（$result）"))
        } else {
            callback(RpaResult.success(result))
        }
    }

    /** Image → Bitmap（RGBA_8888） */
    private fun imageToBitmap(image: Image): Bitmap? {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val bitmap = Bitmap.createBitmap(
            image.width + rowPadding / pixelStride,
            image.height,
            Bitmap.Config.ARGB_8888,
        )
        bitmap.copyPixelsFromBuffer(buffer)
        return if (rowPadding == 0) {
            bitmap
        } else {
            val cropped = Bitmap.createBitmap(
                bitmap,
                0,
                0,
                image.width,
                image.height,
            )
            bitmap.recycle()
            cropped
        }
    }

    /** 等比缩到目标宽（对应 H5 规划坐标系） */
    private fun scaleForShare(bmp: Bitmap, maxW: Int, maxH: Int): Bitmap {
        val w = bmp.width
        val h = bmp.height
        val scale = maxOf(maxW.toDouble() / w, maxH.toDouble() / h).let { if (it >= 1.0) 1.0 else it }
        val nw = (w * scale).toInt()
        val nh = (h * scale).toInt()
        if (nw >= w) return bmp
        return Bitmap.createScaledBitmap(bmp, nw, nh, true)
    }

    private fun getProjectionManager(context: Context): MediaProjectionManager? =
        context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager

    const val REQ_CODE = 9001
}
