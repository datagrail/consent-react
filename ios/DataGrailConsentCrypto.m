#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DataGrailConsentCrypto, NSObject)

RCT_EXTERN_METHOD(computeUserHash:(NSString *)customerId
                  projectId:(NSString *)projectId
                  identifier:(NSString *)identifier
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sha256Hex:(NSString *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
