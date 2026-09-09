package com.blechat.bleclient

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The BLE CENTRAL role, driven directly against the Android framework.
 *
 * The app already had a central, through react-native-ble-plx. Everything on a link it
 * opens works — connection, MTU exchange, service discovery, the CCCD write that turns
 * notifications on — except the one operation the handshake needs: a characteristic
 * write, which comes back refused in zero milliseconds, before any radio traffic, and
 * keeps coming back refused. A session spent ruling things out above that line (the
 * simultaneous dial, a race with the CCCD write, the scan restarting, a stale
 * characteristic handle, the characteristic's declared properties, and the library's own
 * pinned RxAndroidBle version) left nothing above it to blame.
 *
 * So this owns the connection instead of borrowing one. Two things that buys:
 *
 *  - `BluetoothGatt.writeCharacteristic` returns a REASON on Android 13 and later. The
 *    library calls the pre-33 overload, which returns a bare false and throws away why.
 *    Here the status is reported to JavaScript as a number, so a refusal can finally be
 *    read rather than guessed at.
 *  - One operation at a time, enforced by us. Android permits exactly one outstanding
 *    GATT operation per connection and clears the flag from the completion callback;
 *    the queue below never issues the next operation until the previous one's callback
 *    has landed, which is the discipline the framework actually requires.
 *
 * Nothing here simulates or substitutes for the radio. Every call is a real framework
 * call and every result is what the framework returned.
 */
class BleClientModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BleClient"

  private val adapter: BluetoothAdapter?
    get() =
        (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  /** Live connections, by device address. */
  private val links = ConcurrentHashMap<String, Link>()

  private class Link(
      val address: String,
      var gatt: BluetoothGatt? = null,
      var rx: BluetoothGattCharacteristic? = null,
      var tx: BluetoothGattCharacteristic? = null,
      var mtu: Int = DEFAULT_MTU,
      /** Resolved when the link is ready to carry application data. */
      var connectPromise: Promise? = null,
      /** The operation currently outstanding on this connection, if any. */
      var pending: Pending? = null,
      val queue: ArrayDeque<Pending> = ArrayDeque(),
  )

  private class Pending(
      val kind: String,
      val promise: Promise?,
      val run: () -> Boolean,
  )

  // ---- lifecycle --------------------------------------------------------

  /**
   * Open a link and get it ready to carry data.
   *
   * Resolves only once services are discovered, the MTU is settled and notifications are
   * subscribed — the same bar the previous implementation used, so the JavaScript above
   * cannot tell the difference except by it working.
   */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connect(address: String, serviceUuid: String, rxUuid: String, txUuid: String, promise: Promise) {
    val adapter = adapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("bluetooth_off", "Bluetooth is not on")
      return
    }
    if (links.containsKey(address)) {
      promise.reject("already_connected", "Already connected to $address")
      return
    }

    val device: BluetoothDevice =
        try {
          adapter.getRemoteDevice(address)
        } catch (e: IllegalArgumentException) {
          promise.reject("bad_address", "Not a Bluetooth address: $address", e)
          return
        }

    val link = Link(address)
    link.connectPromise = promise
    links[address] = link

    val callback = GattCallback(address, UUID.fromString(serviceUuid), UUID.fromString(rxUuid), UUID.fromString(txUuid))
    link.gatt =
        device.connectGatt(reactContext, false, callback, BluetoothDevice.TRANSPORT_LE)
    if (link.gatt == null) {
      links.remove(address)
      promise.reject("connect_failed", "connectGatt returned nothing")
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun disconnect(address: String, promise: Promise) {
    val link = links.remove(address)
    if (link == null) {
      promise.resolve(false)
      return
    }
    try {
      link.gatt?.disconnect()
      link.gatt?.close()
    } catch (e: Exception) {
      Log.w(TAG, "disconnect of $address failed", e)
    }
    failPending(link, "disconnected", "The link went away")
    promise.resolve(true)
  }

  // ---- writing ----------------------------------------------------------

  /**
   * Write one frame to the peer's RX characteristic.
   *
   * The promise rejects with the framework's own status rather than a word: on Android 13
   * and later `writeCharacteristic` returns a documented code, and on older releases a
   * bare boolean, and both are reported as-is. A refusal that used to arrive as
   * "Operation was rejected" now arrives with the number that explains it.
   */
  @SuppressLint("MissingPermission")
  @ReactMethod
  fun write(address: String, base64: String, withResponse: Boolean, promise: Promise) {
    val link = links[address]
    if (link == null) {
      promise.reject("no_link", "No link to $address")
      return
    }
    val rx = link.rx
    val gatt = link.gatt
    if (rx == null || gatt == null) {
      promise.reject("not_ready", "The link to $address has no RX characteristic")
      return
    }

    val value =
        try {
          Base64.decode(base64, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
          promise.reject("bad_payload", "Frame was not valid base64", e)
          return
        }

    val writeType =
        if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE

    enqueue(
        link,
        Pending("write", promise) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val status = gatt.writeCharacteristic(rx, value, writeType)
            if (status != BluetoothGatt.GATT_SUCCESS) {
              promise.reject(
                  "write_refused",
                  "The Bluetooth stack refused the write (status $status: ${writeStatusName(status)})",
              )
              false
            } else {
              true
            }
          } else {
            @Suppress("DEPRECATION")
            rx.writeType = writeType
            @Suppress("DEPRECATION")
            rx.value = value
            @Suppress("DEPRECATION")
            val started = gatt.writeCharacteristic(rx)
            if (!started) {
              promise.reject("write_refused", "The Bluetooth stack refused the write")
              false
            } else {
              true
            }
          }
        },
    )
  }

  /** What the link settled on, for diagnostics that would otherwise be guesswork. */
  @ReactMethod
  fun linkInfo(address: String, promise: Promise) {
    val link = links[address]
    if (link == null) {
      promise.resolve(null)
      return
    }
    val map = Arguments.createMap()
    map.putInt("mtu", link.mtu)
    map.putBoolean("rxFound", link.rx != null)
    map.putBoolean("txFound", link.tx != null)
    map.putInt("rxProperties", link.rx?.properties ?: 0)
    map.putBoolean("queueIdle", link.pending == null && link.queue.isEmpty())
    promise.resolve(map)
  }

  // ---- one operation at a time -----------------------------------------

  /**
   * Android permits exactly one outstanding GATT operation per connection, and clears
   * that flag inside the previous operation's completion callback. Issuing the next one
   * any earlier is refused outright — which is what a back-to-back write looks like, and
   * how the fragments of a single message are sent.
   */
  private fun enqueue(link: Link, op: Pending) {
    synchronized(link) {
      link.queue.addLast(op)
      if (link.pending == null) {
        pump(link)
      }
    }
  }

  private fun pump(link: Link) {
    synchronized(link) {
      if (link.pending != null) {
        return
      }
      val next = link.queue.removeFirstOrNull() ?: return
      link.pending = next
      val started =
          try {
            next.run()
          } catch (e: Exception) {
            next.promise?.reject("operation_threw", e.message ?: e.toString(), e)
            false
          }
      if (!started) {
        // `run` has already rejected; move on rather than waiting for a callback that
        // will never come.
        link.pending = null
        pump(link)
      }
    }
  }

  private fun settle(link: Link, ok: Boolean, status: Int) {
    synchronized(link) {
      val done = link.pending
      link.pending = null
      if (done?.promise != null) {
        if (ok) {
          done.promise.resolve(true)
        } else {
          done.promise.reject(
              "operation_failed",
              "${done.kind} failed (status $status: ${writeStatusName(status)})",
          )
        }
      }
      pump(link)
    }
  }

  private fun failPending(link: Link, code: String, message: String) {
    synchronized(link) {
      link.pending?.promise?.reject(code, message)
      link.pending = null
      while (true) {
        val queued = link.queue.removeFirstOrNull() ?: break
        queued.promise?.reject(code, message)
      }
    }
  }

  // ---- the framework's side --------------------------------------------

  private inner class GattCallback(
      private val address: String,
      private val serviceUuid: UUID,
      private val rxUuid: UUID,
      private val txUuid: UUID,
  ) : BluetoothGattCallback() {

    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val link = links[address] ?: return
      if (newState == BluetoothGatt.STATE_CONNECTED) {
        Log.i(TAG, "$address connected (status $status); requesting MTU")
        if (!gatt.requestMtu(REQUESTED_MTU)) {
          // Not fatal: carry on at the default and let discovery proceed.
          gatt.discoverServices()
        }
        return
      }
      if (newState == BluetoothGatt.STATE_DISCONNECTED) {
        Log.i(TAG, "$address disconnected (status $status)")
        links.remove(address)
        failPending(link, "disconnected", "The link went away (status $status)")
        link.connectPromise?.reject(
            "disconnected",
            "Disconnected before the link was ready (status $status)",
        )
        link.connectPromise = null
        try {
          gatt.close()
        } catch (e: Exception) {
          Log.w(TAG, "close of $address failed", e)
        }
        val params = Arguments.createMap()
        params.putString("address", address)
        params.putInt("status", status)
        emit("bleClientDisconnected", params)
      }
    }

    @SuppressLint("MissingPermission")
    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      links[address]?.mtu = if (status == BluetoothGatt.GATT_SUCCESS) mtu else DEFAULT_MTU
      gatt.discoverServices()
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val link = links[address] ?: return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        link.connectPromise?.reject("discovery_failed", "Service discovery failed ($status)")
        link.connectPromise = null
        return
      }
      val service = gatt.getService(serviceUuid)
      if (service == null) {
        link.connectPromise?.reject("service_missing", "The peer is not running this service")
        link.connectPromise = null
        return
      }
      link.rx = service.getCharacteristic(rxUuid)
      link.tx = service.getCharacteristic(txUuid)
      if (link.rx == null || link.tx == null) {
        link.connectPromise?.reject(
            "characteristics_missing",
            "The peer's service is missing RX or TX",
        )
        link.connectPromise = null
        return
      }

      // Subscribe, then wait for the descriptor write to complete before calling the
      // link ready — the first application write follows immediately, and issuing it
      // while this one is outstanding is exactly what the framework refuses.
      val tx = link.tx!!
      gatt.setCharacteristicNotification(tx, true)
      val cccd = tx.getDescriptor(CCCD)
      if (cccd == null) {
        // Nothing to write; the local flag is all this peer offers.
        ready(link)
        return
      }
      enqueue(
          link,
          Pending("subscribe", null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ==
                  BluetoothGatt.GATT_SUCCESS
            } else {
              @Suppress("DEPRECATION")
              cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
              @Suppress("DEPRECATION")
              gatt.writeDescriptor(cccd)
            }
          },
      )
    }

    override fun onDescriptorWrite(
        gatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        status: Int,
    ) {
      val link = links[address] ?: return
      settle(link, status == BluetoothGatt.GATT_SUCCESS, status)
      if (descriptor.uuid == CCCD) {
        ready(link)
      }
    }

    override fun onCharacteristicWrite(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
    ) {
      val link = links[address] ?: return
      settle(link, status == BluetoothGatt.GATT_SUCCESS, status)
    }

    /** Android 13+ delivers the value with the callback. */
    override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
    ) {
      deliver(characteristic, value)
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
    ) {
      deliver(characteristic, characteristic.value ?: ByteArray(0))
    }

    private fun deliver(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid != txUuid) {
        return
      }
      val params = Arguments.createMap()
      params.putString("address", address)
      params.putString("base64", Base64.encodeToString(value, Base64.NO_WRAP))
      emit("bleClientData", params)
    }

    private fun ready(link: Link) {
      val promise = link.connectPromise ?: return
      link.connectPromise = null
      val map = Arguments.createMap()
      map.putString("address", address)
      map.putInt("mtu", link.mtu)
      map.putInt("rxProperties", link.rx?.properties ?: 0)
      promise.resolve(map)
    }
  }

  private fun emit(event: String, params: WritableMap?) {
    try {
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, params)
    } catch (e: Exception) {
      Log.w(TAG, "emit failed for $event", e)
    }
  }

  companion object {
    private const val TAG = "BleClient"
    private const val DEFAULT_MTU = 23
    private const val REQUESTED_MTU = 517
    private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /**
     * The framework's write statuses in words.
     *
     * The whole reason this module exists is that a refusal used to arrive as a bare
     * false. Naming the codes is what turns the next failure into a fact.
     */
    fun writeStatusName(status: Int): String =
        when (status) {
          BluetoothGatt.GATT_SUCCESS -> "success"
          BluetoothGatt.GATT_READ_NOT_PERMITTED -> "read not permitted"
          BluetoothGatt.GATT_WRITE_NOT_PERMITTED -> "write not permitted"
          BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION -> "insufficient authentication"
          BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED -> "request not supported"
          BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION -> "insufficient encryption"
          BluetoothGatt.GATT_INVALID_OFFSET -> "invalid offset"
          BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH -> "invalid attribute length"
          BluetoothGatt.GATT_CONNECTION_CONGESTED -> "connection congested"
          BluetoothGatt.GATT_FAILURE -> "generic failure"
          201 -> "device busy"
          else -> "unknown"
        }
  }
}
