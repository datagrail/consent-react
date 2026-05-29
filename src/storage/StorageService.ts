import { MMKV } from 'react-native-mmkv';
import type { ConsentPreferences, ConsentConfig } from '../types';

/**
 * Synchronous storage layer backed by MMKV.
 * All reads are synchronous — no bridge crossing for hot-path consent checks.
 */
export class StorageService {
  private storage: MMKV;

  constructor(id = 'datagrail-consent') {
    this.storage = new MMKV({ id });
  }

  // TODO: Agent implements — preferences CRUD
  savePreferences(_preferences: ConsentPreferences): void {
    throw new Error('Not implemented');
  }

  loadPreferences(): ConsentPreferences | null {
    throw new Error('Not implemented');
  }

  // TODO: Agent implements — unique ID
  getOrCreateUniqueId(): string {
    throw new Error('Not implemented');
  }

  // TODO: Agent implements — config version
  saveConfigVersion(_version: string): void {
    throw new Error('Not implemented');
  }

  loadConfigVersion(): string | null {
    throw new Error('Not implemented');
  }

  // TODO: Agent implements — config cache
  saveConfigCache(_config: ConsentConfig, _timestamp: number): void {
    throw new Error('Not implemented');
  }

  loadConfigCache(): { config: ConsentConfig; timestamp: number } | null {
    throw new Error('Not implemented');
  }

  // TODO: Agent implements — pending events
  savePendingEvents(_events: unknown[]): void {
    throw new Error('Not implemented');
  }

  loadPendingEvents(): unknown[] {
    throw new Error('Not implemented');
  }

  // TODO: Agent implements — clear + schema migration
  clearAll(): void {
    throw new Error('Not implemented');
  }
}
