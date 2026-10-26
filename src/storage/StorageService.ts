import { generateUuidV4 } from './uuid';
import { MMKV } from 'react-native-mmkv';
import type { ConsentPreferences, ConsentConfig } from '../types';
import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './keys';
import { runMigrations } from './migrations';
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

  /** Persist the user's explicit CCPA "Do Not Sell or Share" choice. */
  saveCcpaOptout(optedOut: boolean): void {
    this.storage.set(STORAGE_KEYS.CCPA_OPTOUT, optedOut);
  }

  /** The stored CCPA opt-out choice; `false` ("not opted out") when none is stored. */
  loadCcpaOptout(): boolean {
    return this.storage.getBoolean(STORAGE_KEYS.CCPA_OPTOUT) ?? false;
  }

  clearCcpaOptout(): void {
    this.storage.delete(STORAGE_KEYS.CCPA_OPTOUT);
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
