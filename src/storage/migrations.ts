import type { StorageService } from './StorageService';
import { CURRENT_SCHEMA_VERSION } from './keys';

/**
 * Run schema migrations if needed.
 * Called during StorageService initialization.
 */
export function runMigrations(storage: StorageService): void {
  const currentVersion = storage.getSchemaVersion();

  // If schema version is 0 (first run or corrupt), set to current and return
  if (currentVersion === 0) {
    storage.setSchemaVersion(CURRENT_SCHEMA_VERSION);
    return;
  }

  // If version is already current, nothing to do
  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    return;
  }

  // If version is higher than current (downgrade / corrupt), reset everything
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    storage.clearAll();
    return;
  }

  // Run migrations sequentially from currentVersion to CURRENT_SCHEMA_VERSION
  if (currentVersion < 2) {
    migrateV1ToV2(storage);
  }

  storage.setSchemaVersion(CURRENT_SCHEMA_VERSION);
}

/**
 * v1 -> v2: USER_CONSENTED was introduced in v2 to distinguish real consent
 * from init's auto-persisted defaults. An install upgrading from v1 has no
 * USER_CONSENTED flag yet, but if it has saved preferences, that *was* real
 * consent under v1's semantics (v1 had no auto-persist-without-consent step)
 * — backfill the flag so needsConsent()/hasUserConsent() don't treat an
 * already-consented install as needing reconsent.
 */
function migrateV1ToV2(storage: StorageService): void {
  if (storage.loadPreferences() !== null) {
    storage.setUserConsented(true);
  }
}
