import { generateUuidV4 } from './uuid';
import { MMKV } from 'react-native-mmkv';
import type { ConsentPreferences, ConsentConfig } from '../types';
import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './keys';
import { runMigrations } from './migrations';
import { DECISION_TS_STORED_TOLERANCE_SECONDS, nowSeconds } from '../universal/decisionTs';

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

  savePreferences(preferences: ConsentPreferences): void {
    this.storage.set(STORAGE_KEYS.PREFERENCES, JSON.stringify(preferences));
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

  /**
   * Record the RAW category map of the Universal Consent record the stored preferences were just
   * adopted from (the stored preferences are its signal-reconciled view).
   */
  saveAdoptedRawChoice(cookieOptions: Record<string, boolean>): void {
    this.storage.set(STORAGE_KEYS.ADOPTED_RAW_CHOICE, JSON.stringify(cookieOptions));
  }

  /** The RAW map the stored preferences were adopted from, or `null` when they are not an adopt. */
  loadAdoptedRawChoice(): Record<string, boolean> | null {
    const raw = this.storage.getString(STORAGE_KEYS.ADOPTED_RAW_CHOICE);
    if (raw === undefined) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, boolean>)
        : null;
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
  saveCcpaOptout(optedOut: boolean, pendingSync = false): void {
    this.storage.set(STORAGE_KEYS.CCPA_OPTOUT, optedOut);
    if (pendingSync) {
      this.storage.set(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC, true);
    } else {
      this.storage.delete(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC);
    }
  }

  /** Whether the stored CCPA flag is a setCcpaOptout choice that has not reached the record yet. */
  hasPendingCcpaOptoutSync(): boolean {
    return this.storage.getBoolean(STORAGE_KEYS.CCPA_OPTOUT_PENDING_SYNC) ?? false;
  }

  /** A write carrying `sent` succeeded: a pending choice reached the record, unless it changed since. */
  markCcpaOptoutSynced(sent: boolean): void {
    if (this.hasPendingCcpaOptoutSync() && this.loadCcpaOptout() === sent) {
      this.saveCcpaOptout(sent);
    }
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
