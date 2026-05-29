/**
 * Test configuration defaults and helpers for the consent SDK test client.
 */

export const STAGING_CUSTOMER_ID = 'ac46d8ad-a67a-431f-a5d5-9e3eb922dae7';

export const DEFAULT_CONFIG_URL = `https://api.consentjs.datagrailstaging.com/${STAGING_CUSTOMER_ID}/config.json`;

export const TEST_CATEGORIES = [
  'analytics',
  'marketing',
  'functional',
  'essential',
] as const;

export const DEFAULT_PREFERENCES_JSON = JSON.stringify(
  {
    isCustomised: true,
    cookieOptions: [
      { gtmKey: 'analytics', isEnabled: true },
      { gtmKey: 'marketing', isEnabled: false },
      { gtmKey: 'functional', isEnabled: true },
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

export function createLogEntry(
  type: LogEntry['type'],
  message: string,
  data?: unknown,
): LogEntry {
  logCounter += 1;
  return {
    id: `log-${logCounter}-${Date.now()}`,
    timestamp: new Date(),
    type,
    message,
    data,
  };
}
