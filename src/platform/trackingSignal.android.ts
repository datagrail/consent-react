import { NativeModules } from 'react-native';
import type { ATTStatus } from '../types';

interface DataGrailConsentATTModule {
  getAdvertisingStatusSync(): ATTStatus;
}

/**
 * Read this device's current advertising-ID opt-out status.
 *
 * Separate from `att.android.ts`'s `getTrackingStatus` to avoid an import cycle — see
 * `trackingSignal.ts` for why. Degrades to `notDetermined` rather than `authorized` when the
 * native module or Play Services is unavailable: the native module returns the cached status
 * from the last async check, so before any check has run there is genuinely nothing to report.
 * `notDetermined` does not suppress, so a missing signal never opts anyone out.
 */
export function readTrackingSignal(): ATTStatus {
  const module = NativeModules.DataGrailConsentATT as DataGrailConsentATTModule | undefined;
  if (!module) return 'notDetermined';
  try {
    return module.getAdvertisingStatusSync();
  } catch {
    return 'notDetermined';
  }
}
