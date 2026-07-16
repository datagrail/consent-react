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
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
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

    it('should set schema version after clear', () => {
      storage.clearAll();
      expect(storage.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
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
