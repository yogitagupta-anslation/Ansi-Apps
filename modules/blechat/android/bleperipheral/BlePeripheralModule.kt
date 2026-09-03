package com.blechat.bleperipheral

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * BLE PERIPHERAL role for Android.
 *
 * react-native-ble-plx implements the CENTRAL role only. Its own README states it does not
 * support "communicating between phones using BLE (Peripheral support)". Phone-to-phone
 * chat needs both halves, so the peripheral half is implemented natively here using
 * BluetoothGattServer + BluetoothLeAdvertiser.
 *
 * Responsibilities:
 *   - advertise the 128-bit application service UUID so other phones can discover us
 *   - host a GATT server with an RX characteristic (centrals write to us) and a
 *     TX characteristic (we notify centrals)
 *   - surface connect / disconnect / data / MTU events to JavaScript
 *
 * Notification flow control: BluetoothGattServer permits exactly ONE outstanding
 * notification at a time. Sending another before onNotificationSent fires causes it to be
 * silently dropped, which destroys fragmented messages. Every notify therefore goes
 * through a serialized queue drained by onNotificationSent.
 */
class BlePeripheralModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "BlePeripheral"
    private const val TAG = "BlePeripheral"

    private const val EVENT_STATE = "BlePeripheral:state"
    private const val EVENT_CENTRAL_CONNECTED = "BlePeripheral:centralConnected"
    private const val EVENT_CENTRAL_DISCONNECTED = "BlePeripheral:centralDisconnected"
    private const val EVENT_DATA = "BlePeripheral:data"
    private const val EVENT_SUBSCRIPTION = "BlePeripheral:subscription"
    private const val EVENT_MTU = "BlePeripheral:mtu"
    private const val EVENT_ERROR = "BlePeripheral:error"

    private const val CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb"
    private const val MANUFACTURER_ID = 0xFFFF

    /**
     * v1: version, peer-id prefix, name.
     * v2: adds a 3-byte interest bitmask between the prefix and the name, so a scanner
     * can see what somebody is into BEFORE connecting to them.
     */
    private const val ADV_PAYLOAD_VERSION = 2

    /** Scan response is 31 bytes; 4 are consumed by the AD header and company id. */
    private const val MAX_MANUFACTURER_PAYLOAD = 27
    private const val PEER_ID_PREFIX_BYTES = 8

    /** 24 catalogue interests, one bit each, little-endian. */
    private const val INTEREST_MASK_BYTES = 3
  }

  override fun getName() = NAME

  private val bluetoothManager: BluetoothManager? by lazy {
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  }
  private val adapter: BluetoothAdapter?
    get() = bluetoothManager?.adapter

  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private var rxCharacteristic: BluetoothGattCharacteristic? = null

  private var serviceUuid: UUID? = null
  private var isAdvertising = false
  private var startPromise: Promise? = null

  private var pendingAdvertisePayload: ByteArray = ByteArray(0)

  /** address -> device, for every central currently connected to our GATT server. */
  private val connectedCentrals = ConcurrentHashMap<String, BluetoothDevice>()

  /** address -> negotiated ATT MTU. */
  private val centralMtu = ConcurrentHashMap<String, Int>()

  /** addresses that enabled notifications on the TX characteristic. */
  private val subscribed = ConcurrentHashMap<String, Boolean>()

  // ---- notification queue -------------------------------------------------

  private class Notification(val device: BluetoothDevice, val bytes: ByteArray)

  private val notifyQueue = ArrayDeque<Notification>()
  private val notifyLock = Any()
  private var notifyInFlight = false

  // ---- JS event plumbing --------------------------------------------------

  private fun emit(event: String, params: WritableMap?) {
    if (!reactContext.hasActiveReactInstance()) {
      return
    }
    try {
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, params)
    } catch (e: Exception) {
      Log.w(TAG, "emit failed for " + event, e)
    }
  }

  private fun emitError(message: String) {
    val map = Arguments.createMap()
    map.putString("message", message)
    emit(EVENT_ERROR, map)
  }

  /** Required so NativeEventEmitter does not warn on the JS side. */
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Int) = Unit

  // ---- capability probing -------------------------------------------------

  private fun hasPermission(permission: String): Boolean =
      ContextCompat.checkSelfPermission(reactContext, permission) ==
          PackageManager.PERMISSION_GRANTED

  private fun missingPermissions(): List<String> {
    val missing = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)) {
        missing.add("BLUETOOTH_ADVERTISE")
      }
      if (!hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
        missing.add("BLUETOOTH_CONNECT")
      }
    }
    return missing
  }

  /**
   * Reports what this specific handset can actually do. Peripheral mode is a hardware and
   * firmware capability: many older or budget Android devices report BLE support yet return
   * null from getBluetoothLeAdvertiser(). We surface that rather than pretending.
   */
  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val map = Arguments.createMap()
    val a = adapter
    map.putBoolean("hasBluetooth", a != null)
    map.putBoolean("bluetoothEnabled", a != null && a.isEnabled)
    map.putBoolean(
        "supportsMultipleAdvertisement",
        a != null && a.isMultipleAdvertisementSupported,
    )
    // getBluetoothLeAdvertiser() returns null while the adapter is off, so this field is
    // only authoritative when bluetoothEnabled is true.
    map.putBoolean("hasAdvertiser", a != null && a.bluetoothLeAdvertiser != null)
    map.putBoolean("isAdvertising", isAdvertising)
    map.putInt("sdkInt", Build.VERSION.SDK_INT)
    val missing = Arguments.createArray()
    for (m in missingPermissions()) {
      missing.pushString(m)
    }
    map.putArray("missingPermissions", missing)
    promise.resolve(map)
  }

  // ---- lifecycle ----------------------------------------------------------

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun start(
      serviceUuidStr: String,
      rxUuidStr: String,
      txUuidStr: String,
      peerIdPrefixHex: String,
      displayName: String,
      interestMask: Double,
      promise: Promise,
  ) {
    val missing = missingPermissions()
    if (missing.isNotEmpty()) {
      promise.reject("E_PERMISSION", "Missing permissions: " + missing.joinToString())
      return
    }

    val a = adapter
    if (a == null) {
      promise.reject("E_NO_BLUETOOTH", "This device has no Bluetooth adapter")
      return
    }
    if (!a.isEnabled) {
      promise.reject("E_BT_OFF", "Bluetooth is turned off")
      return
    }

    val adv = a.bluetoothLeAdvertiser
    if (adv == null) {
      promise.reject(
          "E_NO_ADVERTISER",
          "This device does not support BLE advertising (peripheral role)",
      )
      return
    }

    if (gattServer != null) {
      // Already running. Restart cleanly so a changed display name takes effect.
      stopInternal()
    }

    val manager = bluetoothManager
    if (manager == null) {
      promise.reject("E_NO_BLUETOOTH", "BluetoothManager unavailable")
      return
    }

    val parsedServiceUuid =
        try {
          UUID.fromString(serviceUuidStr)
        } catch (e: IllegalArgumentException) {
          promise.reject("E_BAD_UUID", "Invalid service UUID: " + serviceUuidStr)
          return
        }

    advertiser = adv
    serviceUuid = parsedServiceUuid
    startPromise = promise

    val server = manager.openGattServer(reactContext, gattServerCallback)
    if (server == null) {
      startPromise = null
      promise.reject("E_GATT_SERVER", "openGattServer returned null")
      return
    }
    gattServer = server

    val service =
        BluetoothGattService(parsedServiceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)

    // Centrals WRITE to RX. Write-without-response is the fast path used for fragments.
    val rx =
        BluetoothGattCharacteristic(
            UUID.fromString(rxUuidStr),
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )

    // We NOTIFY on TX. The CCCD is what a central writes in order to subscribe.
    val tx =
        BluetoothGattCharacteristic(
            UUID.fromString(txUuidStr),
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or
                BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
    tx.addDescriptor(
        BluetoothGattDescriptor(
            UUID.fromString(CCCD_UUID),
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        ),
    )

    service.addCharacteristic(rx)
    service.addCharacteristic(tx)
    rxCharacteristic = rx
    txCharacteristic = tx

    pendingAdvertisePayload =
        buildManufacturerPayload(peerIdPrefixHex, displayName, interestMask)

    // addService is asynchronous. Advertising only starts once onServiceAdded fires.
    if (!server.addService(service)) {
      startPromise = null
      stopInternal()
      promise.reject("E_ADD_SERVICE", "addService returned false")
    }
  }

  /**
   * version | peer-id prefix (8) | interest bitmask (3, little-endian) | name (rest)
   *
   * The name is truncated to whatever is left, which is now 15 bytes rather than 18. That
   * is the cost of showing interests before a connection exists, and it is worth paying:
   * a truncated name is still recognisable, whereas "connect to find out" is not a reason
   * to connect.
   *
   * Truncation is by BYTE, so a multi-byte character can be cut in half. The JS side
   * decodes defensively for exactly that reason.
   */
  private fun buildManufacturerPayload(
      peerIdPrefixHex: String,
      displayName: String,
      interestMask: Double,
  ): ByteArray {
    val prefix = hexToBytes(peerIdPrefixHex).copyOf(PEER_ID_PREFIX_BYTES)
    val nameBytes = displayName.toByteArray(Charsets.UTF_8)
    val header = 1 + PEER_ID_PREFIX_BYTES + INTEREST_MASK_BYTES
    val room = MAX_MANUFACTURER_PAYLOAD - header
    val name = if (nameBytes.size > room) nameBytes.copyOf(room) else nameBytes

    val out = ByteArray(header + name.size)
    out[0] = ADV_PAYLOAD_VERSION.toByte()
    System.arraycopy(prefix, 0, out, 1, PEER_ID_PREFIX_BYTES)

    // Arrives as a Double because React Native has no integer bridge type. Clamped to the
    // 24 bits that actually exist before anything is written.
    var mask = interestMask.toLong().coerceIn(0L, 0xFFFFFFL)
    for (i in 0 until INTEREST_MASK_BYTES) {
      out[1 + PEER_ID_PREFIX_BYTES + i] = (mask and 0xFF).toByte()
      mask = mask shr 8
    }

    System.arraycopy(name, 0, out, header, name.size)
    return out
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.filter { it.isDigit() || (it in 'a'..'f') || (it in 'A'..'F') }
    val out = ByteArray(clean.length / 2)
    for (i in out.indices) {
      out[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
    return out
  }

  @SuppressLint("MissingPermission")
  private fun startAdvertising() {
    val adv = advertiser
    val uuid = serviceUuid
    if (adv == null || uuid == null) {
      resolveStart(false, "advertiser unavailable")
      return
    }

    val settings =
        AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0) // advertise until explicitly stopped
            .build()

    // The 31-byte primary packet carries flags plus our 128-bit service UUID and nothing
    // else: a 128-bit UUID alone costs 18 of the 31 bytes.
    val data =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(uuid))
            .build()

    // Identity goes in the separate 31-byte scan response.
    val scanResponse =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addManufacturerData(MANUFACTURER_ID, pendingAdvertisePayload)
            .build()

    try {
      adv.startAdvertising(settings, data, scanResponse, advertiseCallback)
    } catch (e: Exception) {
      resolveStart(false, "startAdvertising threw: " + e.message)
    }
  }

  private val advertiseCallback =
      object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          isAdvertising = true
          Log.i(TAG, "advertising started")
          val map = Arguments.createMap()
          map.putBoolean("advertising", true)
          emit(EVENT_STATE, map)
          resolveStart(true, null)
        }

        override fun onStartFailure(errorCode: Int) {
          isAdvertising = false
          val reason =
              when (errorCode) {
                ADVERTISE_FAILED_ALREADY_STARTED -> "already started"
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "advertise data too large"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED ->
                    "advertising unsupported on this device"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "internal error"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "too many advertisers"
                else -> "unknown error " + errorCode
              }
          Log.e(TAG, "advertising failed: " + reason)
          val map = Arguments.createMap()
          map.putBoolean("advertising", false)
          map.putString("error", reason)
          emit(EVENT_STATE, map)
          resolveStart(false, reason)
        }
      }

  private fun resolveStart(ok: Boolean, error: String?) {
    val p = startPromise ?: return
    startPromise = null
    if (ok) {
      val map = Arguments.createMap()
      map.putBoolean("advertising", true)
      p.resolve(map)
    } else {
      stopInternal()
      p.reject("E_ADVERTISE", error ?: "advertising failed")
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    stopInternal()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  private fun stopInternal() {
    try {
      if (isAdvertising) {
        advertiser?.stopAdvertising(advertiseCallback)
      }
    } catch (e: Exception) {
      Log.w(TAG, "stopAdvertising failed", e)
    }
    isAdvertising = false

    try {
      gattServer?.close()
    } catch (e: Exception) {
      Log.w(TAG, "gattServer.close failed", e)
    }
    gattServer = null
    txCharacteristic = null
    rxCharacteristic = null
    connectedCentrals.clear()
    centralMtu.clear()
    subscribed.clear()
    synchronized(notifyLock) {
      notifyQueue.clear()
      notifyInFlight = false
    }

    val map = Arguments.createMap()
    map.putBoolean("advertising", false)
    emit(EVENT_STATE, map)
  }

  // ---- sending ------------------------------------------------------------

  /**
   * Queue one already-fragmented frame for delivery to a specific central.
   *
   * `base64Data` must already fit the negotiated MTU. Fragmentation lives in JavaScript so
   * that the central and peripheral code paths share exactly one implementation.
   */
  @ReactMethod
  fun send(centralId: String, base64Data: String, promise: Promise) {
    val device = connectedCentrals[centralId]
    if (device == null) {
      promise.reject("E_NO_CENTRAL", "No connected central with id " + centralId)
      return
    }
    if (txCharacteristic == null) {
      promise.reject("E_NOT_STARTED", "GATT server is not running")
      return
    }
    if (subscribed[centralId] != true) {
      promise.reject(
          "E_NOT_SUBSCRIBED",
          "Central " + centralId + " has not enabled notifications on the TX characteristic",
      )
      return
    }

    val bytes =
        try {
          Base64.decode(base64Data, Base64.NO_WRAP)
        } catch (e: Exception) {
          promise.reject("E_BAD_DATA", "data is not valid base64")
          return
        }

    synchronized(notifyLock) { notifyQueue.add(Notification(device, bytes)) }
    pumpNotifications()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  private fun pumpNotifications() {
    val next: Notification
    synchronized(notifyLock) {
      if (notifyInFlight) {
        return
      }
      next = notifyQueue.poll() ?: return
      notifyInFlight = true
    }

    val server = gattServer
    val tx = txCharacteristic
    if (server == null || tx == null) {
      synchronized(notifyLock) { notifyInFlight = false }
      return
    }

    val ok =
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(next.device, tx, false, next.bytes) ==
                BluetoothGatt.GATT_SUCCESS
          } else {
            @Suppress("DEPRECATION")
            run {
              tx.value = next.bytes
              server.notifyCharacteristicChanged(next.device, tx, false)
            }
          }
        } catch (e: Exception) {
          Log.e(TAG, "notifyCharacteristicChanged threw", e)
          false
        }

    if (!ok) {
      // The stack refused it outright, so onNotificationSent will never fire for this one.
      Log.w(TAG, "notify rejected for " + next.device.address)
      emitError("Notification to " + next.device.address + " was rejected by the BLE stack")
      synchronized(notifyLock) { notifyInFlight = false }
      pumpNotifications()
    }
  }

  // ---- GATT server callbacks ---------------------------------------------

  private val gattServerCallback =
      object : BluetoothGattServerCallback() {

        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
          if (status != BluetoothGatt.GATT_SUCCESS) {
            resolveStart(false, "addService failed with status " + status)
            return
          }
          Log.i(TAG, "GATT service added, starting advertising")
          startAdvertising()
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
          val address = device.address
          if (newState == BluetoothProfile.STATE_CONNECTED) {
            connectedCentrals[address] = device
            centralMtu[address] = 23
            Log.i(TAG, "central connected: " + address)
            val map = Arguments.createMap()
            map.putString("centralId", address)
            emit(EVENT_CENTRAL_CONNECTED, map)
          } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            connectedCentrals.remove(address)
            centralMtu.remove(address)
            subscribed.remove(address)
            synchronized(notifyLock) {
              // Drop anything still queued for a central that has gone away.
              val remaining = notifyQueue.filter { it.device.address != address }
              notifyQueue.clear()
              notifyQueue.addAll(remaining)
              // A notification in flight to the departed device will never complete.
              if (notifyInFlight) {
                notifyInFlight = false
              }
            }
            Log.i(TAG, "central disconnected: " + address + " (status " + status + ")")
            val map = Arguments.createMap()
            map.putString("centralId", address)
            map.putInt("status", status)
            emit(EVENT_CENTRAL_DISCONNECTED, map)
            pumpNotifications()
          }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
          centralMtu[device.address] = mtu
          Log.i(TAG, "MTU for " + device.address + ": " + mtu)
          val map = Arguments.createMap()
          map.putString("centralId", device.address)
          map.putInt("mtu", mtu)
          emit(EVENT_MTU, map)
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
          if (characteristic.uuid == rxCharacteristic?.uuid && value != null) {
            val map = Arguments.createMap()
            map.putString("centralId", device.address)
            map.putString("data", Base64.encodeToString(value, Base64.NO_WRAP))
            emit(EVENT_DATA, map)
          }
          if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
          }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
          if (descriptor.uuid == UUID.fromString(CCCD_UUID)) {
            val enabled = value != null && value.size >= 2 && (value[0].toInt() and 0x01) != 0
            subscribed[device.address] = enabled
            Log.i(
                TAG,
                "notifications " +
                    (if (enabled) "enabled" else "disabled") +
                    " by " +
                    device.address,
            )
            val map = Arguments.createMap()
            map.putString("centralId", device.address)
            map.putBoolean("enabled", enabled)
            emit(EVENT_SUBSCRIPTION, map)
          }
          if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
          }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor,
        ) {
          val enabled = subscribed[device.address] == true
          val value =
              if (enabled) {
                BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
              } else {
                BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
              }
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic,
        ) {
          // TX is notification driven. A read returns empty rather than an error.
          gattServer?.sendResponse(
              device,
              requestId,
              BluetoothGatt.GATT_SUCCESS,
              offset,
              ByteArray(0),
          )
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
          if (status != BluetoothGatt.GATT_SUCCESS) {
            Log.w(TAG, "notification to " + device.address + " failed with status " + status)
            emitError("Notification to " + device.address + " failed (status " + status + ")")
          }
          synchronized(notifyLock) { notifyInFlight = false }
          pumpNotifications()
        }
      }

  override fun invalidate() {
    stopInternal()
    super.invalidate()
  }
}
