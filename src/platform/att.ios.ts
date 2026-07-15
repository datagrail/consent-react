import { NativeModules } from 'react-native';
import type { ATTStatus } from '../types';
import { getPreferences, savePreferences } from '../ConsentManager';
import { mapATTStatusToConsent } from './attShared';

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
