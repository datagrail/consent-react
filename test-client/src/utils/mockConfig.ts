/**
 * Test configuration defaults and helpers for the consent SDK test client.
 */

export const STAGING_HOST = 'https://api.consentjs.datagrailstaging.com';

export const STAGING_CUSTOMER_ID = 'ac46d8ad-a67a-431f-a5d5-9e3eb922dae7';

export const STAGING_CONFIG_VERSION_ID = 'b17d1e73-6d35-4ae3-9199-ff2e98d8926a';

export const DEFAULT_CONFIG_URL = `${STAGING_HOST}/consent/${STAGING_CUSTOMER_ID}/${STAGING_CONFIG_VERSION_ID}/config.json`;

// Keys must match the gtm_keys served by test-config.json, so savePreferences()
// in the API exercise screen persists categories the SDK's isCategoryEnabled /
// getPreferences reads can actually find.
export const TEST_CATEGORIES = [
  'dg-category-essential',
  'dg-category-marketing',
  'dg-category-performance',
  'dg-category-functional',
] as const;

export const DEFAULT_PREFERENCES_JSON = JSON.stringify(
  {
    isCustomised: true,
    cookieOptions: [
      { gtmKey: 'dg-category-marketing', isEnabled: true },
      { gtmKey: 'dg-category-performance', isEnabled: false },
      { gtmKey: 'dg-category-functional', isEnabled: true },
    ],
  },
  null,
  2,
);

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'event';
  message: string;
  data?: unknown;
}

let logCounter = 0;

export function createLogEntry(type: LogEntry['type'], message: string, data?: unknown): LogEntry {
  logCounter += 1;
  return {
    id: `log-${logCounter}-${Date.now()}`,
    timestamp: new Date(),
    type,
    message,
    data,
  };
}
