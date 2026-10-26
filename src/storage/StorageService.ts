import { generateUuidV4 } from './uuid';
import { MMKV } from 'react-native-mmkv';
import type { ConsentPreferences, ConsentConfig } from '../types';
import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './keys';
import { runMigrations } from './migrations';
import { DECISION_TS_STORED_TOLERANCE_SECONDS, nowSeconds } from '../universal/decisionTs';
import { booleanEntries } from '../universal/types';

/**
 * Synchronous storage layer backed by MMKV.
 * All reads are synchronous — no bridge crossing for hot-path consent checks.
 */
export class StorageService {
  private storage: MMKV;

  constructor(id = 'datagrail-consent') {
    this.storage = new MMKV({ id });
    runMigrations(this);
  }

  /**
   * Store the preferences, and with them the adopted raw choice they are a view of. `adoptedRaw` is
   * the RAW category map of the Universal Consent record the preferences are the signal-reconciled
   * view of; omit it (or pass `null`) for any other preferences. The two are written together, so a
   * plain save drops a leftover adopted raw choice by construction: no writer of the preferences
   * can leave an old record's map behind to be written cross-device as the user's choice.
   */
  savePreferences(
    preferences: ConsentPreferences,
    adoptedRaw: Record<string, boolean> | null = null,
  ): void {
    this.storage.set(STORAGE_KEYS.PREFERENCES, JSON.stringify(preferences));
    if (adoptedRaw === null) {
      this.clearAdoptedRawChoice();
    } else {
      this.storage.set(STORAGE_KEYS.ADOPTED_RAW_CHOICE, JSON.stringify(adoptedRaw));
    }
  }

  loadPreferences(): ConsentPreferences | null {
    const raw = this.storage.getString(STORAGE_KEYS.PREFERENCES);
    if (raw === undefined) {
      return null;
    }
    try {
      return JSON.parse(raw) as ConsentPreferences;
    } catch {
      return null;
    }
  }

  getOrCreateUniqueId(): string {
    const existing = this.storage.getString(STORAGE_KEYS.UNIQUE_ID);
    if (existing !== undefined) {
      return existing;
    }
    const id = generateUuidV4();
    this.storage.set(STORAGE_KEYS.UNIQUE_ID, id);
    return id;
  }

  saveConfigVersion(version: string): void {
    this.storage.set(STORAGE_KEYS.VERSION, version);
  }

  loadConfigVersion(): string | null {
    return this.storage.getString(STORAGE_KEYS.VERSION) ?? null;
  }

  setUserConsented(value: boolean): void {
    this.storage.set(STORAGE_KEYS.USER_CONSENTED, value);
  }

  hasUserConsented(): boolean {
    return this.storage.getBoolean(STORAGE_KEYS.USER_CONSENTED) ?? false;
  }

  /**
   * Remove the explicit consent choice (stored preferences, the user-consented flag, the adopted raw
   * choice and the CCPA opt-out flag) so reads fall back to the config defaults, as on a fresh install. Leaves the
   * unique id, config version, config cache, pending queue and identity binding in place.
   */
  clearUserChoice(): void {
    this.storage.delete(STORAGE_KEYS.PREFERENCES);
    this.storage.delete(STORAGE_KEYS.USER_CONSENTED);
    this.clearAdoptedRawChoice();
    this.clearCcpaOptout();
    this.clearDecisionTs();
  }

  /** The RAW map the stored preferences were adopted from, or `null` when they are not an adopt. */
  loadAdoptedRawChoice(): Record<string, boolean> | null {
    const raw = this.storage.getString(STORAGE_KEYS.ADOPTED_RAW_CHOICE);
    if (raw === undefined) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return booleanEntries(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  clearAdoptedRawChoice(): void {
    this.storage.delete(STORAGE_KEYS.ADOPTED_RAW_CHOICE);
  }

  /**
   * Record WHEN the stored choice was made, as unix seconds (TRUST-3225). With no argument it is a
   * choice made now. A Universal Consent adopt passes the adopted record's time instead.
   *
   * The default is MONOTONIC: never earlier than the previous stamp + 1 (capped so it always reads
   * back), so two choices in the same second, or a choice made right after adopting a record stamped
   * slightly ahead of this clock, still order correctly. This is the only clock-skew protection.
   * Times from different devices are compared as-is, so skew (up to the edge's ~300 s clamp) can
   * still mis-order changes made within that window of each other.
   */
  saveDecisionTs(decisionTs?: number): void {
    if (decisionTs !== undefined) {
      this.storage.set(STORAGE_KEYS.DECISION_TS, decisionTs);
      return;
    }
    const now = nowSeconds();
    const previous = this.loadDecisionTs();
    const monotonic =
      previous !== null
        ? Math.min(Math.max(now, previous + 1), now + DECISION_TS_STORED_TOLERANCE_SECONDS)
        : now;
    this.storage.set(STORAGE_KEYS.DECISION_TS, monotonic);
  }

  /**
   * When the stored choice was made, or `null` when unknown: nothing is stored (no choice, or one
   * stored before TRUST-3225), the value is not a non-negative safe integer, or it is more than
   * DECISION_TS_STORED_TOLERANCE_SECONDS ahead of this clock. A stamp that far ahead is bogus (the
   * clock was ahead and has since been corrected) and would otherwise out-rank every record forever.
   */
  loadDecisionTs(): number | null {
    const value = this.storage.getNumber(STORAGE_KEYS.DECISION_TS);
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      return null;
    }
    return value <= nowSeconds() + DECISION_TS_STORED_TOLERANCE_SECONDS ? value : null;
  }

  /** The stored choice is no longer one anyone made at a known time. */
  clearDecisionTs(): void {
    this.storage.delete(STORAGE_KEYS.DECISION_TS);
  }

  /**
   * Persist the user's explicit CCPA "Do Not Sell or Share" choice. Every write states whether the
   * value is pending sync (TRUST-3308): only setCcpaOptout's not-yet-written choice on a bound device
   * is; anything else (adopting a record, the write-through restore of a synced value) is not.
   */
  saveCcpaOptout(optedOut: boolean, pendingSince: number | null = null): void {
    this.storage.set(STORAGE_KEYS.CCPA_OPTOUT, optedOut);
    if (pendingSince !== null) {
      // The value is when the pending choice was made (unix seconds): every deferred or retried
      // write sends it as decision_ts, so a late write never outranks a newer choice elsewhere.
      this.storage.set(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC, pendingSince);
    } else {
      this.storage.delete(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC);
    }
  }

  /**
   * When the pending setCcpaOptout choice was made (unix seconds), or `null` when none is pending.
   * A legacy boolean marker reads as pending at time 0: it holds the flag but never outranks a
   * dated choice.
   */
  loadCcpaOptoutPendingSince(): number | null {
    const since = this.storage.getNumber(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC);
    if (since !== undefined) {
      return since;
    }
    return this.storage.getBoolean(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC) === true ? 0 : null;
  }

  /** Whether the stored CCPA flag is a setCcpaOptout choice that has not reached the record yet. */
  hasPendingCcpaOptoutSync(): boolean {
    return this.loadCcpaOptoutPendingSince() !== null;
  }

  /**
   * A write carrying `sent` (the choice made at `since`) settled at the edge: it reached the record,
   * or the record already held a newer CCPA decision. A choice made since is left pending.
   */
  markCcpaOptoutSynced(
    sent: boolean,
    since: number | null = this.loadCcpaOptoutPendingSince(),
  ): void {
    if (
      this.hasPendingCcpaOptoutSync() &&
      this.loadCcpaOptout() === sent &&
      this.loadCcpaOptoutPendingSince() === since
    ) {
      this.saveCcpaOptout(sent);
    }
  }

  /**
   * Stamp a new CCPA choice made now and return its decision time (TRUST-3225). MONOTONIC per device:
   * strictly after the last CCPA decision time this device stored or read off a record, so a clock
   * running behind the record's, or two choices in the same second, still order correctly at the
   * edge. Capped like saveDecisionTs so the stamp always reads back; a stored floor implausibly far
   * ahead (a since-corrected clock) is ignored rather than followed into the future.
   */
  stampCcpaDecision(): number {
    const now = nowSeconds();
    const floor = this.loadCcpaDecisionTs();
    const stamp =
      floor !== null
        ? Math.min(Math.max(now, floor + 1), now + DECISION_TS_STORED_TOLERANCE_SECONDS)
        : now;
    this.storage.set(STORAGE_KEYS.CCPA_DECISION_TS, stamp);
    return stamp;
  }

  /**
   * A Universal Consent record last decided at `recordTs` was read: raise the CCPA floor to it, so a
   * choice made after reading it is stamped after every register it holds. Never lowers the floor.
   */
  raiseCcpaDecisionFloor(recordTs: number): void {
    const floor = this.loadCcpaDecisionTs();
    if (floor === null || recordTs > floor) {
      this.storage.set(STORAGE_KEYS.CCPA_DECISION_TS, recordTs);
    }
  }

  /**
   * The CCPA decision floor, or `null` when none is stored, it is not a non-negative safe integer,
   * or it is more than DECISION_TS_STORED_TOLERANCE_SECONDS ahead of this clock (same guard as
   * loadDecisionTs).
   */
  loadCcpaDecisionTs(): number | null {
    const value = this.storage.getNumber(STORAGE_KEYS.CCPA_DECISION_TS);
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      return null;
    }
    return value <= nowSeconds() + DECISION_TS_STORED_TOLERANCE_SECONDS ? value : null;
  }

  /** The stored CCPA opt-out choice; `false` ("not opted out") when none is stored. */
  loadCcpaOptout(): boolean {
    return this.storage.getBoolean(STORAGE_KEYS.CCPA_OPTOUT) ?? false;
  }

  clearCcpaOptout(): void {
    this.storage.delete(STORAGE_KEYS.CCPA_OPTOUT);
    this.storage.delete(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC);
  }

  saveBoundUserHash(userHash: string): void {
    this.storage.set(STORAGE_KEYS.BOUND_USER_HASH, userHash);
  }

  loadBoundUserHash(): string | null {
    return this.storage.getString(STORAGE_KEYS.BOUND_USER_HASH) ?? null;
  }

  clearBoundUserHash(): void {
    this.storage.delete(STORAGE_KEYS.BOUND_USER_HASH);
  }

  saveConfigCache(config: ConsentConfig, timestamp: number): void {
    this.storage.set(STORAGE_KEYS.CONFIG_CACHE, JSON.stringify(config));
    this.storage.set(STORAGE_KEYS.CONFIG_CACHE_TIMESTAMP, timestamp.toString());
  }

  loadConfigCache(): { config: ConsentConfig; timestamp: number } | null {
    const raw = this.storage.getString(STORAGE_KEYS.CONFIG_CACHE);
    const ts = this.storage.getString(STORAGE_KEYS.CONFIG_CACHE_TIMESTAMP);
    if (raw === undefined || ts === undefined) {
      return null;
    }
    try {
      const config = JSON.parse(raw) as ConsentConfig;
      const timestamp = Number(ts);
      if (isNaN(timestamp)) {
        return null;
      }
      return { config, timestamp };
    } catch {
      return null;
    }
  }

  savePendingEvents(events: unknown[]): void {
    this.storage.set(STORAGE_KEYS.PENDING_EVENTS, JSON.stringify(events));
  }

  loadPendingEvents(): unknown[] {
    const raw = this.storage.getString(STORAGE_KEYS.PENDING_EVENTS);
    if (raw === undefined) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  getSchemaVersion(): number {
    const raw = this.storage.getString(STORAGE_KEYS.SCHEMA_VERSION);
    if (raw === undefined) {
      return 0;
    }
    const version = Number(raw);
    return isNaN(version) ? 0 : version;
  }

  setSchemaVersion(version: number): void {
    this.storage.set(STORAGE_KEYS.SCHEMA_VERSION, version.toString());
  }

  clearAll(): void {
    this.storage.clearAll();
    this.storage.set(STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION.toString());
  }
}
