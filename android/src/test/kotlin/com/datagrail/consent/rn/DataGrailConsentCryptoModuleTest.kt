package com.datagrail.consent.rn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Golden-vector tests for the native user hash.
 *
 * The Universal Consent user hash must be byte-identical across web, iOS, Android, React Native,
 * and the customer's backend. A drift in normalization order, locale pinning, or hex encoding is
 * silent and unrecoverable — it splits one user across two consent records, so a web opt-out stops
 * following them into the app with no error surfaced. The JS suite mocks this bridge out entirely,
 * so this is the only executable check of the actual Kotlin normalization + SHA-256 path.
 */
class DataGrailConsentCryptoModuleTest {

    @Test
    fun `matches the canonical TRUST-1843 golden vector`() {
        assertEquals(
            "1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4",
            DataGrailConsentCryptoModule.computeUserHash(
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
            DataGrailConsentCryptoModule.computeUserHash("c", "p", "user-i@example.com"),
            DataGrailConsentCryptoModule.computeUserHash("c", "p", "USER-I@EXAMPLE.COM")
        )
    }

    @Test
    fun `normalizes decomposed NFD input to the same hash as composed NFC`() {
        val composed = "jos\u00e9@example.com" // \u00e9 = precomposed NFC
        val decomposed = "jose\u0301@example.com" // e + U+0301 combining acute = NFD
        assertEquals(
            DataGrailConsentCryptoModule.computeUserHash("c", "p", composed),
            DataGrailConsentCryptoModule.computeUserHash("c", "p", decomposed)
        )
    }

    @Test
    fun `trims surrounding whitespace before hashing`() {
        assertEquals(
            DataGrailConsentCryptoModule.computeUserHash("c", "p", "user@example.com"),
            DataGrailConsentCryptoModule.computeUserHash("c", "p", "  user@example.com  ")
        )
    }

    @Test
    fun `rejects an identifier that is empty after normalization`() {
        assertThrows(DataGrailConsentCryptoModule.InvalidIdentifierException::class.java) {
            DataGrailConsentCryptoModule.computeUserHash("c", "p", "   ")
        }
    }
}
