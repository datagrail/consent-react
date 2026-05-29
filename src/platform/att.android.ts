import { NativeModules } from 'react-native';
import type { ATTStatus, ConsentPreferences, CategoryConsent } from '../types';
import { getPreferences, savePreferences } from '../ConsentManager';

const MARKETING_GTM_KEY = 'dg-category-marketing';

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

function mapATTStatusToConsent(
  status: ATTStatus,
  currentPreferences: ConsentPreferences | null,
): ConsentPreferences | null {
  if (status === 'notDetermined' || status === 'restricted') {
    return null;
  }

  const isMarketingEnabled = status === 'authorized';

  const existingOptions: CategoryConsent[] = currentPreferences?.cookieOptions ?? [];

  const hasMarketing = existingOptions.some(
    (opt) => opt.gtmKey === MARKETING_GTM_KEY,
  );

  const updatedOptions: CategoryConsent[] = hasMarketing
    ? existingOptions.map((opt) =>
        opt.gtmKey === MARKETING_GTM_KEY
          ? { gtmKey: opt.gtmKey, isEnabled: isMarketingEnabled }
          : opt,
      )
    : [...existingOptions, { gtmKey: MARKETING_GTM_KEY, isEnabled: isMarketingEnabled }];

  return {
    isCustomised: true,
    cookieOptions: updatedOptions,
  };
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
