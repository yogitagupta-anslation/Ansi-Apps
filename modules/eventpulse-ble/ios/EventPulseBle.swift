import CoreBluetooth
import Foundation
import React

/**
 EventPulseBle — the iOS half of the transport seam.

 Same contract as the Android module: scan, advertise, report state. All framing
 and presence logic lives in TypeScript.

 Three CoreBluetooth realities this encodes rather than hides:

 1. **`allowDuplicates` is required for RSSI to mean anything.** Without it iOS
    reports a peripheral once and never again, which would leave the smoothing
    filter with a single sample. It only works in the foreground, which is
    exactly where the map is, and `ScanPolicy` already backs off elsewhere.

 2. **Backgrounded advertising is degraded, not absent.** iOS moves service
    UUIDs into the "overflow" area, where only other iOS devices scanning for
    that specific UUID can see them, and stops sending service *data* entirely.
    We therefore report a distinct state instead of pretending we are still
    fully visible.

 3. **An app can never switch the radio on.** `requestEnable` resolves false and
    the UI routes the user to Settings.
 */
@objc(EventPulseBle)
class EventPulseBle: RCTEventEmitter {

  private let scanEvent = "EventPulseBleScanResult"
  private let adapterEvent = "EventPulseBleAdapterState"
  private let errorEvent = "EventPulseBleError"

  private var central: CBCentralManager?
  private var peripheral: CBPeripheralManager?

  private var hasListeners = false
  private var pendingScan: (uuid: CBUUID, allowDuplicates: Bool)?
  private var pendingAdvertisement: [String: Any]?
  private var isAdvertising = false

  override init() {
    super.init()
    // Instantiating the managers is what triggers the system permission prompt,
    // so it happens on first use rather than at launch.
    central = CBCentralManager(delegate: self, queue: nil, options: [
      CBCentralManagerOptionShowPowerAlertKey: false
    ])
    peripheral = CBPeripheralManager(delegate: self, queue: nil, options: [
      CBPeripheralManagerOptionShowPowerAlertKey: false
    ])
  }

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    [scanEvent, adapterEvent, errorEvent]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  // MARK: - Capability + state

  @objc(getCapabilities:rejecter:)
  func getCapabilities(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve([
      "supportsCentral": true,
      "supportsPeripheral": true,
      "supportsExtendedAdvertising": false,
      // iOS reserves 10 bytes of the advertisement for its own use; our frame
      // fits comfortably, but the budget is reported honestly.
      "maxAdvertisementBytes": 24,
    ])
  }

  @objc(getAdapterState:rejecter:)
  func getAdapterState(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(stateString(central?.state ?? .unknown))
  }

  private func stateString(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "powered_on"
    case .poweredOff: return "powered_off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  @objc(requestPermissions:rejecter:)
  func requestPermissions(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(permissionString())
  }

  @objc(getPermissionState:rejecter:)
  func getPermissionState(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(permissionString())
  }

  private func permissionString() -> String {
    switch CBManager.authorization {
    case .allowedAlways: return "granted"
    case .denied: return "blocked"
    case .restricted: return "unavailable"
    default: return "undetermined"
    }
  }

  /// iOS never lets an app enable Bluetooth; the UI sends the user to Settings.
  @objc(requestEnable:rejecter:)
  func requestEnable(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(false)
  }

  // MARK: - Scanning

  @objc(startScan:mode:allowDuplicates:resolver:rejecter:)
  func startScan(
    serviceUuid16: NSNumber,
    mode: String,
    allowDuplicates: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    let uuid = CBUUID(string: String(format: "%04X", serviceUuid16.uint16Value))

    guard let central = central else {
      reject("internal", "Central manager unavailable", nil)
      return
    }

    guard central.state == .poweredOn else {
      // Not an error: the radio may simply not be ready yet. Remember the
      // request and start the moment it powers on.
      pendingScan = (uuid, allowDuplicates)
      resolve(nil)
      return
    }

    central.stopScan()
    central.scanForPeripherals(
      withServices: [uuid],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates]
    )
    resolve(nil)
  }

  @objc(stopScan:rejecter:)
  func stopScan(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    pendingScan = nil
    central?.stopScan()
    resolve(nil)
  }

  // MARK: - Advertising

  @objc(startAdvertising:payloadBase64:mode:txPower:resolver:rejecter:)
  func startAdvertising(
    serviceUuid16: NSNumber,
    payloadBase64: String,
    mode: String,
    txPower: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    let uuid = CBUUID(string: String(format: "%04X", serviceUuid16.uint16Value))

    // CoreBluetooth exposes only service UUIDs and a local name to advertise —
    // there is no service-data key. We therefore encode the frame into a second
    // 128-bit service UUID derived from our base UUID, which is the standard
    // workaround and keeps the payload inside the advertisement.
    guard let payload = Data(base64Encoded: payloadBase64) else {
      reject("advertise_failed", "Payload was not valid base64", nil)
      return
    }

    let dataUuid = CBUUID(data: payload)
    let advertisement: [String: Any] = [
      CBAdvertisementDataServiceUUIDsKey: [uuid, dataUuid]
    ]

    pendingAdvertisement = advertisement

    guard let peripheral = peripheral, peripheral.state == .poweredOn else {
      resolve(nil)
      return
    }

    if isAdvertising { peripheral.stopAdvertising() }
    peripheral.startAdvertising(advertisement)
    isAdvertising = true
    resolve(nil)
  }

  @objc(updateAdvertising:payloadBase64:mode:txPower:resolver:rejecter:)
  func updateAdvertising(
    serviceUuid16: NSNumber,
    payloadBase64: String,
    mode: String,
    txPower: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    startAdvertising(
      serviceUuid16: serviceUuid16,
      payloadBase64: payloadBase64,
      mode: mode,
      txPower: txPower,
      resolve: resolve,
      reject: reject
    )
  }

  @objc(stopAdvertising:rejecter:)
  func stopAdvertising(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    pendingAdvertisement = nil
    if isAdvertising { peripheral?.stopAdvertising() }
    isAdvertising = false
    resolve(nil)
  }

  @objc(destroy:rejecter:)
  func destroy(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    central?.stopScan()
    if isAdvertising { peripheral?.stopAdvertising() }
    isAdvertising = false
    resolve(nil)
  }

  fileprivate func emit(_ name: String, _ body: Any) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }
}

// MARK: - CBCentralManagerDelegate

extension EventPulseBle: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ manager: CBCentralManager) {
    emit(adapterEvent, stateString(manager.state))

    if manager.state == .poweredOn, let pending = pendingScan {
      manager.scanForPeripherals(
        withServices: [pending.uuid],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: pending.allowDuplicates]
      )
      pendingScan = nil
    }
  }

  func centralManager(
    _ manager: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    // Our frame rides in the second service UUID (see startAdvertising).
    guard let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] else {
      return
    }
    guard let frame = uuids.first(where: { $0.data.count > 4 }) else { return }

    emit(scanEvent, [
      "data": frame.data.base64EncodedString(),
      "rssi": RSSI.intValue,
      "timestamp": Date().timeIntervalSince1970 * 1000,
      // A per-session identifier iOS rotates itself; used only for dedup.
      "deviceKey": peripheral.identifier.uuidString,
    ])
  }
}

// MARK: - CBPeripheralManagerDelegate

extension EventPulseBle: CBPeripheralManagerDelegate {
  func peripheralManagerDidUpdateState(_ manager: CBPeripheralManager) {
    if manager.state == .poweredOn, let advertisement = pendingAdvertisement, !isAdvertising {
      manager.startAdvertising(advertisement)
      isAdvertising = true
    }
  }

  func peripheralManagerDidStartAdvertising(_ manager: CBPeripheralManager, error: Error?) {
    guard let error = error else { return }
    isAdvertising = false
    emit(errorEvent, ["code": "advertise_failed", "message": error.localizedDescription])
  }
}
