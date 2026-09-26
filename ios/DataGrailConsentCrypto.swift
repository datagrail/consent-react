import Foundation
import React

/// React Native bridge for the Universal Consent native crypto primitives.
///
/// The whole hash is computed natively rather than exposing normalization to JS, for two reasons.
/// First, the identifier must be NFC-normalized, and Hermes does not reliably provide
/// `String.prototype.normalize` (it depends on how the app's Intl support is configured), so
/// normalizing in JS would work on some apps and silently produce a different hash on others.
/// Second, the hash is a cross-SDK contract: the same person must produce the same 64-char hex
/// from web, iOS, Android, React Native, and the customer's backend. Keeping the entire
/// derivation on the same Foundation/CryptoKit path the iOS SDK uses means this wrapper cannot
/// drift from it. A hash computed differently splits one user across two consent records and
/// their consent stops following them.
///
/// The actual hashing lives in the React-free `DataGrailConsentCryptoCore`, which this class
/// delegates to, so the cross-SDK golden vectors can be asserted by `swift test` with no React
/// context and the shipped code stays identical to the tested code.
@objc(DataGrailConsentCrypto)
class DataGrailConsentCrypto: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Thrown when the identifier is empty after normalization. Kept as a member alias so callers
  /// and existing tests can refer to `DataGrailConsentCrypto.CryptoError`.
  typealias CryptoError = DataGrailConsentCryptoCore.CryptoError

  /// Pure `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as lowercase hex.
  /// Delegates to `DataGrailConsentCryptoCore` — see there for the normalization contract.
  ///
  /// - Throws: `CryptoError.emptyIdentifier` when the identifier is empty after normalization.
  static func computeUserHash(
    customerId: String,
    projectId: String,
    identifier: String
  ) throws -> String {
    return try DataGrailConsentCryptoCore.computeUserHash(
      customerId: customerId,
      projectId: projectId,
      identifier: identifier
    )
  }

  /// Bare `SHA-256(UTF-8(input))` as lowercase hex — NO normalization, unlike `computeUserHash`.
  /// Delegates to `DataGrailConsentCryptoCore`.
  static func sha256Hex(_ input: String) -> String {
    return DataGrailConsentCryptoCore.sha256Hex(input)
  }

  @objc
  func sha256Hex(
    _ input: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DataGrailConsentCrypto.sha256Hex(input))
  }

  @objc
  func computeUserHash(
    _ customerId: String,
    projectId: String,
    identifier: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      resolve(
        try DataGrailConsentCrypto.computeUserHash(
          customerId: customerId,
          projectId: projectId,
          identifier: identifier
        )
      )
    } catch {
      reject(
        "INVALID_IDENTIFIER",
        "identifier must not be empty after normalization",
        nil
      )
    }
  }
}
