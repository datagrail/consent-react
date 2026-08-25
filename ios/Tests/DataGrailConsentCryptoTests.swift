import XCTest
@testable import datagrail_react_native_consent

/// Golden-vector tests for the native user hash.
///
/// The Universal Consent user hash must be byte-identical across web, iOS, Android, React Native,
/// and the customer's backend. A drift in normalization order, locale pinning, or hex encoding is
/// silent and unrecoverable — it splits one user across two consent records, so a web opt-out stops
/// following them into the app with no error surfaced. The JS suite mocks this bridge out entirely,
/// so this is the only executable check of the actual Swift normalization + SHA-256 path.
final class DataGrailConsentCryptoTests: XCTestCase {

  func testMatchesCanonicalGoldenVector() throws {
    let hash = try DataGrailConsentCrypto.computeUserHash(
      customerId: "ac46d8ad-a67a-431f-a5d5-9e3eb922dae7",
      projectId: "proj_abc123",
      identifier: "user@example.com"
    )
    XCTAssertEqual(hash, "1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4")
  }

  func testLowercasesIWithPosixLocaleNotTurkishDotless() throws {
    // A Turkish-locale lowercase maps "I" -> dotless "ı", which would hash the same identifier
    // differently on a Turkish device. The en_US_POSIX pin keeps "I" -> "i", so the uppercase and
    // lowercase spellings must produce the same hash.
    let upper = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: "USER-I@EXAMPLE.COM")
    let lower = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: "user-i@example.com")
    XCTAssertEqual(upper, lower)
  }

  func testNormalizesDecomposedNfdToSameHashAsComposedNfc() throws {
    let composed = "jos\u{00e9}@example.com"   // é as the precomposed U+00E9 (NFC)
    let decomposed = "jose\u{0301}@example.com" // e + U+0301 combining acute accent (NFD)
    let a = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: composed)
    let b = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: decomposed)
    XCTAssertEqual(a, b)
  }

  func testTrimsSurroundingWhitespaceBeforeHashing() throws {
    let tight = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: "user@example.com")
    let padded = try DataGrailConsentCrypto.computeUserHash(
      customerId: "c", projectId: "p", identifier: "  user@example.com  ")
    XCTAssertEqual(tight, padded)
  }

  func testRejectsIdentifierEmptyAfterNormalization() {
    XCTAssertThrowsError(
      try DataGrailConsentCrypto.computeUserHash(
        customerId: "c", projectId: "p", identifier: "   ")
    ) { error in
      XCTAssertEqual(error as? DataGrailConsentCrypto.CryptoError, .emptyIdentifier)
    }
  }
}
