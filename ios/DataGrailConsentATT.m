#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DataGrailConsentATT, NSObject)

RCT_EXTERN_METHOD(requestTrackingAuthorization:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getTrackingStatusSync)

@end
