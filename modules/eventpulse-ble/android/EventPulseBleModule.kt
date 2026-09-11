package com.eventpulse.ble

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/**
 * EventPulseBle — the Android half of the transport seam.
 *
 * This module does exactly three things and nothing else: scan, advertise, and
 * report adapter/permission state. All framing, deduplication, RSSI smoothing
 * and presence logic live in TypeScript, where they can be unit-tested without
 * a device. Anything clever added here would be untestable by construction.
 *
 * Two Android-specific decisions worth recording:
 *
 *  1. **Service-data filtering happens in the radio.** Passing a ScanFilter with
 *     our service-data UUID lets the Bluetooth chip reject other traffic before
 *     it ever wakes the app. In a hall with hundreds of beacons and headphones
 *     that is the difference between a warm phone and a dead one.
 *
 *  2. **Duplicates are requested deliberately.** `CALLBACK_TYPE_ALL_MATCHES` +
 *     `MATCH_MODE_AGGRESSIVE` gives us a stream of RSSI samples rather than a
 *     single first-seen event, which is what the smoothing filter needs. The
 *     cost of the resulting packet volume is paid in `PeerRegistry`, cheaply.
 */
class EventPulseBleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "EventPulseBle"

        private const val SCAN_EVENT = "EventPulseBleScanResult"
        private const val ADAPTER_EVENT = "EventPulseBleAdapterState"
        private const val ERROR_EVENT = "EventPulseBleError"

        /** 16-bit UUIDs live inside the Bluetooth base UUID. */
        private fun uuid16(value: Int): ParcelUuid =
            ParcelUuid(UUID.fromString(String.format("0000%04X-0000-1000-8000-00805F9B34FB", value)))
    }

    private val bluetoothManager: BluetoothManager? =
        reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    private val adapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter

    private var scanner: BluetoothLeScanner? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanCallback: ScanCallback? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var adapterReceiver: BroadcastReceiver? = null

    override fun getName(): String = NAME

    init {
        registerAdapterReceiver()
    }

    /* ------------------------------------------------------------------ *
     * Capability + state
     * ------------------------------------------------------------------ */

    @ReactMethod
    fun getCapabilities(promise: Promise) {
        val map = Arguments.createMap()
        val hasBle = reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
        val currentAdapter = adapter

        map.putBoolean("supportsCentral", hasBle && currentAdapter != null)
        // Plenty of shipped Android hardware can scan but cannot advertise. The
        // app degrades to scan-only rather than failing, so report it honestly.
        map.putBoolean(
            "supportsPeripheral",
            hasBle && currentAdapter?.isMultipleAdvertisementSupported == true,
        )
        map.putBoolean(
            "supportsExtendedAdvertising",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                currentAdapter?.isLeExtendedAdvertisingSupported == true,
        )
        map.putInt("maxAdvertisementBytes", 24)
        promise.resolve(map)
    }

    @ReactMethod
    fun getAdapterState(promise: Promise) {
        promise.resolve(currentAdapterState())
    }

    private fun currentAdapterState(): String {
        val currentAdapter = adapter ?: return "unsupported"
        if (!reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            return "unsupported"
        }
        if (!hasBlePermissions()) return "unauthorized"

        return when (currentAdapter.state) {
            BluetoothAdapter.STATE_ON -> "powered_on"
            BluetoothAdapter.STATE_OFF -> "powered_off"
            BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_TURNING_OFF -> "resetting"
            else -> "unknown"
        }
    }

    /**
     * Every permission the BLE features actually need, not just the ones the
     * scanner needs.
     *
     * BLUETOOTH_CONNECT used to be missing here, and its absence was invisible
     * precisely because this gate is what the app asks. Two things need it:
     * opening a GATT connection, and writing the adapter name — which the
     * peripheral library does on every advertisement to put the rotating peer
     * id on the air. Without the permission that write throws, the library
     * catches it and logs a warning, and advertising starts anyway carrying
     * whatever name the adapter had before. The far side then matches the wrong
     * name against its radar and reports the person as unreachable, with
     * nothing anywhere saying why.
     *
     * So a gate that answered "granted" while CONNECT was missing was not a
     * partial answer, it was a wrong one.
     */
    private fun hasBlePermissions(): Boolean {
        val permissions =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                listOf(
                    Manifest.permission.BLUETOOTH_SCAN,
                    Manifest.permission.BLUETOOTH_ADVERTISE,
                    Manifest.permission.BLUETOOTH_CONNECT,
                )
            } else {
                // Pre-Android 12 the OS gates BLE scanning behind location, even
                // though we neither want nor derive a location from it. CONNECT
                // did not exist yet; BLUETOOTH and BLUETOOTH_ADMIN are
                // install-time and need no runtime check.
                listOf(Manifest.permission.ACCESS_FINE_LOCATION)
            }

        return permissions.all {
            ContextCompat.checkSelfPermission(reactContext, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Which of the required permissions are missing, for diagnostics.
     *
     * Reported rather than inferred: "denied" on its own sent a whole session
     * looking in the wrong place.
     */
    private fun missingBlePermissions(): List<String> {
        val permissions =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                listOf(
                    Manifest.permission.BLUETOOTH_SCAN,
                    Manifest.permission.BLUETOOTH_ADVERTISE,
                    Manifest.permission.BLUETOOTH_CONNECT,
                )
            } else {
                listOf(Manifest.permission.ACCESS_FINE_LOCATION)
            }

        return permissions.filter {
            ContextCompat.checkSelfPermission(reactContext, it) != PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Runtime permission *requests* are driven from JavaScript through
     * `PermissionsAndroid`, so that the rationale screen and the prompt stay in
     * one place. This only reports the current answer.
     */
    @ReactMethod
    fun requestPermissions(promise: Promise) {
        promise.resolve(if (hasBlePermissions()) "granted" else "denied")
    }

    @ReactMethod
    fun getPermissionState(promise: Promise) {
        promise.resolve(if (hasBlePermissions()) "granted" else "undetermined")
    }

    /**
     * What is actually missing, and what the adapter is currently called.
     *
     * A bare "denied" is what made the last failure take a day to find. Naming
     * the missing permission turns it into one line of log.
     *
     * `adapter.name` is here for the same reason: it is what the peripheral
     * library overwrites to put the rotating peer id on the air, and reading it
     * needs BLUETOOTH_CONNECT on API 31+ — the very permission whose absence
     * breaks the write. So a null here is itself the diagnosis, not a gap in it.
     */
    @ReactMethod
    fun getPermissionDiagnostics(promise: Promise) {
        val map = Arguments.createMap()
        val missing = Arguments.createArray()
        for (permission in missingBlePermissions()) {
            missing.pushString(permission.removePrefix("android.permission."))
        }

        map.putArray("missing", missing)
        map.putBoolean("granted", missingBlePermissions().isEmpty())
        map.putInt("sdkInt", Build.VERSION.SDK_INT)

        val name =
            try {
                adapter?.name
            } catch (e: SecurityException) {
                null
            }
        if (name == null) map.putNull("adapterName") else map.putString("adapterName", name)

        promise.resolve(map)
    }

    @ReactMethod
    fun requestEnable(promise: Promise) {
        val currentAdapter = adapter
        if (currentAdapter == null) {
            promise.resolve(false)
            return
        }
        if (currentAdapter.isEnabled) {
            promise.resolve(true)
            return
        }

        // Since Android 13, apps cannot silently enable the adapter; the system
        // panel is the supported path and the UI falls back to Settings.
        val intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /* ------------------------------------------------------------------ *
     * Scanning
     * ------------------------------------------------------------------ */

    @ReactMethod
    fun startScan(serviceUuid16: Int, mode: String, allowDuplicates: Boolean, promise: Promise) {
        val currentAdapter = adapter
        if (currentAdapter == null || !currentAdapter.isEnabled) {
            promise.reject("adapter_off", "Bluetooth is not enabled")
            return
        }
        if (!hasBlePermissions()) {
            promise.reject("permission_denied", "Bluetooth scan permission not granted")
            return
        }

        stopScanInternal()

        try {
            scanner = currentAdapter.bluetoothLeScanner
            val serviceUuid = uuid16(serviceUuid16)

            // Filtering in the chip: other events' and other vendors' traffic is
            // rejected before it costs us a wakeup.
            val filters = listOf(ScanFilter.Builder().setServiceData(serviceUuid, byteArrayOf()).build())

            val settingsBuilder =
                ScanSettings.Builder()
                    .setScanMode(scanModeFor(mode))
                    .setReportDelay(0)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                settingsBuilder
                    .setCallbackType(
                        if (allowDuplicates) ScanSettings.CALLBACK_TYPE_ALL_MATCHES
                        else ScanSettings.CALLBACK_TYPE_FIRST_MATCH,
                    )
                    .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                    .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            }

            val callback =
                object : ScanCallback() {
                    override fun onScanResult(callbackType: Int, result: ScanResult?) {
                        val record = result?.scanRecord ?: return
                        val payload = record.getServiceData(serviceUuid) ?: return
                        emitScanResult(payload, result.rssi, result.device?.address)
                    }

                    override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                        results?.forEach { onScanResult(0, it) }
                    }

                    override fun onScanFailed(errorCode: Int) {
                        emitError("scan_failed", "BLE scan failed with code $errorCode")
                    }
                }

            scanCallback = callback
            scanner?.startScan(filters, settingsBuilder.build(), callback)
            promise.resolve(null)
        } catch (error: SecurityException) {
            promise.reject("permission_denied", error.message, error)
        } catch (error: Exception) {
            promise.reject("scan_failed", error.message, error)
        }
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        stopScanInternal()
        promise.resolve(null)
    }

    private fun stopScanInternal() {
        try {
            scanCallback?.let { scanner?.stopScan(it) }
        } catch (_: Exception) {
            // Stopping a scan that already stopped is not an error worth surfacing.
        }
        scanCallback = null
    }

    private fun scanModeFor(mode: String): Int =
        when (mode) {
            "low_power" -> ScanSettings.SCAN_MODE_LOW_POWER
            "low_latency" -> ScanSettings.SCAN_MODE_LOW_LATENCY
            else -> ScanSettings.SCAN_MODE_BALANCED
        }

    /* ------------------------------------------------------------------ *
     * Advertising
     * ------------------------------------------------------------------ */

    @ReactMethod
    fun startAdvertising(
        serviceUuid16: Int,
        payloadBase64: String,
        mode: String,
        txPower: String,
        promise: Promise,
    ) {
        val currentAdapter = adapter
        if (currentAdapter == null || !currentAdapter.isEnabled) {
            promise.reject("adapter_off", "Bluetooth is not enabled")
            return
        }
        if (currentAdapter.isMultipleAdvertisementSupported != true) {
            promise.reject("unsupported", "This device cannot advertise over BLE")
            return
        }

        stopAdvertisingInternal()

        try {
            advertiser = currentAdapter.bluetoothLeAdvertiser
            val payload = Base64.decode(payloadBase64, Base64.NO_WRAP)
            val serviceUuid = uuid16(serviceUuid16)

            val settings =
                AdvertiseSettings.Builder()
                    .setAdvertiseMode(advertiseModeFor(mode))
                    .setTxPowerLevel(txPowerFor(txPower))
                    .setConnectable(false)
                    .setTimeout(0)
                    .build()

            // No device name: it would blow the 31-byte budget and, worse, leak a
            // stable identifier ("Priya's Pixel") that defeats id rotation.
            val data =
                AdvertiseData.Builder()
                    .setIncludeDeviceName(false)
                    .setIncludeTxPowerLevel(false)
                    .addServiceUuid(serviceUuid)
                    .addServiceData(serviceUuid, payload)
                    .build()

            val callback =
                object : AdvertiseCallback() {
                    override fun onStartFailure(errorCode: Int) {
                        emitError("advertise_failed", "BLE advertising failed with code $errorCode")
                    }
                }

            advertiseCallback = callback
            advertiser?.startAdvertising(settings, data, callback)
            promise.resolve(null)
        } catch (error: SecurityException) {
            promise.reject("permission_denied", error.message, error)
        } catch (error: Exception) {
            promise.reject("advertise_failed", error.message, error)
        }
    }

    /**
     * Android has no in-place payload update for legacy advertising, so a
     * rotation is a stop/start. It is quick enough that peers do not notice —
     * and they resolve the new id from the schedule they already hold.
     */
    @ReactMethod
    fun updateAdvertising(
        serviceUuid16: Int,
        payloadBase64: String,
        mode: String,
        txPower: String,
        promise: Promise,
    ) {
        startAdvertising(serviceUuid16, payloadBase64, mode, txPower, promise)
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        stopAdvertisingInternal()
        promise.resolve(null)
    }

    private fun stopAdvertisingInternal() {
        try {
            advertiseCallback?.let { advertiser?.stopAdvertising(it) }
        } catch (_: Exception) {
            // Already stopped.
        }
        advertiseCallback = null
    }

    private fun advertiseModeFor(mode: String): Int =
        when (mode) {
            "low_power" -> AdvertiseSettings.ADVERTISE_MODE_LOW_POWER
            "low_latency" -> AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY
            else -> AdvertiseSettings.ADVERTISE_MODE_BALANCED
        }

    private fun txPowerFor(level: String): Int =
        when (level) {
            "ultra_low" -> AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW
            "low" -> AdvertiseSettings.ADVERTISE_TX_POWER_LOW
            "high" -> AdvertiseSettings.ADVERTISE_TX_POWER_HIGH
            else -> AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM
        }

    /* ------------------------------------------------------------------ *
     * Events
     * ------------------------------------------------------------------ */

    private fun emitScanResult(payload: ByteArray, rssi: Int, address: String?) {
        val map: WritableMap = Arguments.createMap()
        map.putString("data", Base64.encodeToString(payload, Base64.NO_WRAP))
        map.putInt("rssi", rssi)
        map.putDouble("timestamp", System.currentTimeMillis().toDouble())
        // The MAC is passed through only as an opaque dedup hint. It is never
        // persisted or rendered — Android randomises it for privacy anyway.
        if (address != null) map.putString("deviceKey", address)
        emit(SCAN_EVENT, map)
    }

    private fun emitError(code: String, message: String) {
        val map = Arguments.createMap()
        map.putString("code", code)
        map.putString("message", message)
        emit(ERROR_EVENT, map)
    }

    private fun emit(event: String, payload: Any?) {
        if (!reactContext.hasActiveCatalystInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    private fun registerAdapterReceiver() {
        val receiver =
            object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
                    emit(ADAPTER_EVENT, currentAdapterState())
                }
            }
        adapterReceiver = receiver
        reactContext.registerReceiver(receiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        stopScanInternal()
        stopAdvertisingInternal()
        adapterReceiver?.let {
            try {
                reactContext.unregisterReceiver(it)
            } catch (_: Exception) {
                // Already unregistered.
            }
        }
        adapterReceiver = null
        promise.resolve(null)
    }

    /** Required by NativeEventEmitter on iOS; harmless no-ops on Android. */
    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Int) = Unit
}
