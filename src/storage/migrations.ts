import type { StorageService } from './StorageService';
import { CURRENT_SCHEMA_VERSION } from './keys';

/**
 * Run schema migrations if needed.
 * Called during StorageService initialization.
 */
export function runMigrations(_storage: StorageService): void {
  // TODO: Agent implements
  // - Read current schema version from MMKV
  // - If less than CURRENT_SCHEMA_VERSION, run migration functions in order
  // - If corrupt/missing, reset to defaults
  void CURRENT_SCHEMA_VERSION;
}
