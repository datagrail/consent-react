import type { ATTStatus, ConsentPreferences, CategoryConsent } from '../types';

export const MARKETING_GTM_KEY = 'dg-category-marketing';

/**
 * Whether a tracking signal asserts an opt-out, i.e. whether it must suppress non-essential
 * categories.
 *
 * `authorized` does not suppress, but it also does not grant — permission to track is not
 * consent to marketing categories. `notDetermined` deliberately does not suppress either: an
 * unreadable signal says nothing about what the user wants, and treating it as a refusal would
 * opt out every user on a device where the lookup failed (e.g. Android without Play Services).
 *
 * Matches `TrackingSignal.suppressesNonEssential` in the iOS and Android SDKs.
 */
export function signalSuppressesNonEssential(status: ATTStatus): boolean {
  return status === 'denied' || status === 'restricted';
}

/**
 * Derive updated consent preferences from an ATT/advertising status.
 * Shared by att.ios.ts and att.android.ts (identical mapping on both platforms).
 */
export function mapATTStatusToConsent(
  status: ATTStatus,
  currentPreferences: ConsentPreferences | null,
): ConsentPreferences | null {
  if (status === 'notDetermined' || status === 'restricted') {
    return null;
  }

  const isMarketingEnabled = status === 'authorized';

  const existingOptions: CategoryConsent[] = currentPreferences?.cookieOptions ?? [];

  const hasMarketing = existingOptions.some((opt) => opt.gtmKey === MARKETING_GTM_KEY);

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
