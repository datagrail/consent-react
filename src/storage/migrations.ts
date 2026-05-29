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
  // Currently no migrations exist (schema version 1 is the initial version).
  // Future migrations would be added here:
  // if (currentVersion < 2) { migrateV1ToV2(storage); }

  storage.setSchemaVersion(CURRENT_SCHEMA_VERSION);
}
