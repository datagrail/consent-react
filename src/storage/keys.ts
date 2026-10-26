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
  // Set while CCPA_OPTOUT holds an explicit setCcpaOptout choice made on a BOUND device that has not
  // reached the Universal Consent record yet (no `sync` passed, no explicit category choice to write
  // with, or a failed write). While set, a RE-SYNC must not overwrite the flag with the record's
  // (stale) value. Cleared by the next successful write carrying the value and by every other flag
  // write (login adopt, logout, neutral reset) (TRUST-3308).
  CCPA_OPTOUT_PENDING_SYNC: 'datagrail_consent_ccpa_optout_pending_sync',
  // The latest CCPA decision time this device knows of, as unix seconds: its own last setCcpaOptout
  // choice, or the updated_at of a Universal Consent record it read, whichever is later. Only a
  // floor: the next setCcpaOptout choice is stamped strictly after it, so a clock running behind
  // (or two choices in one second) cannot lose at the edge to an older decision (TRUST-3225).
  // Monotonic per device: logout and the neutral reset keep it; only reset() (clearAll) wipes it.
  CCPA_DECISION_TS: 'datagrail_consent_ccpa_decision_ts',
  // WHEN the stored consent choice was made, as unix seconds (TRUST-3225, the React Native port of
  // TRUST-3154). Stamped by every real choice (savePreferences/acceptAll/rejectAll, the banner, the
  // ATT prompt), overwritten with the record's time by a Universal Consent adopt, and cleared with
  // the choice (clearUserIdentifier / neutral reset; reset() wipes it). Absent = unknown.
  DECISION_TS: 'datagrail_consent_decision_ts',
  // The RAW (not signal-reconciled) category map of the Universal Consent record that the stored
  // preferences were adopted from. Local state holds the reconciled view, so a write-through that
  // re-sends an adopted choice must send this instead, or a device-local suppression (ATT, the
  // record's GPC) would be stored cross-device as a denial. Present only while the stored
  // preferences are still that adopt: an explicit save, the neutral reset and reset() remove it.
  ADOPTED_RAW_CHOICE: 'datagrail_consent_adopted_raw_choice',
} as const;

export const CURRENT_SCHEMA_VERSION = 2;
