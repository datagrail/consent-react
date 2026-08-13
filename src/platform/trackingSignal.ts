import type { ATTStatus } from '../types';

/**
 * Read this device's live ad-tracking signal.
 *
 * Split out from `att.ts` rather than reusing `getTrackingStatus` because `att.ios.ts` imports
 * `ConsentManager` (it persists the derived preference after prompting), and `ConsentManager`
 * needs the signal for Universal Consent reconciliation — importing it back would be a cycle.
 * This module has no imports of its own, so both sides can depend on it.
 *
 * Fallback for platforms where neither `.ios.ts` nor `.android.ts` resolves. A device tracking
 * signal is a mobile-only concept, so this degrades gracefully rather than throwing.
 * `notDetermined` is the honest value here — we could not determine anything, which is not the
 * same as the user permitting tracking, even though neither suppresses.
 */
export function readTrackingSignal(): ATTStatus {
  return 'notDetermined';
}
