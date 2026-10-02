import Foundation
import CryptoKit

/// Pure Universal Consent crypto primitives — Foundation + CryptoKit only, NO React.
///
/// The hashing lives here, apart from the `@objc` RN bridge (`DataGrailConsentCrypto`), for one
/// reason: these two digests are silent cross-SDK contracts. The user hash must be byte-identical
/// across web, iOS, Android, React Native, and the customer's backend, and the provenance digest
/// folded into the write signing string must match the edge verifier and every other SDK exactly.
/// A drift in normalization order, locale pinning, or hex encoding surfaces no error — it just
/// splits one user across two consent records or gets a correctly-signed write rejected.
///
/// Because this file imports no React, it compiles standalone in a SwiftPM package (`ios/Package.swift`),
/// so the golden cross-SDK vectors can be asserted by `swift test` in CI with no simulator, no
/// CocoaPods, and no React context. `DataGrailConsentCrypto` delegates to it, so the shipped code
/// and the tested code are the same code and cannot drift.
enum DataGrailConsentCryptoCore {

  /// Thrown when the identifier is empty after normalization.
  enum CryptoError: Error, Equatable {
    case emptyIdentifier
  }

  /// Pure `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as lowercase hex.
  ///
  /// Normalization is Unicode NFC → trim → lowercase, in that order. This is the canonical
  /// contract (TRUST-1843) shared by every SDK — do not deviate.
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

    return sha256Hex("\(customerId):\(projectId):\(normalized)")
  }

  /// Bare `SHA-256(UTF-8(input))` as lowercase hex — NO normalization, unlike `computeUserHash`.
  ///
  /// Reuses the same CryptoKit `SHA256` path as the user hash so the two cannot drift. Used to
  /// build the provenance sub-digest folded into the write signing string, which must be
  /// byte-identical to the edge verifier and every other SDK.
  static func sha256Hex(_ input: String) -> String {
    let digest = SHA256.hash(data: Data(input.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}
