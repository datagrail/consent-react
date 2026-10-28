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
  // Monotonic per device: logout and the neutral reset keep it; a login caps it at the current time
  // (dropping a previous identity's record time read from a clock running ahead) before raising it
  // to the new identity's record; only reset() (clearAll) wipes it.
  CCPA_DECISION_TS: 'datagrail_consent_ccpa_decision_ts',
  // The latest decision time known to be on the Universal Consent record of the identity this device
  // is bound to, as unix seconds: that record's updated_at as read here, and the decision_ts of every
  // write this device sent for it, capped at the edge's future clamp. Only a floor: the next category
  // choice is stamped strictly after it, so a choice made in the same second as a write or read here
  // never ties the record's updated_at and loses to it on the next re-sync (TRUST-3225). Scoped to
  // that identity, unlike CCPA_DECISION_TS: while a login is in flight it is only raised (by the new
  // identity's read and write), and once the bind succeeds it is replaced with the new identity's
  // times alone; clearUserIdentifier and reset() (clearAll) wipe it. So one identity's record times
  // never floor the next identity's category stamps, and a failed login never lowers the floor of
  // the identity still bound.
  // React Native only: no native key to match.
  UC_DECISION_FLOOR_TS: 'datagrail_consent_uc_decision_floor_ts',
  // WHEN the stored consent choice was made, as unix seconds (TRUST-3225, the React Native port of
  // TRUST-3154). Stamped by every real choice (savePreferences/acceptAll/rejectAll, the banner, the
  // ATT prompt), overwritten with the record's time by a Universal Consent adopt, and cleared with
  // the choice (clearUserIdentifier / neutral reset; reset() wipes it). Absent = unknown.
  DECISION_TS: 'datagrail_consent_decision_ts',
  // The RAW (not signal-reconciled) category map of the Universal Consent record that the stored
  // preferences were adopted from. Local state holds the reconciled view, so a write-through that
  // re-sends an adopted choice must send this instead, or a device-local suppression (ATT, the
  // record's GPC) would be stored cross-device as a denial. Present only while the stored
  // preferences are still that adopt: StorageService.savePreferences writes it with the preferences
  // (any save without it removes it), and reset() wipes it.
  // React Native only: iOS and Android keep the raw map inside their `datagrail_consent_sync_state`
  // record, which this SDK does not have, so there is no native key to match.
  ADOPTED_RAW_CHOICE: 'datagrail_consent_adopted_raw_choice',
} as const;

export const CURRENT_SCHEMA_VERSION = 2;
