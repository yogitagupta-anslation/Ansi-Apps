package com.blechat.presence

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.blechat.MainActivity
import com.blechat.R

/**
 * Keeps the radio alive while the app is not on screen.
 *
 * Android stops an ordinary app's Bluetooth work shortly after it leaves the foreground.
 * For a chat app that is fatal in a quiet way: the phone is in a pocket, somebody walks
 * past and messages you, and nothing happens — not a delay, a permanent miss, because
 * BLE has no store-and-forward server behind it. The message only exists while both
 * radios are on.
 *
 * A foreground service is the only sanctioned way to keep scanning and advertising when
 * the app is backgrounded. It requires a permanent, user-visible notification, and that
 * is a feature rather than a cost: the phone is using the radio on the user's behalf and
 * they should be able to see it and stop it.
 *
 * Deliberately does NOT own the BLE stack. The service exists purely to hold the process
 * in the foreground; scanning, advertising and connections stay in the JS layer where the
 * rest of the app can see them. Splitting the radio across two owners is how state gets
 * out of sync.
 */
class ChatForegroundService : Service() {

  companion object {
    const val CHANNEL_ID = "blechat.presence"
    const val MESSAGE_CHANNEL_ID = "blechat.messages"
    const val NOTIFICATION_ID = 1001
    const val ACTION_STOP = "com.blechat.presence.STOP"

    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    /** Created once; safe to call repeatedly. */
    fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return
      }
      val manager = context.getSystemService(NotificationManager::class.java) ?: return

      // LOW: this one is permanent, so it must never make a sound or push itself in
      // front of anything. It is a status indicator, not an alert.
      val presence =
          NotificationChannel(
              CHANNEL_ID,
              "Staying discoverable",
              NotificationManager.IMPORTANCE_LOW,
          )
      presence.description =
          "Shown while BLE Chat keeps the Bluetooth radio active in the background."
      presence.setShowBadge(false)
      manager.createNotificationChannel(presence)

      // DEFAULT: an actual message is worth a sound, and worth the user being able to
      // silence separately from the presence notification.
      val messages =
          NotificationChannel(
              MESSAGE_CHANNEL_ID,
              "Messages",
              NotificationManager.IMPORTANCE_DEFAULT,
          )
      messages.description = "New messages from people nearby."
      manager.createNotificationChannel(messages)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      // The user tapped Stop on the notification: honour it immediately rather than
      // leaving a notification whose button appears to do nothing.
      stopSelf()
      return START_NOT_STICKY
    }

    ensureChannels(this)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "BLE Chat is active"
    val text =
        intent?.getStringExtra(EXTRA_TEXT)
            ?: "Staying discoverable so people nearby can reach you."

    startForeground(NOTIFICATION_ID, buildNotification(title, text))

    // START_STICKY: if Android kills the process under memory pressure, bring the
    // service back. The user asked to stay reachable; silently ceasing to be is the
    // failure this whole service exists to prevent.
    return START_STICKY
  }

  private fun buildNotification(title: String, text: String): Notification {
    val openIntent =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
              flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE,
        )

    val stopIntent =
        PendingIntent.getService(
            this,
            1,
            Intent(this, ChatForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )

    return NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentIntent(openIntent)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        // A way out that does not require hunting through Settings. Keeping the radio
        // on is the user's choice, so stopping must be one tap.
        .addAction(0, "Stop", stopIntent)
        .build()
  }

  override fun onDestroy() {
    super.onDestroy()
    stopForeground(STOP_FOREGROUND_REMOVE)
  }
}
