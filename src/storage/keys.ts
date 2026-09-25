/**
 * MMKV storage keys — must match native iOS/Android SDKs exactly
 * for potential future cross-platform migration.
 */
export const STORAGE_KEYS = {
  PREFERENCES: 'datagrail_consent_preferences',
  UNIQUE_ID: 'datagrail_consent_id',
  VERSION: 'datagrail_consent_version',
  CONFIG_CACHE: 'datagrail_consent_config_cache',
  CONFIG_CACHE_TIMESTAMP: 'datagrail_consent_config_cache_ts',
  PENDING_EVENTS: 'datagrail_consent_pending_events',
  SCHEMA_VERSION: 'datagrail_consent_schema_version',
  // Set only when the user has actually gone through consent (savePreferences/
  // acceptAll/rejectAll) — distinct from auto-persisted defaults written at init
  // so needsConsent() isn't fooled by init's "store defaults for isCategoryEnabled" step.
  USER_CONSENTED: 'datagrail_consent_user_consented',
  // The Universal Consent user hash (never the raw identifier) of the identity this device is
  // currently bound to. Written only by setUserIdentifier; cleared by clearUserIdentifier and by
  // reset() (clearAll). Tells a login TRANSITION apart from a re-sync while already logged in.
  BOUND_USER_HASH: 'datagrail_consent_bound_user_hash',
  // The user's EXPLICIT CCPA/CPRA "Do Not Sell or Share" choice (TRUST-2591). Written only by
  // setCcpaOptout, by adopting a found Universal Consent record, and cleared to false by
  // clearUserIdentifier / the neutral reset; wiped by reset() (clearAll). Never derived.
  CCPA_OPTOUT: 'datagrail_consent_ccpa_optout',
} as const;

export const CURRENT_SCHEMA_VERSION = 2;
