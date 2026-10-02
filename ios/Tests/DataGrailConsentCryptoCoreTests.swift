import XCTest
@testable import DataGrailConsentCryptoCore

/// Golden cross-SDK vector tests for the native Swift crypto core.
///
/// The JS suite mocks the `DataGrailConsentCrypto` bridge out entirely, so before this file the
/// Swift SHA-256 path that actually runs on device was never executed anywhere. Both digests are
/// silent contracts: `sha256Hex` builds the provenance sub-digest folded into the write signing
/// string (it must be byte-identical to the edge verifier and every other SDK, or a correctly
/// signed write is rejected), and `computeUserHash` must match every SDK or one user splits across
/// two consent records. Golden values are copied from the authoritative cross-SDK corpus
/// (server-sdks signing-vectors.json, `single[]` no-provenance vectors).
final class DataGrailConsentCryptoCoreTests: XCTestCase {

  // MARK: sha256Hex — provenance sub-digest (the TRUST-2971 native path)

  /// provDigest = sha256_hex(is_explicit_str + "\n" + decision_ts_str + "\n" + actor_id_str).
  /// For a provenance-free write the edge resolves the DEFAULT triple ("true", timestamp, ""),
  /// so provInput = "true\n1760000000\n". This is the exact `provDigest` of the corpus
  /// `plain-email` vector (timestamp 1760000000).
  func testSha256HexProvenanceDigestResolvedDefault() {
    XCTAssertEqual(
      DataGrailConsentCryptoCore.sha256Hex("true\n1760000000\n"),
      "4de0e6fe888081209009953420b400306063e95f4b2738b53204fb36a88cedb9"
    )
  }

  /// Same resolved-default triple at timestamp 0 — corpus `zero-timestamp` vector's provDigest.
  /// Guards against any accidental trimming/omission of a zero component.
  func testSha256HexProvenanceDigestZeroTimestamp() {
    XCTAssertEqual(
      DataGrailConsentCryptoCore.sha256Hex("true\n0\n"),
      "542e6e399ba3555ba5ccd3348f27f9f130573cbb0f0c036baeaba7713bc8eb9d"
    )
  }

  /// sha256Hex must NOT normalize its input — it is a bare digest of the raw UTF-8 bytes.
  /// The empty string is the SHA-256 of zero bytes.
  func testSha256HexIsBareNoNormalization() {
    XCTAssertEqual(
      DataGrailConsentCryptoCore.sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
  }

  // MARK: computeUserHash — the cross-SDK user hash

  /// Corpus `plain-email` vector: userHash of ("cust_abc123", "proj_web_01", "user@example.com").
  func testComputeUserHashMatchesCorpusPlainEmail() throws {
    let hash = try DataGrailConsentCryptoCore.computeUserHash(
      customerId: "cust_abc123",
      projectId: "proj_web_01",
      identifier: "user@example.com"
    )
    XCTAssertEqual(hash, "28b7d3a022d86efa0f672aac75cfa7cf782a04c88046fb4f2fc5c724d7fbd8b5")
  }

  func testComputeUserHashRejectsIdentifierEmptyAfterNormalization() {
    XCTAssertThrowsError(
      try DataGrailConsentCryptoCore.computeUserHash(
        customerId: "c", projectId: "p", identifier: "   ")
    ) { error in
      XCTAssertEqual(error as? DataGrailConsentCryptoCore.CryptoError, .emptyIdentifier)
    }
  }
}
