package com.blechat.screenguard

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executor

/**
 * The two things Android will actually do about screenshots.
 *
 * FLAG_SECURE asks the window server to refuse capture of this window: screenshots and
 * screen recordings come out black, and the app's thumbnail in the recents list is
 * blanked too. It is enforced by the OS rather than by us, which is what makes it worth
 * offering — and it has worked on every Android version this app supports.
 *
 * Detection is the newer and much narrower half. Android 14 (API 34) added
 * Activity.ScreenCaptureCallback, which fires after the user takes a screenshot of this
 * activity. There is no equivalent below 34 that does not involve watching the photo
 * library for new files, which needs storage permission and reports screenshots of other
 * apps as readily as ours — so below 34 this module reports that it cannot detect, and
 * the app says so rather than showing a promise it cannot keep.
 *
 * Neither stops a second phone pointed at the screen. Nothing can, and the feature does
 * not claim to: it is about consent between two people talking, not about an adversary.
 */
class ScreenGuardModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * Held so the callback can be unregistered with the same instance it was registered
   * with — Android matches on identity, and a fresh lambda would leave the old one
   * registered and the new one doing nothing.
   */
  private var captureCallback: Any? = null

  @ReactMethod
  fun setSecure(secure: Boolean, promise: Promise) {
    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      // Nothing to protect while there is no window; the screen re-applies on focus.
      promise.resolve(false)
      return
    }
    activity.runOnUiThread {
      try {
        if (secure) {
          activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
          )
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject(ERR, "could not change FLAG_SECURE: ${e.message}", e)
      }
    }
  }

  @ReactMethod
  fun canDetect(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= 34)
  }

  @ReactMethod
  fun setDetecting(detecting: Boolean, promise: Promise) {
    if (Build.VERSION.SDK_INT < 34) {
      // Honest false: the caller uses this to decide whether to tell the user that
      // "notify" is not available on their Android version.
      promise.resolve(false)
      return
    }
    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    activity.runOnUiThread {
      try {
        if (detecting) {
          registerCallback(activity)
        } else {
          unregisterCallback(activity)
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject(ERR, "could not change capture detection: ${e.message}", e)
      }
    }
  }

  /**
   * Reflection rather than a direct reference.
   *
   * Activity.ScreenCaptureCallback only exists in the API 34 SDK. Referencing the type
   * directly would compile against whatever compileSdk happens to be set to and break the
   * build the moment it is lowered; going through reflection keeps this module buildable
   * on any SDK and simply inert below 34, which is exactly its contract.
   */
  private fun registerCallback(activity: Activity) {
    if (captureCallback != null) {
      return
    }
    val callbackClass = Class.forName("android.app.Activity\$ScreenCaptureCallback")
    val proxy = java.lang.reflect.Proxy.newProxyInstance(
      callbackClass.classLoader,
      arrayOf(callbackClass),
    ) { _, method, _ ->
      if (method.name == "onScreenCaptured") {
        emitCaptured()
      }
      null
    }
    val executor = Executor { command -> activity.runOnUiThread(command) }
    val register = Activity::class.java.getMethod(
      "registerScreenCaptureCallback",
      Executor::class.java,
      callbackClass,
    )
    register.invoke(activity, executor, proxy)
    captureCallback = proxy
  }

  private fun unregisterCallback(activity: Activity) {
    val existing = captureCallback ?: return
    captureCallback = null
    try {
      val callbackClass = Class.forName("android.app.Activity\$ScreenCaptureCallback")
      val unregister = Activity::class.java.getMethod(
        "unregisterScreenCaptureCallback",
        callbackClass,
      )
      unregister.invoke(activity, existing)
    } catch (e: Exception) {
      // Already gone with the activity, which is the common case on a rotation.
    }
  }

  private fun emitCaptured() {
    val payload: WritableMap = Arguments.createMap()
    payload.putDouble("at", System.currentTimeMillis().toDouble())
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_CAPTURED, payload)
  }

  /** Required by NativeEventEmitter on iOS and harmless here; keeps the JS side uniform. */
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    reactContext.currentActivity?.let { unregisterCallback(it) }
    super.invalidate()
  }

  companion object {
    const val NAME = "ScreenGuard"
    private const val ERR = "screen_guard_error"
    private const val EVENT_CAPTURED = "screenCaptured"
  }
}
