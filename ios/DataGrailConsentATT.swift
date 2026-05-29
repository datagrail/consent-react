import Foundation
import AppTrackingTransparency
import React

@objc(DataGrailConsentATT)
class DataGrailConsentATT: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func requestTrackingAuthorization(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14, *) {
      ATTrackingManager.requestTrackingAuthorization { status in
        resolve(self.statusToString(status))
      }
    } else {
      // Pre-iOS 14: tracking is always authorized
      resolve("authorized")
    }
  }

  @objc
  func getTrackingStatusSync() -> String {
    if #available(iOS 14, *) {
      return statusToString(ATTrackingManager.trackingAuthorizationStatus)
    } else {
      return "authorized"
    }
  }

  @available(iOS 14, *)
  private func statusToString(_ status: ATTrackingManager.AuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
      return "notDetermined"
    case .restricted:
      return "restricted"
    case .denied:
      return "denied"
    case .authorized:
      return "authorized"
    @unknown default:
      return "notDetermined"
    }
  }
}
