package com.bleattendance.ble

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.ParcelUuid
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.UiThreadUtil

/**
 * BleAdvertiserModule
 * -----------------------------------------------------------------------------
 * Puts the phone into the BLE PERIPHERAL role using android.bluetooth.le.
 * BluetoothLeAdvertiser.
 *
 * WHY THIS FILE EXISTS
 * -----------------------------------------------------------------------------
 * react-native-ble-plx - used by this app for scanning - implements the BLE
 * CENTRAL role only. It cannot advertise; that is a documented scope decision by
 * the library, not a missing flag. Scanning and advertising are two separate
 * Android APIs:
 *
 *     scanning     ->  BluetoothLeScanner    (react-native-ble-plx covers this)
 *     advertising  ->  BluetoothLeAdvertiser (this file covers this)
 *
 * Running a scanner does NOT make a phone discoverable. Only an advertiser does.
 *
 * WHAT GOES ON AIR
 * -----------------------------------------------------------------------------
 * Legacy BLE advertising gives 31 bytes in the primary packet, plus a separate
 * 31 bytes in the scan response. We use:
 *
 *   primary packet   AD flags (added by Android)                  3 bytes
 *                    16-bit service UUID                          4 bytes
 *                    manufacturer data (company id + payload)  4 + N bytes
 *
 *   scan response    128-bit service UUID                        18 bytes
 *
 * setIncludeDeviceName(false) is essential - the device name is appended to the
 * primary packet and overflows it, producing ADVERTISE_FAILED_DATA_TOO_LARGE.
 *
 * Advertising is NON-CONNECTABLE: the scanner only needs to hear the broadcast.
 * No pairing, no bonding, no GATT connection is involved anywhere.
 * -----------------------------------------------------------------------------
 */
class BleAdvertiserModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "BleAdvertiser"
        private const val MODULE_NAME = "BleAdvertiser"
        private const val EVENT_STATE_CHANGED = "BleAdvertiserStateChanged"
        private const val EVENT_STATUS_REPORT = "BleStatusReportReceived"

        // Error codes surfaced to JavaScript as Promise rejection codes.
        private const val E_NO_BLUETOOTH = "E_NO_BLUETOOTH"
        private const val E_NO_ADVERTISER = "E_NO_ADVERTISER"
        private const val E_BLUETOOTH_OFF = "E_BLUETOOTH_OFF"
        private const val E_PERMISSION = "E_PERMISSION"
        private const val E_INVALID_CONFIG = "E_INVALID_CONFIG"
        private const val E_START_FAILED = "E_START_FAILED"
        private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
    }

    init {
        // Forward the service's AdvertiseCallback results to JavaScript.
        //
        // The service owns the advertisement and therefore the only truthful
        // source of "is it on air". This module is now just the bridge: it asks
        // the service to start or stop, and relays what the service observed.
        BleAdvertiseService.listener = { advertising, error, errorCode ->
            emitState(advertising, error, errorCode)
        }

        // Raw status-report bytes from the reply-channel GATT server. Encoded
        // as base64 for the bridge; ALL validation happens in JS.
        BleAdvertiseService.statusListener = { bytes ->
            val payload: WritableMap = Arguments.createMap().apply {
                putString("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            }
            try {
                reactContext.emitDeviceEvent(EVENT_STATUS_REPORT, payload)
            } catch (e: Exception) {
                Log.w(TAG, "Could not emit status report: ${e.message}")
            }
        }
    }

    override fun getName(): String = MODULE_NAME

    /* =====================================================================
     * ADAPTER ACCESS
     * ================================================================== */

    private fun getAdapter(): BluetoothAdapter? {
        val manager =
            reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
    }

    private fun hasBleHardware(): Boolean =
        reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

    /**
     * The Activity currently in the foreground, or null if the app is
     * backgrounded or between activities.
     *
     * WHY NOT JUST `currentActivity`
     * ---------------------------------------------------------------------
     * ReactContextBaseJavaModule used to be a Java class exposing
     * `protected Activity getCurrentActivity()`. Kotlin auto-generates
     * synthetic property access (`currentActivity`) for *Java* getters, which
     * is why that shorthand worked historically.
     *
     * As of React Native 0.87 that base class is itself written in Kotlin, and
     * Kotlin does NOT synthesise properties for Kotlin-declared functions - so
     * `currentActivity` no longer resolves. The method is also deprecated as of
     * RN 0.80, which explicitly directs callers to
     * `reactApplicationContext.currentActivity`.
     *
     * ReactContext is still a Java class, so the property form does resolve on
     * that receiver. `reactApplicationContext` is the same instance passed to
     * our constructor as `reactContext`.
     *
     * Deliberately a function, never a cached field: holding an Activity
     * reference in a member variable leaks it.
     */
    private fun foregroundActivity(): Activity? = reactApplicationContext.currentActivity

    /**
     * Android 12 (API 31) split Bluetooth into separate runtime permissions.
     * Below API 31 these permissions do not exist and are granted at install
     * time, so the check must be version-gated or it always fails on old phones.
     */
    private fun hasPermission(permission: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }
        return reactContext.checkSelfPermission(permission) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun hasAdvertisePermission(): Boolean =
        hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)

    private fun hasConnectPermission(): Boolean =
        hasPermission(Manifest.permission.BLUETOOTH_CONNECT)

    /* =====================================================================
     * EVENTS
     * ================================================================== */

    private fun emitState(isAdvertising: Boolean, error: String?, errorCode: Int?) {
        val payload: WritableMap = Arguments.createMap().apply {
            putBoolean("advertising", isAdvertising)
            if (error != null) putString("error", error) else putNull("error")
            if (errorCode != null) putInt("errorCode", errorCode) else putNull("errorCode")
        }

        try {
            // ReactContext.emitDeviceEvent is the supported path in RN 0.87 and
            // works under both the bridge and bridgeless (New Architecture)
            // runtimes. It looks up RCTDeviceEventEmitter internally and
            // no-ops safely if the JS side is not attached, which the older
            // getJSModule(...).emit(...) form did not.
            reactContext.emitDeviceEvent(EVENT_STATE_CHANGED, payload)
        } catch (e: Exception) {
            // The JS side may already be torn down during app shutdown.
            Log.w(TAG, "Could not emit state event: ${e.message}")
        }
    }

    /**
     * NativeEventEmitter requires these two methods to exist on the module.
     * Without them React Native logs "new NativeEventEmitter() was called with a
     * non-null argument without the required addListener method" on every start.
     * The bookkeeping itself is handled by NativeEventEmitter on the JS side.
     */
    @ReactMethod
    fun addListener(eventName: String) {
        // no-op
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // no-op
    }

    /* =====================================================================
     * CAPABILITIES
     * ================================================================== */

    /**
     * Report what this specific handset can actually do, so the UI can explain
     * a hardware limitation instead of just failing.
     */
    @ReactMethod
    fun getCapabilities(promise: Promise) {
        val result = Arguments.createMap()

        try {
            val bleSupported = hasBleHardware()
            val adapter = getAdapter()
            val bluetoothEnabled = adapter?.isEnabled == true

            // getBluetoothLeAdvertiser() returns null when the chipset or
            // firmware has no peripheral-role support, and also when Bluetooth
            // is switched off - so it is only meaningful with Bluetooth on.
            val leAdvertiser = if (bluetoothEnabled) adapter?.bluetoothLeAdvertiser else null

            result.putBoolean("bleSupported", bleSupported)
            result.putBoolean("advertisingSupported", leAdvertiser != null)
            result.putBoolean("bluetoothEnabled", bluetoothEnabled)
            result.putBoolean(
                "multipleAdvertisementSupported",
                adapter?.isMultipleAdvertisementSupported == true
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                result.putBoolean(
                    "extendedAdvertisingSupported",
                    adapter?.isLeExtendedAdvertisingSupported == true
                )
                result.putInt(
                    "maxAdvertisingDataLength",
                    adapter?.leMaximumAdvertisingDataLength ?: 31
                )
            } else {
                result.putBoolean("extendedAdvertisingSupported", false)
                result.putInt("maxAdvertisingDataLength", 31)
            }

            // Reading the adapter name needs BLUETOOTH_CONNECT on API 31+.
            val adapterName = try {
                if (hasConnectPermission()) adapter?.name ?: "unknown" else "permission required"
            } catch (e: SecurityException) {
                "permission required"
            }
            result.putString("adapterName", adapterName)
            result.putBoolean("locationServicesEnabled", locationServicesEnabled())

            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getCapabilities failed", e)
            promise.reject("E_CAPABILITIES", "Could not read adapter capabilities: ${e.message}", e)
        }
    }

    /* =====================================================================
     * LOCATION SERVICES
     * ================================================================== */

    private fun locationServicesEnabled(): Boolean {
        return try {
            val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                ?: return false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                lm.isLocationEnabled
            } else {
                @Suppress("DEPRECATION")
                val mode = Settings.Secure.getInt(
                    reactContext.contentResolver,
                    Settings.Secure.LOCATION_MODE,
                    Settings.Secure.LOCATION_MODE_OFF
                )
                mode != Settings.Secure.LOCATION_MODE_OFF
            }
        } catch (e: Exception) {
            Log.w(TAG, "locationServicesEnabled check failed: ${e.message}")
            false
        }
    }

    /**
     * BLE SCANNING silently returns zero results when the location master switch
     * is off (Android 6-11 always; Android 12+ when the app scans with
     * ACCESS_FINE_LOCATION rather than the neverForLocation flag).
     * Advertising is not affected.
     */
    @ReactMethod
    fun isLocationServicesEnabled(promise: Promise) {
        promise.resolve(locationServicesEnabled())
    }

    @ReactMethod
    fun openLocationSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            val activity: Activity? = foregroundActivity()
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                // Starting an Activity from a non-Activity Context requires
                // FLAG_ACTIVITY_NEW_TASK, or Android throws.
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_SETTINGS", "Could not open location settings: ${e.message}", e)
        }
    }

    /**
     * Show the system "allow this app to turn on Bluetooth?" dialog.
     *
     * We use ACTION_REQUEST_ENABLE rather than BluetoothAdapter.enable(): that
     * method was deprecated in Android 13 (API 33) and now returns false without
     * doing anything for ordinary apps.
     */
    @ReactMethod
    fun requestEnableBluetooth(promise: Promise) {
        if (!hasConnectPermission()) {
            promise.reject(
                E_PERMISSION,
                "BLUETOOTH_CONNECT permission is required to ask the user to turn Bluetooth on."
            )
            return
        }

        // The enable dialog is a system Activity result, so it genuinely needs a
        // foreground Activity - there is no Context fallback here.
        val activity: Activity? = foregroundActivity()
        if (activity == null) {
            promise.reject(
                E_NO_ACTIVITY,
                "No foreground activity available to show the Bluetooth enable dialog."
            )
            return
        }

        try {
            activity.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            promise.resolve(true)
        } catch (e: SecurityException) {
            promise.reject(E_PERMISSION, "Denied by the system: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("E_ENABLE", "Could not request Bluetooth enable: ${e.message}", e)
        }
    }

    /* =====================================================================
     * ADVERTISING
     * ================================================================== */

    private fun advertiseModeFrom(name: String?): Int = when (name) {
        "lowPower" -> AdvertiseSettings.ADVERTISE_MODE_LOW_POWER
        "balanced" -> AdvertiseSettings.ADVERTISE_MODE_BALANCED
        else -> AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY
    }

    private fun txPowerFrom(name: String?): Int = when (name) {
        "ultraLow" -> AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW
        "low" -> AdvertiseSettings.ADVERTISE_TX_POWER_LOW
        "medium" -> AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM
        else -> AdvertiseSettings.ADVERTISE_TX_POWER_HIGH
    }

    /** Translate AdvertiseCallback.onStartFailure codes into something actionable. */
    private fun describeFailure(errorCode: Int): String = when (errorCode) {
        AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE ->
            "ADVERTISE_FAILED_DATA_TOO_LARGE (1): the advertising payload exceeds " +
                "31 bytes. Shorten HOST_ID, or make sure the device name is not " +
                "being included."
        AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS ->
            "ADVERTISE_FAILED_TOO_MANY_ADVERTISERS (2): the Bluetooth stack has no " +
                "free advertising slot. Another app is advertising, or a previous " +
                "advertisement leaked. Toggle Bluetooth off and on."
        AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED ->
            "ADVERTISE_FAILED_ALREADY_STARTED (3): this callback is already " +
                "advertising."
        AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR ->
            "ADVERTISE_FAILED_INTERNAL_ERROR (4): internal Bluetooth stack error. " +
                "Toggling Bluetooth off and on usually clears it."
        AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED ->
            "ADVERTISE_FAILED_FEATURE_UNSUPPORTED (5): this phone's Bluetooth " +
                "chipset does not support the peripheral role. No app can work " +
                "around this - use the other phone as the Host."
        else -> "Unknown advertising failure (code $errorCode)."
    }

    /**
     * config keys:
     *   shortServiceUuid    String  128-bit form of the 16-bit alias (primary packet)
     *   longServiceUuid     String  full random UUID (scan response)
     *   manufacturerId      Int     company identifier, 0xFFFF for testing
     *   manufacturerData    Array   payload bytes, built in JavaScript
     *   connectable         Bool
     *   includeDeviceName   Bool    keep false - it overflows the 31-byte packet
     *   advertiseMode       String  lowPower | balanced | lowLatency
     *   txPowerLevel        String  ultraLow | low | medium | high
     */
    @ReactMethod
    fun startAdvertising(config: ReadableMap, promise: Promise) {
        if (!hasBleHardware()) {
            promise.reject(E_NO_BLUETOOTH, "This device has no Bluetooth Low Energy hardware.")
            return
        }

        val adapter = getAdapter()
        if (adapter == null) {
            promise.reject(E_NO_BLUETOOTH, "No Bluetooth adapter is available on this device.")
            return
        }

        if (!adapter.isEnabled) {
            promise.reject(E_BLUETOOTH_OFF, "Bluetooth is turned off. Switch it on and retry.")
            return
        }

        if (!hasAdvertisePermission()) {
            promise.reject(
                E_PERMISSION,
                "BLUETOOTH_ADVERTISE permission has not been granted (required on Android 12+)."
            )
            return
        }

        if (adapter.bluetoothLeAdvertiser == null) {
            promise.reject(
                E_NO_ADVERTISER,
                "This phone cannot act as a BLE peripheral: getBluetoothLeAdvertiser() " +
                    "returned null. The chipset supports the central (scanning) role only."
            )
            return
        }

        val shortUuid = config.getString("shortServiceUuid")
        if (shortUuid.isNullOrBlank()) {
            promise.reject(E_INVALID_CONFIG, "shortServiceUuid is required.")
            return
        }

        val payloadArray = config.getArray("manufacturerData")
        val payload = ByteArray(payloadArray?.size() ?: 0) { index ->
            (payloadArray!!.getInt(index) and 0xFF).toByte()
        }

        // Hand the advertisement to the FOREGROUND SERVICE rather than owning it
        // here.
        //
        // This is the whole point of the redesign: a React module's lifetime is
        // tied to the React instance, which is torn down when the last Activity
        // goes away. An advertisement owned here would die at that moment even
        // though the process was still alive. The service outlives the React
        // instance, so the advertisement does too.
        val intent = Intent(reactContext, BleAdvertiseService::class.java).apply {
            action = BleAdvertiseService.ACTION_START
            putExtra(BleAdvertiseService.EXTRA_SHORT_UUID, shortUuid)
            putExtra(BleAdvertiseService.EXTRA_LONG_UUID, config.getString("longServiceUuid"))
            putExtra(
                BleAdvertiseService.EXTRA_MANUFACTURER_ID,
                if (config.hasKey("manufacturerId")) config.getInt("manufacturerId") else 0xFFFF
            )
            putExtra(BleAdvertiseService.EXTRA_PAYLOAD, payload)
            putExtra(
                BleAdvertiseService.EXTRA_CONNECTABLE,
                config.hasKey("connectable") && config.getBoolean("connectable")
            )
            putExtra(
                BleAdvertiseService.EXTRA_STATUS_CHAR_UUID,
                config.getString("statusCharUuid")
            )
        }

        try {
            // startForegroundService, not startService: the service MUST promote
            // itself with startForeground() within a few seconds or Android kills
            // it. The service does that as its first action.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            // Resolving here means only that the service was asked to start. The
            // authoritative answer arrives via the service's AdvertiseCallback,
            // which is forwarded to JS as an event.
            promise.resolve(true)
        } catch (e: Exception) {
            val message = "Could not start the advertising service: ${e.message}"
            emitState(false, message, null)
            promise.reject(E_START_FAILED, message, e)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        val intent = Intent(reactContext, BleAdvertiseService::class.java).apply {
            action = BleAdvertiseService.ACTION_STOP
        }
        try {
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            // If the service is already gone there is nothing left to stop.
            Log.w(TAG, "stopAdvertising: ${e.message}")
            emitState(false, null, null)
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun isAdvertising(promise: Promise) {
        // Ground truth from the service, which owns the AdvertiseCallback.
        promise.resolve(BleAdvertiseService.isAdvertising)
    }

    /**
     * React instance teardown.
     *
     * DELIBERATELY DOES NOT STOP ADVERTISING.
     *
     * This method runs when the React instance goes away - which happens when
     * the last Activity is destroyed, i.e. exactly when the user backgrounds or
     * closes the app. Stopping the advertisement here would kill it at the very
     * moment the foreground service exists to keep it running, silently undoing
     * the entire feature.
     *
     * The advertisement is owned by BleAdvertiseService and is stopped only by
     * an explicit ACTION_STOP, or when Android destroys the service.
     */
    override fun invalidate() {
        BleAdvertiseService.listener = null
        BleAdvertiseService.statusListener = null
        super.invalidate()
    }
}
