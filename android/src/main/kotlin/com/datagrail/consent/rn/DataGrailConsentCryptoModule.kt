package com.datagrail.consent.rn

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale

/**
 * Computes the Universal Consent user hash natively.
 *
 * The whole hash is computed here rather than exposing a bare SHA-256 primitive to JS, for two
 * reasons. First, the identifier must be NFC-normalized, and Hermes does not reliably provide
 * `String.prototype.normalize` (it depends on how the app's Intl support is configured), so
 * normalizing in JS would work on some apps and silently produce a different hash on others.
 * Second, the hash is a cross-SDK contract: the same person must produce the same 64-char hex
 * from web, iOS, Android, React Native, and the customer's backend. Keeping the entire
 * derivation on the same `MessageDigest`/`Normalizer` path the Android SDK uses means this
 * wrapper cannot drift from it. A hash computed differently splits one user across two consent
 * records and their consent stops following them.
 */
class DataGrailConsentCryptoModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DataGrailConsentCrypto"

    /**
     * Compute `SHA-256("{customerId}:{projectId}:{normalizedIdentifier}")` as lowercase hex.
     *
     * Normalization is Unicode NFC → trim → lowercase, in that order. This is the canonical
     * contract (TRUST-1843) shared by every SDK — do not deviate.
     */
    @ReactMethod
    fun computeUserHash(
        customerId: String,
        projectId: String,
        identifier: String,
        promise: Promise
    ) {
        // Lowercasing is pinned to Locale.ROOT: the default-locale overload maps "I" to the
        // dotless "ı" on a Turkish device, so the same identifier would hash differently
        // depending on the user's phone settings.
        val normalized = Normalizer.normalize(identifier, Normalizer.Form.NFC)
            .trim()
            .lowercase(Locale.ROOT)

        // Reject an identifier that is empty AFTER normalizing. SHA-256 over a bare
        // "{customerId}:{projectId}:" prefix is a valid-looking hash that every
        // empty-or-whitespace caller in the tenant shares, collapsing unrelated users onto one
        // consent record. Checking the raw string is not enough — "   " trims away to nothing.
        if (normalized.isEmpty()) {
            promise.reject(
                "INVALID_IDENTIFIER",
                "identifier must not be empty after normalization"
            )
            return
        }

        val input = "$customerId:$projectId:$normalized"
        val hashBytes = MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
        promise.resolve(hashBytes.joinToString("") { "%02x".format(it) })
    }
}
