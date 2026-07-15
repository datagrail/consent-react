import {
  initialize,
  needsConsent,
  isCategoryEnabled,
  getPreferences,
  getCategories,
  getConfig,
  savePreferences,
  acceptAll,
  rejectAll,
  onConsentChanged,
  reset,
  hasUserConsent,
  retryPendingRequests,
  trackBannerShown,
} from '../src/ConsentManager';
import { ConsentError } from '../src/types';
import type { ConsentPreferences } from '../src/types';
import { __resetAllStores } from 'react-native-mmkv';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, 'fixtures/test-config.json'),
  'utf-8',
);

function mockFetchSuccess(data: string = testConfigJson) {
  const mockHeaders = new Map<string, string>();
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    text: () => Promise.resolve(data),
    headers: {
      forEach: (cb: (v: string, k: string) => void) =>
        mockHeaders.forEach((v, k) => cb(v, k)),
    },
  });
}

function mockFetchFailure() {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
}

describe('ConsentManager', () => {
  beforeEach(() => {
    __resetAllStores();
    reset();
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should throw on missing configUrl', async () => {
      await expect(
        initialize({ configUrl: '' }),
      ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    });

    it('should throw on non-HTTPS configUrl', async () => {
      await expect(
        initialize({ configUrl: 'http://example.com/config.json' }),
      ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    });

    it('should initialize successfully with valid config', async () => {
      mockFetchSuccess();

      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(getConfig()).not.toBeNull();
      expect(getConfig()!.version).toBe('cc959465-747d-4c81-8bc1-5dcd34dc3756');
    });

    it('should throw NETWORK_ERROR on fetch failure', async () => {
      mockFetchFailure();

      await expect(
        initialize({ configUrl: 'https://cdn.example.com/config.json' }),
      ).rejects.toThrow();
    });
  });

  describe('needsConsent', () => {
    it('should throw if not initialized', () => {
      expect(() => needsConsent()).toThrow(ConsentError);
    });

    it('should return false when showBanner is false', async () => {
      mockFetchSuccess(); // test config has showBanner=false
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(needsConsent()).toBe(false);
    });

    it('should return true when showBanner=true and no saved prefs', async () => {
      const configWithBanner = JSON.parse(testConfigJson);
      configWithBanner.showBanner = true;
      mockFetchSuccess(JSON.stringify(configWithBanner));

      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      // Init auto-persists defaults so isCategoryEnabled() works immediately, but that
      // is not real user consent — the banner must still show on a genuine first run.
      expect(needsConsent()).toBe(true);
    });

    it('should return false after the user actually saves preferences', async () => {
      const configWithBanner = JSON.parse(testConfigJson);
      configWithBanner.showBanner = true;
      mockFetchSuccess(JSON.stringify(configWithBanner));

      await initialize({ configUrl: 'https://cdn.example.com/config.json' });
      expect(needsConsent()).toBe(true);

      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await savePreferences({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      });

      expect(needsConsent()).toBe(false);
    });
  });

  describe('isCategoryEnabled', () => {
    it('should throw if not initialized', () => {
      expect(() => isCategoryEnabled('dg-category-essential')).toThrow(ConsentError);
    });

    it('should return true for categories in initialCategories.initial', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
      expect(isCategoryEnabled('dg-category-performance')).toBe(true);
    });

    it('should return false for categories not in initial', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(isCategoryEnabled('dg-category-mystery-category')).toBe(false);
    });

    it('should return false for unknown categories', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(isCategoryEnabled('nonexistent')).toBe(false);
    });
  });

  describe('getPreferences', () => {
    it('should throw if not initialized', () => {
      expect(() => getPreferences()).toThrow(ConsentError);
    });

    it('should return default preferences after initialization', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const prefs = getPreferences();
      expect(prefs).not.toBeNull();
      expect(prefs!.isCustomised).toBe(false);
    });
  });

  describe('getCategories', () => {
    it('should throw if not initialized', () => {
      expect(() => getCategories()).toThrow(ConsentError);
    });

    it('should return preferences after initialization', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const cats = getCategories();
      expect(cats).not.toBeNull();
      expect(cats!.cookieOptions.length).toBeGreaterThan(0);
    });
  });

  describe('savePreferences', () => {
    it('should throw if not initialized', async () => {
      await expect(
        savePreferences({ isCustomised: true, cookieOptions: [] }),
      ).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
    });

    it('should persist preferences', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const prefs: ConsentPreferences = {
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      };

      await savePreferences(prefs);

      expect(getPreferences()).toEqual(prefs);
    });

    it('should emit event after saving', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const listener = jest.fn();
      onConsentChanged(listener);

      const prefs: ConsentPreferences = {
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      };

      await savePreferences(prefs);
      expect(listener).toHaveBeenCalledWith(prefs);
    });

    it('should POST to save_preferences endpoint', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      // Reset fetch mock after init
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await savePreferences({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.consentjs.datagrailstaging.com/save_preferences',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should queue to offline queue on network failure', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      // Mock network failure for save
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

      await savePreferences({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      });

      // Preferences should still be saved locally
      expect(getPreferences()!.isCustomised).toBe(true);
    });
  });

  describe('acceptAll', () => {
    it('should enable all categories', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      // Reset fetch for the save call
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await acceptAll();

      const prefs = getPreferences()!;
      expect(prefs.cookieOptions.every((opt) => opt.isEnabled)).toBe(true);
    });
  });

  describe('rejectAll', () => {
    it('should only enable essential categories', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      // Reset fetch for the save call
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await rejectAll();

      const prefs = getPreferences()!;
      const essential = prefs.cookieOptions.find(
        (opt) => opt.gtmKey === 'dg-category-essential',
      );
      const marketing = prefs.cookieOptions.find(
        (opt) => opt.gtmKey === 'dg-category-marketing',
      );

      expect(essential?.isEnabled).toBe(true);
      expect(marketing?.isEnabled).toBe(false);
    });
  });

  describe('onConsentChanged', () => {
    it('should return unsubscribe function', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const listener = jest.fn();
      const unsubscribe = onConsentChanged(listener);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();

      await savePreferences({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should clear state', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      reset();

      expect(getConfig()).toBeNull();
      expect(() => getPreferences()).toThrow(ConsentError);
    });
  });

  describe('hasUserConsent', () => {
    it('should throw if not initialized', () => {
      expect(() => hasUserConsent()).toThrow(ConsentError);
    });

    it('should return false after a bare initialization (auto-persisted defaults are not real consent)', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(hasUserConsent()).toBe(false);
    });

    it('should return true after the user actually saves preferences', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await savePreferences({
        isCustomised: true,
        cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
      });

      expect(hasUserConsent()).toBe(true);
    });
  });

  describe('retryPendingRequests', () => {
    it('should throw if not initialized', async () => {
      await expect(retryPendingRequests()).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('should return results from offline queue drain', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const result = await retryPendingRequests();
      expect(result).toEqual({ success: 0, failed: 0 });
    });
  });

  describe('trackBannerShown', () => {
    it('should throw if not initialized', async () => {
      await expect(trackBannerShown()).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('should send GET to save_open endpoint', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
      });

      await trackBannerShown();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.consentjs.datagrailstaging.com/save_open?'),
        expect.objectContaining({ method: 'GET' }),
      );

      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('dg_customer_id=ac46d8ad-a67a-431f-a5d5-9e3eb922dae7');
      expect(url).toContain('config_version=cc959465-747d-4c81-8bc1-5dcd34dc3756');
      expect(url).toContain('consent_id=');
      expect(url).toContain('timestamp=');
    });

    it('should not throw on network error', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      global.fetch = jest.fn().mockRejectedValue(new TypeError('Network error'));

      await expect(trackBannerShown()).resolves.toBeUndefined();
    });
  });
});
