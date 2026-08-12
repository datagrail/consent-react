import { NativeModules } from 'react-native';
import type { ATTStatus } from '../types';

interface DataGrailConsentATTModule {
  getTrackingStatusSync(): ATTStatus;
}

/**
 * Read this device's current App Tracking Transparency status.
 *
 * Separate from `att.ios.ts`'s `getTrackingStatus` to avoid an import cycle — see
 * `trackingSignal.ts` for why. Unlike that one, this degrades to `notDetermined` when the native
 * module is unlinked instead of throwing: this is called on the Universal Consent path, where an
 * unreadable signal must not take down a consent read. `notDetermined` does not suppress, which
 * is the correct behavior for "we could not determine anything".
 */
export function readTrackingSignal(): ATTStatus {
  const module = NativeModules.DataGrailConsentATT as DataGrailConsentATTModule | undefined;
  if (!module) return 'notDetermined';
  try {
    return module.getTrackingStatusSync();
  } catch {
    return 'notDetermined';
  }
}
