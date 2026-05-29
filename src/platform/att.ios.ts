import { NativeModules } from 'react-native';
import type { ATTStatus, ConsentPreferences, CategoryConsent } from '../types';
import { getPreferences, savePreferences } from '../ConsentManager';

const MARKETING_GTM_KEY = 'dg-category-marketing';

interface DataGrailConsentATTModule {
  requestTrackingAuthorization(): Promise<ATTStatus>;
  getTrackingStatusSync(): ATTStatus;
}

function getNativeModule(): DataGrailConsentATTModule {
  const module = NativeModules.DataGrailConsentATT as DataGrailConsentATTModule | undefined;
  if (!module) {
    throw new Error(
      'DataGrailConsentATT native module not found. Make sure the native module is linked correctly.',
    );
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
 * Request App Tracking Transparency authorization from the user (iOS only).
 * After the user responds, persists the ATT-derived consent preference.
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
 * Get the current tracking authorization status synchronously (iOS only).
 * Uses a synchronous native module method.
 */
export function getTrackingStatus(): ATTStatus {
  const nativeModule = getNativeModule();
  return nativeModule.getTrackingStatusSync();
}
