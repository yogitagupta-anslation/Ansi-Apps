import Foundation
import CoreBluetooth
import React

/**
 BLE PERIPHERAL role for iOS.

 react-native-ble-plx wraps CBCentralManager only, so it cannot advertise or host a GATT
 service. This module wraps CBPeripheralManager to provide the other half, mirroring the
 Android BlePeripheralModule API exactly so the JavaScript transport is platform agnostic.

 iOS specifics that differ from Android and are NOT worked around here, because they
 cannot be:

 - CBPeripheralManager.startAdvertising accepts only CBAdvertisementDataLocalNameKey and
   CBAdvertisementDataServiceUUIDsKey. Custom manufacturer data is impossible, so the
   peer id prefix and the interest bitmask are carried in the local name instead
   ("BC-<16 hex peer id><6 hex interest mask>").
 - While the app is backgrounded, iOS moves the service UUID into a special "overflow"
   advertising area that is only readable by other iOS devices running a matching app.
   An Android central cannot discover a backgrounded iOS peripheral.
 - The maximum notification payload is dictated by the central via
   maximumUpdateValueLength; there is no MTU negotiation API on the peripheral side.
 */
@objc(BlePeripheral)
class BlePeripheral: RCTEventEmitter, CBPeripheralManagerDelegate {

  private static let EVENT_STATE = "BlePeripheral:state"
  private static let EVENT_CENTRAL_CONNECTED = "BlePeripheral:centralConnected"
  private static let EVENT_CENTRAL_DISCONNECTED = "BlePeripheral:centralDisconnected"
  private static let EVENT_DATA = "BlePeripheral:data"
  private static let EVENT_SUBSCRIPTION = "BlePeripheral:subscription"
  private static let EVENT_MTU = "BlePeripheral:mtu"
  private static let EVENT_ERROR = "BlePeripheral:error"

  private var manager: CBPeripheralManager?
  private var service: CBMutableService?
  private var rxCharacteristic: CBMutableCharacteristic?
  private var txCharacteristic: CBMutableCharacteristic?

  private var serviceUUID: CBUUID?
  private var rxUUID: CBUUID?
  private var txUUID: CBUUID?
  private var localName: String = ""

  private var startResolve: RCTPromiseResolveBlock?
  private var startReject: RCTPromiseRejectBlock?
  private var wantsAdvertising = false
  private var isAdvertising = false

  /// central identifier -> subscribed central object
  private var centrals: [String: CBCentral] = [:]

  /// Queue of frames still to notify, plus the id of their destination central.
  private var sendQueue: [(centralId: String, data: Data)] = []
  private let queueLock = NSLock()

  private var hasListeners = false

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { return false }

  override func supportedEvents() -> [String] {
    return [
      BlePeripheral.EVENT_STATE,
      BlePeripheral.EVENT_CENTRAL_CONNECTED,
      BlePeripheral.EVENT_CENTRAL_DISCONNECTED,
      BlePeripheral.EVENT_DATA,
      BlePeripheral.EVENT_SUBSCRIPTION,
      BlePeripheral.EVENT_MTU,
      BlePeripheral.EVENT_ERROR,
    ]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ event: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: event, body: body)
  }

  private func emitError(_ message: String) {
    emit(BlePeripheral.EVENT_ERROR, ["message": message])
  }

  // MARK: - Capabilities

  @objc(getCapabilities:rejecter:)
  func getCapabilities(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let state = manager?.state ?? .unknown
    resolve([
      "hasBluetooth": state != .unsupported,
      "bluetoothEnabled": state == .poweredOn,
      // Every iOS device that supports BLE at all supports the peripheral role.
      "supportsMultipleAdvertisement": true,
      "hasAdvertiser": state != .unsupported,
      "isAdvertising": isAdvertising,
      "sdkInt": 0,
      "missingPermissions": [String](),
    ])
  }

  // MARK: - Lifecycle

  @objc(start:rxUuid:txUuid:peerIdPrefix:displayName:interestMask:resolver:rejecter:)
  func start(
    _ serviceUuidStr: String,
    rxUuid rxUuidStr: String,
    txUuid txUuidStr: String,
    peerIdPrefix: String,
    displayName: String,
    interestMask: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    serviceUUID = CBUUID(string: serviceUuidStr)
    rxUUID = CBUUID(string: rxUuidStr)
    txUUID = CBUUID(string: txUuidStr)

    // iOS has no manufacturer-data slot, so everything we can say has to ride in the
    // local name. The whole advertisement is 31 bytes, so the display name is dropped —
    // it arrives in the HELLO handshake anyway — and the space goes to the two things
    // that are only useful BEFORE connecting: who this is, and what they are into.
    //
    //   BC-<16 hex peer id prefix><6 hex interest bitmask>
    //
    // The bitmask is appended rather than inserted so a scanner on an older build still
    // matches the 16-hex prefix and simply ignores the tail.
    let mask = UInt32(truncating: interestMask) & 0xFF_FFFF
    localName = "BC-" + peerIdPrefix + String(format: "%06x", mask)

    startResolve = resolve
    startReject = reject
    wantsAdvertising = true

    if manager == nil {
      // Not restoring state: background peripheral restoration is a Phase 5 concern.
      manager = CBPeripheralManager(delegate: self, queue: nil, options: nil)
      // peripheralManagerDidUpdateState will drive the rest once powered on.
      return
    }

    if manager?.state == .poweredOn {
      configureAndAdvertise()
    }
    // Otherwise the delegate callback will pick it up.
  }

  /**
   * Rewrites the advertised local name in place.
   *
   * CoreBluetooth allows a running peripheral manager to re-advertise without touching
   * its services, so unlike stop/start this leaves connected centrals alone -- which is
   * the whole point: a room's occupancy changes every time somebody joins, and dropping
   * the link to announce that would be absurd.
   *
   * startResolve is deliberately left alone; a refresh that fails leaves a stale scan
   * entry, not a broken room.
   */
  @objc(updateAdvertisement:displayName:interestMask:resolver:rejecter:)
  func updateAdvertisement(
    _ peerIdPrefix: String,
    displayName: String,
    interestMask: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let manager = manager, let serviceUUID = serviceUUID else {
      reject("E_NOT_ADVERTISING", "Not advertising; call start first", nil)
      return
    }

    let mask = UInt32(truncating: interestMask) & 0xFF_FFFF
    localName = "BC-" + peerIdPrefix + String(format: "%06x", mask)

    guard manager.state == .poweredOn else {
      reject("E_BT_OFF", "Bluetooth is not powered on", nil)
      return
    }

    if isAdvertising {
      manager.stopAdvertising()
      isAdvertising = false
    }
    manager.startAdvertising([
      CBAdvertisementDataLocalNameKey: localName,
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
    ])
    resolve(["advertising": true])
  }

  @objc(stop:rejecter:)
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    wantsAdvertising = false
    if isAdvertising {
      manager?.stopAdvertising()
      isAdvertising = false
    }
    manager?.removeAllServices()
    centrals.removeAll()
    queueLock.lock()
    sendQueue.removeAll()
    queueLock.unlock()
    emit(BlePeripheral.EVENT_STATE, ["advertising": false])
    resolve(true)
  }

  private func configureAndAdvertise() {
    guard let serviceUUID = serviceUUID,
          let rxUUID = rxUUID,
          let txUUID = txUUID,
          let manager = manager
    else { return }

    manager.removeAllServices()

    // Centrals write here; we receive.
    let rx = CBMutableCharacteristic(
      type: rxUUID,
      properties: [.write, .writeWithoutResponse],
      value: nil,
      permissions: [.writeable]
    )

    // We notify here; centrals receive. iOS creates the CCCD implicitly.
    let tx = CBMutableCharacteristic(
      type: txUUID,
      properties: [.notify, .read],
      value: nil,
      permissions: [.readable]
    )

    let svc = CBMutableService(type: serviceUUID, primary: true)
    svc.characteristics = [rx, tx]

    rxCharacteristic = rx
    txCharacteristic = tx
    service = svc

    manager.add(svc)
  }

  // MARK: - Sending

  @objc(send:data:resolver:rejecter:)
  func send(
    _ centralId: String,
    data base64Data: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard centrals[centralId] != nil else {
      reject("E_NO_CENTRAL", "No subscribed central with id \(centralId)", nil)
      return
    }
    guard let data = Data(base64Encoded: base64Data) else {
      reject("E_BAD_DATA", "data is not valid base64", nil)
      return
    }

    queueLock.lock()
    sendQueue.append((centralId: centralId, data: data))
    queueLock.unlock()

    drainQueue()
    resolve(true)
  }

  /**
   updateValue returns false when the transmit queue is full. iOS then calls
   peripheralManagerIsReady(toUpdateSubscribers:) once space frees up, which is where we
   resume. Ignoring that return value is the classic way to lose fragments.
   */
  private func drainQueue() {
    guard let manager = manager, let tx = txCharacteristic else { return }

    while true {
      queueLock.lock()
      guard let next = sendQueue.first else {
        queueLock.unlock()
        return
      }
      queueLock.unlock()

      guard let central = centrals[next.centralId] else {
        // Central vanished; drop its frame and continue.
        queueLock.lock()
        sendQueue.removeFirst()
        queueLock.unlock()
        continue
      }

      let ok = manager.updateValue(
        next.data,
        for: tx,
        onSubscribedCentrals: [central]
      )

      if ok {
        queueLock.lock()
        if !sendQueue.isEmpty { sendQueue.removeFirst() }
        queueLock.unlock()
      } else {
        // Back-pressure. Resume from peripheralManagerIsReady.
        return
      }
    }
  }

  // MARK: - CBPeripheralManagerDelegate

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    switch peripheral.state {
    case .poweredOn:
      if wantsAdvertising {
        configureAndAdvertise()
      }
    case .poweredOff:
      isAdvertising = false
      emit(BlePeripheral.EVENT_STATE, ["advertising": false, "error": "Bluetooth is off"])
      finishStart(ok: false, error: "Bluetooth is off")
    case .unauthorized:
      isAdvertising = false
      emit(
        BlePeripheral.EVENT_STATE,
        ["advertising": false, "error": "Bluetooth permission denied"]
      )
      finishStart(ok: false, error: "Bluetooth permission denied")
    case .unsupported:
      isAdvertising = false
      emit(
        BlePeripheral.EVENT_STATE,
        ["advertising": false, "error": "BLE unsupported on this device"]
      )
      finishStart(ok: false, error: "BLE unsupported on this device")
    default:
      break
    }
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didAdd service: CBService,
    error: Error?
  ) {
    if let error = error {
      finishStart(ok: false, error: "addService failed: \(error.localizedDescription)")
      return
    }
    guard let serviceUUID = serviceUUID else { return }
    peripheral.startAdvertising([
      CBAdvertisementDataLocalNameKey: localName,
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
    ])
  }

  func peripheralManagerDidStartAdvertising(
    _ peripheral: CBPeripheralManager,
    error: Error?
  ) {
    if let error = error {
      isAdvertising = false
      emit(
        BlePeripheral.EVENT_STATE,
        ["advertising": false, "error": error.localizedDescription]
      )
      finishStart(ok: false, error: error.localizedDescription)
      return
    }
    isAdvertising = true
    emit(BlePeripheral.EVENT_STATE, ["advertising": true])
    finishStart(ok: true, error: nil)
  }

  private func finishStart(ok: Bool, error: String?) {
    guard let resolve = startResolve, let reject = startReject else { return }
    startResolve = nil
    startReject = nil
    if ok {
      resolve(["advertising": true])
    } else {
      reject("E_ADVERTISE", error ?? "advertising failed", nil)
    }
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == txUUID else { return }
    let id = central.identifier.uuidString
    centrals[id] = central
    emit(BlePeripheral.EVENT_CENTRAL_CONNECTED, ["centralId": id])
    emit(BlePeripheral.EVENT_SUBSCRIPTION, ["centralId": id, "enabled": true])
    // maximumUpdateValueLength is the notification payload limit, i.e. MTU - 3.
    emit(
      BlePeripheral.EVENT_MTU,
      ["centralId": id, "mtu": central.maximumUpdateValueLength + 3]
    )
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == txUUID else { return }
    let id = central.identifier.uuidString
    centrals.removeValue(forKey: id)
    queueLock.lock()
    sendQueue.removeAll { $0.centralId == id }
    queueLock.unlock()
    emit(BlePeripheral.EVENT_SUBSCRIPTION, ["centralId": id, "enabled": false])
    emit(BlePeripheral.EVENT_CENTRAL_DISCONNECTED, ["centralId": id, "status": 0])
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didReceiveWrite requests: [CBATTRequest]
  ) {
    for request in requests {
      if request.characteristic.uuid == rxUUID, let value = request.value {
        emit(
          BlePeripheral.EVENT_DATA,
          [
            "centralId": request.central.identifier.uuidString,
            "data": value.base64EncodedString(),
          ]
        )
      }
    }
    // A single response covers the whole batch, per the CoreBluetooth contract.
    if let first = requests.first {
      peripheral.respond(to: first, withResult: .success)
    }
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didReceiveRead request: CBATTRequest
  ) {
    request.value = Data()
    peripheral.respond(to: request, withResult: .success)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    drainQueue()
  }
}
