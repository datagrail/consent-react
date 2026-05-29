package com.datagrail.consent.rn

import android.content.Context
import com.google.android.gms.ads.identifier.AdvertisingIdClient
import com.google.android.gms.common.GooglePlayServicesNotAvailableException
import com.google.android.gms.common.GooglePlayServicesRepairableException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Thread-safe wrapper around Google Play Services AdvertisingIdClient.
 * Caches the last known advertising status for synchronous access.
 */
class AdvertisingIdHelper {

    companion object {
        private const val ZEROED_AD_ID = "00000000-0000-0000-0000-000000000000"
    }

    @Volatile
    private var cachedStatus: String = "notDetermined"

    private val mutex = Mutex()

    /**
     * Returns the cached advertising status without blocking.
     * Returns "notDetermined" if no async check has been performed yet.
     */
    fun getCachedStatus(): String = cachedStatus

    /**
     * Fetches the advertising ID status from Google Play Services.
     * Updates the cached status and returns the result.
     *
     * Possible return values:
     * - "authorized" — user has not limited ad tracking and ID is valid
     * - "denied" — user has limited ad tracking or ID is zeroed (Android 12+ opt-out)
     * - "notDetermined" — Google Play Services unavailable
     */
    suspend fun fetchStatus(context: Context): String = mutex.withLock {
        withContext(Dispatchers.IO) {
            try {
                val adInfo = AdvertisingIdClient.getAdvertisingIdInfo(context)

                val status = when {
                    adInfo.isLimitAdTrackingEnabled -> "denied"
                    adInfo.id == ZEROED_AD_ID -> "denied"
                    else -> "authorized"
                }

                cachedStatus = status
                status
            } catch (_: GooglePlayServicesNotAvailableException) {
                // Play Services not installed — cannot determine status
                cachedStatus = "notDetermined"
                "notDetermined"
            } catch (_: GooglePlayServicesRepairableException) {
                // Play Services needs update — cannot determine status
                cachedStatus = "notDetermined"
                "notDetermined"
            } catch (_: IOException) {
                // Network or timeout error — cannot determine status
                cachedStatus = "notDetermined"
                "notDetermined"
            }
        }
    }
}
