import type { ATTStatus, ConsentPreferences, CategoryConsent } from '../types';

export const MARKETING_GTM_KEY = 'dg-category-marketing';

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
