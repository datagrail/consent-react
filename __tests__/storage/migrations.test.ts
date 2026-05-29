import { StorageService } from '../../src/storage/StorageService';
import { CURRENT_SCHEMA_VERSION } from '../../src/storage/keys';
import { __resetAllStores } from 'react-native-mmkv';

describe('migrations', () => {
  beforeEach(() => {
    __resetAllStores();
  });

  it('should set schema version to current on first run', () => {
    const storage = new StorageService('migration-first-run');
    expect(storage.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('should not reset data when schema version is current', () => {
    const storage = new StorageService('migration-current');
    storage.savePreferences({ isCustomised: true, cookieOptions: [] });

    // Create a new instance (triggers migrations again)
    const storage2 = new StorageService('migration-current');
    expect(storage2.loadPreferences()).toEqual({ isCustomised: true, cookieOptions: [] });
  });

  it('should reset on downgrade (version higher than current)', () => {
    const storage = new StorageService('migration-downgrade');
    storage.savePreferences({ isCustomised: true, cookieOptions: [] });
    // Simulate a higher schema version
    storage.setSchemaVersion(CURRENT_SCHEMA_VERSION + 10);

    // New instance triggers migration — should reset
    const storage2 = new StorageService('migration-downgrade');
    expect(storage2.loadPreferences()).toBeNull();
    expect(storage2.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });
});
