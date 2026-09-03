#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

/**
 * Bridge declarations for the Swift implementation.
 *
 * Kept in sync by hand with EventPulseBle.swift; the TypeScript side
 * (NativeBleTransport) is the contract both halves answer to.
 */
@interface RCT_EXTERN_MODULE (EventPulseBle, RCTEventEmitter)

RCT_EXTERN_METHOD(getCapabilities
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAdapterState
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermissions
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getPermissionState
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestEnable
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startScan
                  : (nonnull NSNumber *)serviceUuid16 mode
                  : (NSString *)mode allowDuplicates
                  : (BOOL)allowDuplicates resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopScan
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startAdvertising
                  : (nonnull NSNumber *)serviceUuid16 payloadBase64
                  : (NSString *)payloadBase64 mode
                  : (NSString *)mode txPower
                  : (NSString *)txPower resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateAdvertising
                  : (nonnull NSNumber *)serviceUuid16 payloadBase64
                  : (NSString *)payloadBase64 mode
                  : (NSString *)mode txPower
                  : (NSString *)txPower resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopAdvertising
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(destroy
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
