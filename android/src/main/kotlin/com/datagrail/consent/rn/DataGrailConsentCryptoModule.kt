package com.datagrail.consent.rn

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native bridge for the Universal Consent native crypto primitives.
 *
 * The whole hash is computed natively rather than exposing normalization to JS, for two reasons.
 * First, the identifier must be NFC-normalized, and Hermes does not reliably provide
 * `String.prototype.normalize` (it depends on how the app's Intl support is configured), so
 * normalizing in JS would work on some apps and silently produce a different hash on others.
 * Second, the hash is a cross-SDK contract: the same person must produce the same 64-char hex
 * from web, iOS, Android, React Native, and the customer's backend. Keeping the entire
 * derivation on the same `MessageDigest`/`Normalizer` path the Android SDK uses means this
 * wrapper cannot drift from it. A hash computed differently splits one user across two consent
 * records and their consent stops following them.
 *
 * The actual hashing lives in the React-free [DataGrailConsentCryptoCore], which this module
 * delegates to, so the cross-SDK golden vectors can be asserted by a plain JVM `./gradlew test`
 * with no Android SDK and the shipped code stays identical to the tested code.
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
        try {
            promise.resolve(DataGrailConsentCryptoCore.computeUserHash(customerId, projectId, identifier))
        } catch (e: DataGrailConsentCryptoCore.InvalidIdentifierException) {
            promise.reject("INVALID_IDENTIFIER", e.message)
        }
    }

    /**
     * Bare `SHA-256(UTF-8(input))` as lowercase hex — NO normalization, unlike [computeUserHash].
     *
     * Used to build the provenance sub-digest folded into the write signing string, which must be
     * byte-identical to the edge verifier and every other SDK.
     */
    @ReactMethod
    fun sha256Hex(input: String, promise: Promise) {
        promise.resolve(DataGrailConsentCryptoCore.sha256Hex(input))
    }
}
