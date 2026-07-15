import { MMKV } from 'react-native-mmkv';
import type { ConsentPreferences, ConsentConfig } from '../types';
import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './keys';
import { runMigrations } from './migrations';

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
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as ConsentPreferences;
    } catch {
      return null;
    }
  }

  getOrCreateUniqueId(): string {
    const existing = this.storage.getString(STORAGE_KEYS.UNIQUE_ID);
    if (existing !== undefined) return existing;
    const id = generateUUID();
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

  saveConfigCache(config: ConsentConfig, timestamp: number): void {
    this.storage.set(STORAGE_KEYS.CONFIG_CACHE, JSON.stringify(config));
    this.storage.set(STORAGE_KEYS.CONFIG_CACHE_TIMESTAMP, timestamp.toString());
  }

  loadConfigCache(): { config: ConsentConfig; timestamp: number } | null {
    const raw = this.storage.getString(STORAGE_KEYS.CONFIG_CACHE);
    const ts = this.storage.getString(STORAGE_KEYS.CONFIG_CACHE_TIMESTAMP);
    if (raw === undefined || ts === undefined) return null;
    try {
      const config = JSON.parse(raw) as ConsentConfig;
      const timestamp = Number(ts);
      if (isNaN(timestamp)) return null;
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
    if (raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  getSchemaVersion(): number {
    const raw = this.storage.getString(STORAGE_KEYS.SCHEMA_VERSION);
    if (raw === undefined) return 0;
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

/**
 * Generate a v4 UUID without crypto dependency.
 * Uses Math.random() which is sufficient for consent tracking IDs.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
