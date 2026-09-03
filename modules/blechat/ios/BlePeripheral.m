#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

//
// Objective-C bridge declarations for BlePeripheral.swift.
// Method signatures must match the @objc selectors on the Swift class exactly.
//
@interface RCT_EXTERN_MODULE (BlePeripheral, RCTEventEmitter)

RCT_EXTERN_METHOD(getCapabilities
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(start
                  : (NSString *)serviceUuid rxUuid
                  : (NSString *)rxUuid txUuid
                  : (NSString *)txUuid peerIdPrefix
                  : (NSString *)peerIdPrefix displayName
                  : (NSString *)displayName interestMask
                  : (nonnull NSNumber *)interestMask resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(send
                  : (NSString *)centralId data
                  : (NSString *)data resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
