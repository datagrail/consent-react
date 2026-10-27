import { StorageService } from '../../src/storage/StorageService';
import { CURRENT_SCHEMA_VERSION } from '../../src/storage/keys';
import type { ConsentPreferences, ConsentConfig } from '../../src/types';
import { __resetAllStores } from 'react-native-mmkv';

describe('StorageService', () => {
  let storage: StorageService;

  beforeEach(() => {
    __resetAllStores();
    storage = new StorageService('test-storage');
  });

  describe('preferences', () => {
    const preferences: ConsentPreferences = {
      isCustomised: true,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: false },
      ],
    };

    it('should save and load preferences', () => {
      storage.savePreferences(preferences);
      const loaded = storage.loadPreferences();
      expect(loaded).toEqual(preferences);
    });

    it('stores an adopted raw choice with the preferences, and a plain save drops it', () => {
      storage.savePreferences(preferences, { 'dg-category-marketing': true });
      expect(storage.loadAdoptedRawChoice()).toEqual({ 'dg-category-marketing': true });

      // Any other writer of the preferences (initialize()'s defaults, the neutral reset, an
      // explicit save) cannot leave an old record's raw map behind.
      storage.savePreferences(preferences);
      expect(storage.loadAdoptedRawChoice()).toBeNull();
    });

    it('drops non-boolean entries from a stored adopted raw choice', () => {
      const raw = new (require('react-native-mmkv').MMKV)({ id: 'test-storage' });
      raw.set(
        'datagrail_consent_adopted_raw_choice',
        JSON.stringify({ 'dg-category-marketing': 'false', 'dg-category-essential': true }),
      );
      expect(storage.loadAdoptedRawChoice()).toEqual({ 'dg-category-essential': true });
    });

    it('should return null when no preferences saved', () => {
      expect(storage.loadPreferences()).toBeNull();
    });

    it('should return null on corrupt data', () => {
      // Force corrupt data via a separate instance writing garbage
      const rawStorage = new (require('react-native-mmkv').MMKV)({ id: 'corrupt-test' });
      rawStorage.set('datagrail_consent_preferences', 'not-valid-json{{{');
      // Create storage with same id
      const corruptStorage = new StorageService('corrupt-test');
      expect(corruptStorage.loadPreferences()).toBeNull();
    });
  });

  describe('uniqueId', () => {
    it('should create a UUID on first call', () => {
      const id = storage.getOrCreateUniqueId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should return the same ID on subsequent calls', () => {
      const id1 = storage.getOrCreateUniqueId();
      const id2 = storage.getOrCreateUniqueId();
      expect(id1).toBe(id2);
    });
  });

  describe('configVersion', () => {
    it('should save and load config version', () => {
      storage.saveConfigVersion('v1.2.3');
      expect(storage.loadConfigVersion()).toBe('v1.2.3');
    });

    it('should return null when no version saved', () => {
      expect(storage.loadConfigVersion()).toBeNull();
    });
  });

  describe('configCache', () => {
    const mockConfig: ConsentConfig = {
      version: 'test-version',
      consentContainerVersionId: 'container-1',
      dgCustomerId: 'customer-1',
      publishDate: 1700000000000,
      dch: 'categorize',
      dc: null,
      privacyDomain: 'api.example.com',
      plugins: {
        scriptControl: true,
        allCookieSubdomains: true,
        cookieBlocking: true,
        localStorageBlocking: true,
        syncOTConsent: false,
      },
      testMode: false,
      ignoreDoNotTrack: false,
      trackingDetailsUrl: 'https://example.com/tracking',
      consentMode: 'optin',
      showBanner: true,
      consentPolicy: { name: 'GDPR', default: true },
      gppUsNat: false,
      initialCategories: {
        respectGpc: true,
        respectDnt: true,
        respectOptout: false,
        initial: ['dg-category-essential', 'dg-category-marketing'],
        gpc: ['dg-category-essential'],
        optout: ['dg-category-essential'],
      },
      layout: {
        id: 'layout-1',
        name: 'Default',
        description: null,
        status: 'published',
        defaultLayout: true,
        collapsedOnMobile: false,
        firstLayerId: 'layer-1',
        gpcDntLayerId: null,
        consentLayers: {},
      },
    };

    it('should save and load config cache with timestamp', () => {
      const timestamp = Date.now();
      storage.saveConfigCache(mockConfig, timestamp);
      const cached = storage.loadConfigCache();
      expect(cached).not.toBeNull();
      expect(cached!.config).toEqual(mockConfig);
      expect(cached!.timestamp).toBe(timestamp);
    });

    it('should return null when no cache exists', () => {
      expect(storage.loadConfigCache()).toBeNull();
    });
  });

  describe('ccpaOptout pending marker', () => {
    it('reads back a valid pending time and rejects a malformed or implausible one', () => {
      const raw = new (require('react-native-mmkv').MMKV)({ id: 'test-storage' });
      const now = Math.floor(Date.now() / 1000);
      storage.saveCcpaOptout(true, now);
      expect(storage.loadCcpaOptoutPendingSince()).toBe(now);
      for (const bad of [-1, 1.5, now + 3600]) {
        raw.set('datagrail_consent_ccpa_optout_pending_sync', bad);
        expect(storage.loadCcpaOptoutPendingSince()).toBeNull();
      }
    });
  });

  describe('pendingEvents', () => {
    it('should save and load pending events', () => {
      const events = [
        { url: '/save_preferences', body: '{}', method: 'POST' },
        { url: '/save_open', method: 'GET' },
      ];
      storage.savePendingEvents(events);
      const loaded = storage.loadPendingEvents();
      expect(loaded).toEqual(events);
    });

    it('should return empty array when no events', () => {
      expect(storage.loadPendingEvents()).toEqual([]);
    });

    it('should return empty array on corrupt data', () => {
      const rawStorage = new (require('react-native-mmkv').MMKV)({ id: 'corrupt-events' });
      rawStorage.set('datagrail_consent_pending_events', '{not-an-array');
      const corruptStorage = new StorageService('corrupt-events');
      expect(corruptStorage.loadPendingEvents()).toEqual([]);
    });
  });

  describe('clearAll', () => {
    it('should clear all stored data', () => {
      storage.savePreferences({ isCustomised: true, cookieOptions: [] });
      storage.saveConfigVersion('v1');
      storage.getOrCreateUniqueId();
      storage.clearAll();

      expect(storage.loadPreferences()).toBeNull();
      expect(storage.loadConfigVersion()).toBeNull();
    });

    it('should clear the identity binding', () => {
      storage.saveBoundUserHash('hash-a');
      storage.clearAll();
      expect(storage.loadBoundUserHash()).toBeNull();
    });

    it('should set schema version after clear', () => {
      storage.clearAll();
      expect(storage.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe('bound user hash', () => {
    it('returns null when unbound', () => {
      expect(storage.loadBoundUserHash()).toBeNull();
    });

    it('persists and clears the binding', () => {
      storage.saveBoundUserHash('hash-a');
      expect(storage.loadBoundUserHash()).toBe('hash-a');
      storage.clearBoundUserHash();
      expect(storage.loadBoundUserHash()).toBeNull();
    });
  });

  describe('ccpa opt-out', () => {
    it('defaults to false, persists and clears', () => {
      expect(storage.loadCcpaOptout()).toBe(false);
      storage.saveCcpaOptout(true);
      expect(storage.loadCcpaOptout()).toBe(true);
      storage.clearCcpaOptout();
      expect(storage.loadCcpaOptout()).toBe(false);
    });

    it('is wiped by clearAll and cleared by clearUserChoice', () => {
      storage.saveCcpaOptout(true);
      storage.clearAll();
      expect(storage.loadCcpaOptout()).toBe(false);

      storage.saveCcpaOptout(true);
      storage.clearUserChoice();
      expect(storage.loadCcpaOptout()).toBe(false);
    });
  });

  describe('clearUserChoice', () => {
    it('removes preferences and the consented flag, keeping everything else', () => {
      storage.savePreferences({ isCustomised: true, cookieOptions: [] });
      storage.setUserConsented(true);
      storage.saveConfigVersion('v1');
      storage.saveBoundUserHash('hash-a');
      storage.savePendingEvents([{ id: 1 }]);
      const id = storage.getOrCreateUniqueId();

      storage.clearUserChoice();

      expect(storage.loadPreferences()).toBeNull();
      expect(storage.hasUserConsented()).toBe(false);
      expect(storage.loadConfigVersion()).toBe('v1');
      expect(storage.loadBoundUserHash()).toBe('hash-a');
      expect(storage.loadPendingEvents()).toEqual([{ id: 1 }]);
      expect(storage.getOrCreateUniqueId()).toBe(id);
    });
  });

  describe('schema version', () => {
    it('should get and set schema version', () => {
      storage.setSchemaVersion(CURRENT_SCHEMA_VERSION + 4);
      expect(storage.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION + 4);
    });

    it('should return the current schema version after construction (migrations already ran)', () => {
      expect(storage.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    });
  });
});
