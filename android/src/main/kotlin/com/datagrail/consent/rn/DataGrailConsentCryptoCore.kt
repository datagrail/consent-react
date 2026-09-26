package com.datagrail.consent.rn

import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale

/**
 * Pure Universal Consent crypto primitives — plain JDK (`java.security` / `java.text`), NO React,
 * NO Android APIs.
 *
 * The hashing lives here, apart from the React bridge ([DataGrailConsentCryptoModule]), because
 * both digests are silent cross-SDK contracts. The user hash must be byte-identical across web,
 * iOS, Android, React Native, and the customer's backend, and the provenance digest folded into
 * the write signing string must match the edge verifier and every other SDK exactly. A drift in
 * normalization order, locale pinning, or hex encoding surfaces no error — it just splits one user
 * across two consent records or gets a correctly-signed write rejected.
 *
 * Because this object depends on no Android or React types, it compiles in a plain Kotlin/JVM
 * Gradle project (`native/android-crypto-core/`), so the golden cross-SDK vectors can be asserted
 * by `./gradlew test` in CI with no Android SDK, no emulator, and no React. The bridge delegates to
 * it, so the shipped code and the tested code are the same code and cannot drift.
 */
object DataGrailConsentCryptoCore {

    /** Thrown when the identifier is empty after normalization. */
    class InvalidIdentifierException(message: String) : IllegalArgumentException(message)

    /**
     * Pure `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as lowercase hex.
     *
     * Normalization is Unicode NFC → trim → lowercase, in that order. This is the canonical
     * contract (TRUST-1843) shared by every SDK — do not deviate.
     *
     * @throws InvalidIdentifierException when the identifier is empty after normalization.
     */
    @JvmStatic
    fun computeUserHash(customerId: String, projectId: String, identifier: String): String {
        // Lowercasing is pinned to Locale.ROOT: the default-locale overload maps "I" to the
        // dotless "ı" on a Turkish device, so the same identifier would hash differently
        // depending on the user's phone settings.
        val normalized = Normalizer.normalize(identifier, Normalizer.Form.NFC)
            .trim()
            .lowercase(Locale.ROOT)

        // Reject an identifier that is empty AFTER normalizing. SHA-256 over a bare
        // "{customerId}:{projectId}:" prefix is a valid-looking hash that every
        // empty-or-whitespace caller in the tenant shares, collapsing unrelated users onto
        // one consent record. Checking the raw string is not enough — "   " trims to nothing.
        if (normalized.isEmpty()) {
            throw InvalidIdentifierException("identifier must not be empty after normalization")
        }

        return sha256Hex("$customerId:$projectId:$normalized")
    }

    /**
     * Bare `SHA-256(UTF-8(input))` as lowercase hex — NO normalization, unlike [computeUserHash].
     * Reuses the same `MessageDigest` path as the user hash so the two cannot drift. Used to build
     * the provenance sub-digest folded into the write signing string, which must be byte-identical
     * to the edge verifier and every other SDK.
     */
    @JvmStatic
    fun sha256Hex(input: String): String {
        val hashBytes = MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }
}
