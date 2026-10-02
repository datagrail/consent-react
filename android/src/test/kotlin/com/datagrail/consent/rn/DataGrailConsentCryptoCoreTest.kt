package com.datagrail.consent.rn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Golden cross-SDK vector tests for the native Kotlin crypto core.
 *
 * The JS suite mocks the `DataGrailConsentCrypto` bridge out entirely, so before this file the
 * Kotlin SHA-256 path that actually runs on device was never executed anywhere. Both digests are
 * silent contracts: [DataGrailConsentCryptoCore.sha256Hex] builds the provenance sub-digest folded
 * into the write signing string (it must be byte-identical to the edge verifier and every other
 * SDK, or a correctly signed write is rejected), and [DataGrailConsentCryptoCore.computeUserHash]
 * must match every SDK or one user splits across two consent records. Golden values are copied from
 * the authoritative cross-SDK corpus (server-sdks signing-vectors.json, `single[]` no-provenance
 * vectors).
 *
 * This is a plain JDK test — [DataGrailConsentCryptoCore] pulls in no Android or React types — so it
 * runs both via the Android library's `./gradlew test` and via the standalone
 * `native/android-crypto-core` JVM harness that CI executes without an Android SDK.
 */
class DataGrailConsentCryptoCoreTest {

    // sha256Hex — provenance sub-digest (the TRUST-2971 native path)

    @Test
    fun `sha256Hex reproduces the resolved-default provenance digest`() {
        // provDigest = sha256_hex(is_explicit_str + "\n" + decision_ts_str + "\n" + actor_id_str).
        // For a provenance-free write the edge resolves the DEFAULT triple ("true", timestamp, ""),
        // so provInput = "true\n1760000000\n" — the corpus `plain-email` vector (timestamp 1760000000).
        assertEquals(
            "4de0e6fe888081209009953420b400306063e95f4b2738b53204fb36a88cedb9",
            DataGrailConsentCryptoCore.sha256Hex("true\n1760000000\n")
        )
    }

    @Test
    fun `sha256Hex reproduces the zero-timestamp provenance digest`() {
        // Corpus `zero-timestamp` vector — guards against dropping a zero component.
        assertEquals(
            "542e6e399ba3555ba5ccd3348f27f9f130573cbb0f0c036baeaba7713bc8eb9d",
            DataGrailConsentCryptoCore.sha256Hex("true\n0\n")
        )
    }

    @Test
    fun `sha256Hex is a bare digest with no normalization`() {
        // The empty string is the SHA-256 of zero bytes — proves the input is hashed verbatim.
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            DataGrailConsentCryptoCore.sha256Hex("")
        )
    }

    // computeUserHash — the cross-SDK user hash

    @Test
    fun `computeUserHash matches the corpus plain-email vector`() {
        assertEquals(
            "28b7d3a022d86efa0f672aac75cfa7cf782a04c88046fb4f2fc5c724d7fbd8b5",
            DataGrailConsentCryptoCore.computeUserHash(
                "cust_abc123",
                "proj_web_01",
                "user@example.com"
            )
        )
    }

    @Test
    fun `matches the canonical TRUST-1843 golden vector`() {
        assertEquals(
            "1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4",
            DataGrailConsentCryptoCore.computeUserHash(
                "ac46d8ad-a67a-431f-a5d5-9e3eb922dae7",
                "proj_abc123",
                "user@example.com"
            )
        )
    }

    @Test
    fun `lowercases I under Locale ROOT, not the Turkish dotless variant`() {
        // A default-locale lowercase maps "I" -> dotless "ı" on a Turkish device, which would hash
        // the same identifier differently depending on phone settings. Locale.ROOT keeps "I" -> "i",
        // so the uppercase and lowercase spellings must produce the same hash.
        assertEquals(
            DataGrailConsentCryptoCore.computeUserHash("c", "p", "user-i@example.com"),
            DataGrailConsentCryptoCore.computeUserHash("c", "p", "USER-I@EXAMPLE.COM")
        )
    }

    @Test
    fun `normalizes decomposed NFD input to the same hash as composed NFC`() {
        val composed = "jos\u00e9@example.com" // \u00e9 = precomposed NFC
        val decomposed = "jose\u0301@example.com" // e + U+0301 combining acute = NFD
        assertEquals(
            DataGrailConsentCryptoCore.computeUserHash("c", "p", composed),
            DataGrailConsentCryptoCore.computeUserHash("c", "p", decomposed)
        )
    }

    @Test
    fun `trims surrounding whitespace before hashing`() {
        assertEquals(
            DataGrailConsentCryptoCore.computeUserHash("c", "p", "user@example.com"),
            DataGrailConsentCryptoCore.computeUserHash("c", "p", "  user@example.com  ")
        )
    }

    @Test
    fun `rejects an identifier that is empty after normalization`() {
        assertThrows(DataGrailConsentCryptoCore.InvalidIdentifierException::class.java) {
            DataGrailConsentCryptoCore.computeUserHash("c", "p", "   ")
        }
    }
}
