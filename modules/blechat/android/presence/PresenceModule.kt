package com.blechat.presence

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.blechat.MainActivity
import com.blechat.R
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Two things the app could not do before: stay alive in the background, and tell the user
 * something arrived.
 *
 * Both are written here rather than pulled in as a notification library. The foreground
 * service already needs a channel and a notification to exist at all, so message
 * notifications are a few lines on top of machinery that has to be present anyway — and
 * a dependency would bring its own permission handling to keep in step with this one's.
 *
 * Everything degrades rather than throws. A user who refused the notification permission
 * gets an app that still works and simply cannot alert them, which is the honest outcome;
 * refusing to run would be worse.
 */
class PresenceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "Presence"

  /**
   * Whether the app may post notifications.
   *
   * From Android 13 this is a runtime permission, and without it a foreground service
   * still runs but shows nothing — so the user sees no indication their radio is in use.
   */
  @ReactMethod
  fun hasNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(NotificationManagerCompat.from(reactContext).areNotificationsEnabled())
      return
    }
    val granted =
        ActivityCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    promise.resolve(granted)
  }

  /**
   * Ask for the notification permission.
   *
   * Resolves immediately with the current state rather than waiting for the dialog: the
   * result arrives through the normal permission flow, and the JS side re-checks. Making
   * this promise wait would mean holding it across an activity lifecycle that can be
   * destroyed and recreated under it.
   */
  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(true)
      return
    }
    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    if (ActivityCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
    ) {
      promise.resolve(true)
      return
    }
    ActivityCompat.requestPermissions(
        activity,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        REQUEST_NOTIFICATIONS,
    )
    promise.resolve(false)
  }

  /** Start holding the process in the foreground so BLE keeps running. */
  @ReactMethod
  fun startPresence(title: String, text: String, promise: Promise) {
    try {
      val intent =
          Intent(reactContext, ChatForegroundService::class.java).apply {
            putExtra(ChatForegroundService.EXTRA_TITLE, title)
            putExtra(ChatForegroundService.EXTRA_TEXT, text)
          }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      // Most likely a background-start restriction. Reported rather than swallowed, so
      // the app can say the radio will stop when it is closed instead of implying
      // otherwise.
      promise.reject("presence_start_failed", e.message, e)
    }
  }

  @ReactMethod
  fun stopPresence(promise: Promise) {
    try {
      reactContext.stopService(Intent(reactContext, ChatForegroundService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("presence_stop_failed", e.message, e)
    }
  }

  /**
   * Post a message notification.
   *
   * `conversationKey` becomes the notification tag, so a second message from the same
   * person REPLACES the first rather than stacking. Ten notifications from one
   * conversation is noise; one saying there are ten is information.
   */
  @ReactMethod
  fun notifyMessage(
      conversationKey: String,
      title: String,
      body: String,
      count: Int,
      promise: Promise,
  ) {
    try {
      ChatForegroundService.ensureChannels(reactContext)

      val openIntent =
          PendingIntent.getActivity(
              reactContext,
              conversationKey.hashCode(),
              Intent(reactContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
              },
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          )

      val builder =
          NotificationCompat.Builder(reactContext, ChatForegroundService.MESSAGE_CHANNEL_ID)
              .setContentTitle(title)
              .setContentText(body)
              .setStyle(NotificationCompat.BigTextStyle().bigText(body))
              .setSmallIcon(R.mipmap.ic_launcher)
              .setContentIntent(openIntent)
              .setAutoCancel(true)
              .setCategory(NotificationCompat.CATEGORY_MESSAGE)
              .setPriority(NotificationCompat.PRIORITY_DEFAULT)

      if (count > 1) {
        builder.setNumber(count)
      }

      // Fails closed on a denied permission: notify() throws SecurityException on 13+
      // without POST_NOTIFICATIONS, and a message not shown is not a reason to crash.
      if (NotificationManagerCompat.from(reactContext).areNotificationsEnabled()) {
        NotificationManagerCompat.from(reactContext)
            .notify(conversationKey, MESSAGE_NOTIFICATION_ID, builder.build())
      }
      promise.resolve(true)
    } catch (e: SecurityException) {
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("notify_failed", e.message, e)
    }
  }

  /** Clear a conversation's notification, e.g. once the user opens that chat. */
  @ReactMethod
  fun clearMessageNotification(conversationKey: String, promise: Promise) {
    try {
      val manager =
          reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(conversationKey, MESSAGE_NOTIFICATION_ID)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /**
   * Why this app's process died last time, according to Android itself.
   *
   * The one question no amount of JavaScript can answer. A JS error can be caught and
   * written down on the way out; a native crash, an ANR or a low-memory kill end the
   * process with nothing running, so the app wakes up with no idea anything happened —
   * which is exactly the situation when somebody reports "it just closes".
   *
   * This asks the system, which keeps the record regardless of who died or how. Knowing
   * whether the last exit was CRASH_NATIVE or CRASH (the JS/Java kind) decides where to
   * look next, and telling them apart by hand is guesswork.
   *
   * Resolves null when there is nothing to report or the OS is too old to keep the
   * record — an unanswered question, which is different from "nothing happened".
   */
  @ReactMethod
  fun getLastExitReason(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      promise.resolve(null)
      return
    }
    try {
      val manager =
          reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val history = manager.getHistoricalProcessExitReasons(reactContext.packageName, 0, 1)
      val last = history.firstOrNull()
      if (last == null) {
        promise.resolve(null)
        return
      }
      val map = com.facebook.react.bridge.Arguments.createMap()
      map.putString("reason", reasonName(last.reason))
      map.putString("description", last.description ?: "")
      map.putDouble("at", last.timestamp.toDouble())
      map.putInt("status", last.status)
      // Only a genuine crash carries one, and it is the difference between "the OS
      // reclaimed memory" and "we have a bug".
      map.putBoolean(
          "wasCrash",
          last.reason == ApplicationExitInfo.REASON_CRASH ||
              last.reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
              last.reason == ApplicationExitInfo.REASON_ANR,
      )
      promise.resolve(map)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  /** The constant's name in words, because the numbers mean nothing on a screen. */
  private fun reasonName(reason: Int): String =
      when (reason) {
        ApplicationExitInfo.REASON_CRASH -> "App crashed (Java or JavaScript)"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
        ApplicationExitInfo.REASON_ANR -> "Stopped responding"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "Killed to free memory"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "Closed by you"
        ApplicationExitInfo.REASON_USER_STOPPED -> "Force stopped"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "Using too many resources"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "A permission changed"
        ApplicationExitInfo.REASON_SIGNALED -> "Killed by a signal"
        ApplicationExitInfo.REASON_EXIT_SELF -> "Exited on its own"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "A service it needed died"
        ApplicationExitInfo.REASON_OTHER -> "Other"
        else -> "Unknown ($reason)"
      }

  companion object {
    private const val REQUEST_NOTIFICATIONS = 8801
    /** Shared id; the per-conversation tag is what keeps them distinct. */
    private const val MESSAGE_NOTIFICATION_ID = 2001
  }
}
