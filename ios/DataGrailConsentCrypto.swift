import Foundation
import CryptoKit
import React

/// Computes the Universal Consent user hash natively.
///
/// The whole hash is computed here rather than exposing a bare SHA-256 primitive to JS, for two
/// reasons. First, the identifier must be NFC-normalized, and Hermes does not reliably provide
/// `String.prototype.normalize` (it depends on how the app's Intl support is configured), so
/// normalizing in JS would work on some apps and silently produce a different hash on others.
/// Second, the hash is a cross-SDK contract: the same person must produce the same 64-char hex
/// from web, iOS, Android, React Native, and the customer's backend. Keeping the entire
/// derivation on the same Foundation/CryptoKit path the iOS SDK uses means this wrapper cannot
/// drift from it. A hash computed differently splits one user across two consent records and
/// their consent stops following them.
@objc(DataGrailConsentCrypto)
class DataGrailConsentCrypto: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Thrown when the identifier is empty after normalization.
  enum CryptoError: Error, Equatable {
    case emptyIdentifier
  }

  /// Pure `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as lowercase hex.
  ///
  /// Normalization is Unicode NFC → trim → lowercase, in that order. This is the canonical
  /// contract (TRUST-1843) shared by every SDK — do not deviate. Extracted from the bridge method
  /// so the cross-SDK golden vector can be asserted by an XCTest with no React context — the one
  /// invariant whose violation is silent (it splits a user across two consent records).
  ///
  /// - Throws: `CryptoError.emptyIdentifier` when the identifier is empty after normalization.
  static func computeUserHash(
    customerId: String,
    projectId: String,
    identifier: String
  ) throws -> String {
    // `precomposedStringWithCanonicalMapping` is NFC. Lowercasing is pinned to the POSIX locale
    // so a Turkish-locale device does not map "I" to the dotless "ı" and hash the same
    // identifier differently than every other device.
    let normalized = identifier
      .precomposedStringWithCanonicalMapping
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased(with: Locale(identifier: "en_US_POSIX"))

    // Reject an identifier that is empty AFTER normalizing. SHA-256 over a bare
    // "{customerId}:{projectId}:" prefix is a valid-looking hash that every empty-or-whitespace
    // caller in the tenant shares, collapsing unrelated users onto one consent record. Checking
    // the raw string is not enough — "   " trims away to nothing.
    if normalized.isEmpty {
      throw CryptoError.emptyIdentifier
    }

    let input = "\(customerId):\(projectId):\(normalized)"
    let digest = SHA256.hash(data: Data(input.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
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
