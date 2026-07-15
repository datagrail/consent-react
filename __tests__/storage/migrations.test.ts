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

  it('should backfill USER_CONSENTED for a v1 install that already had saved preferences', () => {
    const storage = new StorageService('migration-v1-consented');
    storage.savePreferences({ isCustomised: true, cookieOptions: [] });
    // Simulate a pre-USER_CONSENTED (v1) install: real consent existed, but
    // the flag introduced in v2 was never set.
    storage.setSchemaVersion(1);

    const storage2 = new StorageService('migration-v1-consented');
    expect(storage2.hasUserConsented()).toBe(true);
    expect(storage2.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('should not set USER_CONSENTED for a v1 install with no saved preferences', () => {
    const storage = new StorageService('migration-v1-unconsented');
    storage.setSchemaVersion(1);

    const storage2 = new StorageService('migration-v1-unconsented');
    expect(storage2.hasUserConsented()).toBe(false);
    expect(storage2.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });
});
