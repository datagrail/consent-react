package com.datagrail.consent.rn

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * React Native native module providing advertising ID status on Android.
 * Named "DataGrailConsentATT" to match iOS module name for unified JS access.
 *
 * On Android there is no system-level tracking authorization prompt (unlike iOS ATT).
 * Instead, this module checks the Google Advertising ID status:
 * - Whether limit-ad-tracking is enabled
 * - Whether the advertising ID is zeroed (Android 12+ opt-out)
 */
class DataGrailConsentATTModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    private val advertisingIdHelper = AdvertisingIdHelper()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun getName(): String = "DataGrailConsentATT"

    /**
     * Async method that checks the current advertising status.
     * On Android there is no system prompt — this simply reads the current device setting.
     * Maintains API parity with iOS requestTrackingAuthorization.
     */
    @ReactMethod
    fun requestTrackingAuthorization(promise: Promise) {
        scope.launch {
            try {
                val status = advertisingIdHelper.fetchStatus(reactApplicationContext)
                promise.resolve(status)
            } catch (e: Exception) {
                promise.reject("ADVERTISING_ID_ERROR", e.message, e)
            }
        }
    }

    /**
     * Async method that returns the current advertising status.
     * Same as requestTrackingAuthorization on Android (no prompt exists).
     */
    @ReactMethod
    fun getAdvertisingStatus(promise: Promise) {
        scope.launch {
            try {
                val status = advertisingIdHelper.fetchStatus(reactApplicationContext)
                promise.resolve(status)
            } catch (e: Exception) {
                promise.reject("ADVERTISING_ID_ERROR", e.message, e)
            }
        }
    }

    /**
     * Synchronous method returning the cached advertising status.
     * Returns "notDetermined" if no async check has been performed yet.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getAdvertisingStatusSync(): String {
        return advertisingIdHelper.getCachedStatus()
    }
}
