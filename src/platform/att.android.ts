import { NativeModules } from 'react-native';
import type { ATTStatus } from '../types';
import { getPreferences, savePreferences } from '../ConsentManager';
import { mapATTStatusToConsent } from './attShared';

interface DataGrailConsentATTModule {
  requestTrackingAuthorization(): Promise<ATTStatus>;
  getAdvertisingStatusSync(): ATTStatus;
}

function getNativeModule(): DataGrailConsentATTModule {
  const module = NativeModules.DataGrailConsentATT as DataGrailConsentATTModule | undefined;
  if (!module) {
    // Graceful degradation — if Play Services unavailable, return authorized
    return {
      requestTrackingAuthorization: async () => 'authorized' as ATTStatus,
      getAdvertisingStatusSync: () => 'authorized' as ATTStatus,
    };
  }
  return module;
}

/**
 * Request advertising tracking status on Android.
 * Unlike iOS, there is no system prompt — this reads the current device setting
 * (Google Advertising ID limit-ad-tracking / zeroed ID).
 * After checking, persists the derived consent preference.
 */
export async function requestTrackingAuthorization(): Promise<ATTStatus> {
  const nativeModule = getNativeModule();
  const status = await nativeModule.requestTrackingAuthorization();

  const currentPreferences = getPreferences();
  const updatedPreferences = mapATTStatusToConsent(status, currentPreferences);

  if (updatedPreferences) {
    await savePreferences(updatedPreferences);
  }

  return status;
}

/**
 * Get the current advertising tracking status synchronously (Android).
 * Returns the cached value from the last async check, or 'notDetermined' if never checked.
 * When native module is unavailable, returns 'authorized' (graceful degradation).
 */
export function getTrackingStatus(): ATTStatus {
  const nativeModule = getNativeModule();
  return nativeModule.getAdvertisingStatusSync();
}
