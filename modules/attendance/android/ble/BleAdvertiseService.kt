package com.bleattendance.ble

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import com.bleattendance.MainActivity

/**
 * BleAdvertiseService
 * -----------------------------------------------------------------------------
 * Foreground service that OWNS the employee's BLE advertisement.
 *
 * WHAT A FOREGROUND SERVICE ACTUALLY DOES HERE
 *
 * It does not "keep the radio on" by magic. Once startAdvertising() succeeds,
 * the advertising payload and interval live in the Bluetooth controller
 * firmware, which transmits autonomously with no app CPU - Doze cannot even
 * reach it. The ONLY thing that stops it is the advertisement being
 * unregistered, which happens when our process dies.
 *
 * So the service's real job is to keep the PROCESS alive. A backgrounded React
 * Native app with no foreground service becomes a cached process and is prime
 * lowmemorykiller food - sometimes hours, sometimes ninety seconds.
 *
 * WHY THE SERVICE, NOT THE REACT MODULE, HOLDS THE CALLBACK
 *
 * This is the subtle part. Previously BleAdvertiserModule owned the
 * AdvertiseCallback and stopped advertising in invalidate(). When the last
 * Activity goes away the React instance can be torn down - and that would have
 * stopped the advertisement even though the process was still perfectly alive,
 * defeating the entire point of the service. Ownership therefore lives here,
 * outside the React lifecycle.
 *
 * HONEST LIMITS - see docs/ANDROID_BLE_NOTES.md
 *   foreground / backgrounded / screen off  -> advertising CONTINUES
 *   swiped from recents (AOSP, Pixel)       -> CONTINUES
 *   swiped from recents (Xiaomi/Oppo/Vivo)  -> often STOPS; OEM kills the
 *                                              process regardless of FGS
 *   force-stopped from Settings             -> STOPS. Nothing can prevent it.
 *   device rebooted                         -> STOPS; not auto-resumed here.
 * -----------------------------------------------------------------------------
 */
class BleAdvertiseService : Service() {

    companion object {
        private const val TAG = "BleAdvertiseSvc"
        private const val CHANNEL_ID = "ble_attendance_advertise"

        /** Must be non-zero: startForeground(0, ...) is ignored by the platform. */
        private const val NOTIFICATION_ID = 0x4B1E

        const val ACTION_START = "com.bleattendance.ble.action.START"
        const val ACTION_STOP = "com.bleattendance.ble.action.STOP"

        const val EXTRA_SHORT_UUID = "shortServiceUuid"
        const val EXTRA_LONG_UUID = "longServiceUuid"
        const val EXTRA_MANUFACTURER_ID = "manufacturerId"
        const val EXTRA_PAYLOAD = "payload"
        const val EXTRA_CONNECTABLE = "connectable"
        const val EXTRA_EMPLOYEE_ID = "employeeId"
        const val EXTRA_STATUS_CHAR_UUID = "statusCharUuid"

        /**
         * Whether an advertisement is genuinely on air, per Android's own
         * AdvertiseCallback. Read by the React module so JS never has to guess.
         */
        @Volatile
        var isAdvertising: Boolean = false
            private set

        @Volatile
        var lastError: String? = null
            private set

        /** Set by the module so results can be pushed to JS. */
        @Volatile
        var listener: ((advertising: Boolean, error: String?, errorCode: Int?) -> Unit)? = null

        /**
         * Receives raw status-report bytes written by a Host over GATT — the
         * attendance reply channel. Set by the module, which forwards to JS.
         */
        @Volatile
        var statusListener: ((ByteArray) -> Unit)? = null
    }

    private var advertiser: BluetoothLeAdvertiser? = null
    private var activeCallback: AdvertiseCallback? = null
    private var lastStartIntent: Intent? = null
    private var gattServer: BluetoothGattServer? = null

    /**
     * Turning Bluetooth off destroys every advertisement in the stack and NO
     * AdvertiseCallback fires - the app simply stops being visible with no
     * notification of any kind. Watch the adapter and re-arm on the way back up.
     */
    private val btStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_OFF -> {
                    Log.w(TAG, "Bluetooth turned off - advertisement lost")
                    closeGattServer()
                    activeCallback = null
                    isAdvertising = false
                    lastError = "Bluetooth was turned off"
                    listener?.invoke(false, lastError, null)
                }
                BluetoothAdapter.STATE_ON -> {
                    Log.i(TAG, "Bluetooth back on - re-arming advertisement")
                    lastStartIntent?.let { startAdvertisingInternal(it) }
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()

        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(btStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(btStateReceiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null || intent.action == ACTION_STOP) {
            shutdown()
            return START_NOT_STICKY
        }

        // STEP 1 - become foreground BEFORE touching the radio.
        //
        // After startForegroundService() the app has only a few seconds to call
        // startForeground(), or the system kills it with
        // ForegroundServiceDidNotStartInTimeException (surfaces as an ANR).
        if (!hasAdvertisePermission()) {
            // BLUETOOTH_ADVERTISE is the RUNTIME PREREQUISITE that satisfies the
            // connectedDevice service type. Without it startForeground() throws
            // SecurityException, so fail cleanly instead of crashing.
            Log.e(TAG, "BLUETOOTH_ADVERTISE not granted - refusing to start foreground service")
            lastError = "Nearby devices permission is not granted."
            listener?.invoke(false, lastError, null)
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            startForegroundCompat()
        } catch (e: Throwable) {
            // SecurityException      -> missing FOREGROUND_SERVICE_CONNECTED_DEVICE
            //                           or BLUETOOTH_ADVERTISE not granted
            // MissingForegroundServiceTypeException -> no foregroundServiceType in manifest
            // ForegroundServiceStartNotAllowedException -> started from background
            Log.e(TAG, "startForeground rejected: $e")
            lastError = "Android refused to start the background service: ${e.message}"
            listener?.invoke(false, lastError, null)
            stopSelf()
            return START_NOT_STICKY
        }

        // STEP 2 - now the radio.
        lastStartIntent = intent
        startAdvertisingInternal(intent)

        // REDELIVER_INTENT, not STICKY: if the system restarts the service after
        // a memory kill, START_STICKY would hand back a null intent and the
        // employee id payload would be lost.
        return START_REDELIVER_INTENT
    }

    /* ===================================================== advertising === */

    private fun startAdvertisingInternal(intent: Intent) {
        val manager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter

        if (adapter == null || !adapter.isEnabled) {
            lastError = "Bluetooth is off."
            isAdvertising = false
            listener?.invoke(false, lastError, null)
            return
        }

        val leAdvertiser = adapter.bluetoothLeAdvertiser
        if (leAdvertiser == null) {
            lastError = "This device cannot advertise (no peripheral role)."
            isAdvertising = false
            listener?.invoke(false, lastError, null)
            return
        }
        advertiser = leAdvertiser

        // Clear any previous advertisement, or the stack answers ALREADY_STARTED.
        activeCallback?.let {
            try {
                leAdvertiser.stopAdvertising(it)
            } catch (e: Exception) {
                Log.w(TAG, "Could not stop previous advertisement: ${e.message}")
            }
        }

        val shortUuid = intent.getStringExtra(EXTRA_SHORT_UUID) ?: return
        val longUuid = intent.getStringExtra(EXTRA_LONG_UUID)
        val manufacturerId = intent.getIntExtra(EXTRA_MANUFACTURER_ID, 0xFFFF)
        val payload = intent.getByteArrayExtra(EXTRA_PAYLOAD) ?: ByteArray(0)
        val connectable = intent.getBooleanExtra(EXTRA_CONNECTABLE, false)
        val statusCharUuid = intent.getStringExtra(EXTRA_STATUS_CHAR_UUID)

        /**
         * The attendance reply channel: a connectable advertisement plus a GATT
         * server hosting one writable characteristic. The Host connects after
         * recording a check-in and writes the status report; without this the
         * employee's phone can never learn its own attendance.
         */
        if (connectable && !longUuid.isNullOrBlank() && !statusCharUuid.isNullOrBlank()) {
            openGattServer(manager, longUuid, statusCharUuid)
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(connectable)
            // 0 = until explicitly stopped. Any non-zero value is capped at
            // 180000 ms by the platform and would silently end the session.
            .setTimeout(0)
            .build()

        val advertiseData = AdvertiseData.Builder()
            // Essential: the device name overflows the 31-byte packet.
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid.fromString(shortUuid))
            .apply { if (payload.isNotEmpty()) addManufacturerData(manufacturerId, payload) }
            .build()

        // Scan response has its own separate 31-byte budget, which is the only
        // reason a full 128-bit UUID fits anywhere.
        val scanResponse = if (!longUuid.isNullOrBlank()) {
            AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .setIncludeTxPowerLevel(false)
                .addServiceUuid(ParcelUuid.fromString(longUuid))
                .build()
        } else {
            null
        }

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                lastError = null
                Log.i(TAG, "Advertising started (service-owned)")
                listener?.invoke(true, null, null)
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                lastError = describeFailure(errorCode)
                Log.e(TAG, "Advertising failed: $lastError")
                listener?.invoke(false, lastError, errorCode)
            }
        }

        try {
            activeCallback = callback
            leAdvertiser.startAdvertising(settings, advertiseData, scanResponse, callback)
        } catch (e: SecurityException) {
            isAdvertising = false
            lastError = "Denied by the system: ${e.message}"
            listener?.invoke(false, lastError, null)
        } catch (e: Exception) {
            isAdvertising = false
            lastError = "startAdvertising threw: ${e.message}"
            listener?.invoke(false, lastError, null)
        }
    }

    private fun describeFailure(errorCode: Int): String = when (errorCode) {
        AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE ->
            "ADVERTISE_FAILED_DATA_TOO_LARGE (1): payload exceeds 31 bytes."
        AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS ->
            "ADVERTISE_FAILED_TOO_MANY_ADVERTISERS (2): no free advertising slot. " +
                "Toggle Bluetooth off and on."
        AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED ->
            "ADVERTISE_FAILED_ALREADY_STARTED (3)."
        AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR ->
            "ADVERTISE_FAILED_INTERNAL_ERROR (4). Toggling Bluetooth usually clears it."
        AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED ->
            "ADVERTISE_FAILED_FEATURE_UNSUPPORTED (5): this chipset has no peripheral role."
        else -> "Unknown advertising failure (code $errorCode)."
    }

    /* ======================================================= lifecycle === */

    /* ===================================================== reply channel === */

    /**
     * GATT server with a single write-only characteristic the Host writes
     * attendance status reports into.
     *
     * Bytes are forwarded raw to JS, which does ALL validation — the payload
     * is unauthenticated radio input and the JS decoder is the single strict
     * gate (see statusReport.ts). Kotlin only checks sizes it must.
     */
    private fun openGattServer(manager: BluetoothManager?, serviceUuid: String, charUuid: String) {
        if (manager == null) {
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "BLUETOOTH_CONNECT not granted - reply channel unavailable")
            return
        }

        closeGattServer()

        val callback = object : BluetoothGattServerCallback() {
            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice?,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic?,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray?,
            ) {
                // Acknowledge first so the Host is never left hanging on a
                // response while JS processes the payload.
                if (responseNeeded && device != null) {
                    try {
                        gattServer?.sendResponse(
                            device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null
                        )
                    } catch (e: SecurityException) {
                        Log.w(TAG, "sendResponse denied: ${e.message}")
                    }
                }
                val bytes = value ?: return
                // Cap matches the JS decoder; drop oversized junk here cheaply.
                // 1024 matches the JS decoder's ceiling; a report carrying a
                // full month of packed history is around 460 bytes.
                if (bytes.isEmpty() || bytes.size > 1024 || offset != 0 || preparedWrite) {
                    Log.w(TAG, "Ignoring malformed status write (${bytes.size} bytes)")
                    return
                }
                Log.i(TAG, "Status report received (${bytes.size} bytes)")
                statusListener?.invoke(bytes)
            }
        }

        try {
            val server = manager.openGattServer(this, callback) ?: run {
                Log.w(TAG, "openGattServer returned null")
                return
            }
            val service = BluetoothGattService(
                java.util.UUID.fromString(serviceUuid),
                BluetoothGattService.SERVICE_TYPE_PRIMARY,
            )
            val characteristic = BluetoothGattCharacteristic(
                java.util.UUID.fromString(charUuid),
                BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_WRITE,
            )
            service.addCharacteristic(characteristic)
            server.addService(service)
            gattServer = server
            Log.i(TAG, "Reply-channel GATT server open")
        } catch (e: SecurityException) {
            Log.w(TAG, "GATT server denied: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "GATT server failed: ${e.message}")
        }
    }

    private fun closeGattServer() {
        try {
            gattServer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "GATT server close failed: ${e.message}")
        }
        gattServer = null
    }

    private fun shutdown() {
        try {
            activeCallback?.let { advertiser?.stopAdvertising(it) }
        } catch (e: Exception) {
            Log.w(TAG, "stopAdvertising on shutdown failed: ${e.message}")
        }
        activeCallback = null
        isAdvertising = false
        lastError = null
        closeGattServer()
        listener?.invoke(false, null, null)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(btStateReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "Receiver already unregistered")
        }
        try {
            activeCallback?.let { advertiser?.stopAdvertising(it) }
        } catch (e: Exception) {
            Log.w(TAG, "Cleanup on destroy failed: ${e.message}")
        }
        activeCallback = null
        isAdvertising = false
        super.onDestroy()
    }

    /* ==================================================== notification === */

    private fun hasAdvertisePermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }
        return checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Attendance broadcasting",
            // LOW: the notification is mandatory for a foreground service, but
            // it must not buzz or make noise every time advertising starts.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while your phone is broadcasting your attendance ID."
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            tapIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("Attendance broadcasting")
            .setContentText("Your phone is visible to the attendance Host.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // The typed overload, mandatory from Android 14 (API 34) onward.
            // FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE is satisfied at runtime
            // by our already-granted BLUETOOTH_ADVERTISE permission.
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}
