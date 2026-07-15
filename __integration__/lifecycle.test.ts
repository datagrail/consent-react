/**
 * Integration tests — full lifecycle with real MMKV mock storage.
 * Verifies init → consent check → save → verify persisted → offline → drain.
 */
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
import { MMKV, __resetAllStores } from 'react-native-mmkv';
import { STORAGE_KEYS } from '../src/storage/keys';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, '../__tests__/fixtures/test-config.json'),
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

describe('Consent SDK Integration - Full Lifecycle', () => {
  beforeEach(() => {
    __resetAllStores();
    reset();
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('complete lifecycle: init → check → save → verify persisted', async () => {
    mockFetchSuccess();

    // 1. Initialize
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    // 2. Verify config loaded
    const config = getConfig();
    expect(config).not.toBeNull();
    expect(config!.dgCustomerId).toBe('ac46d8ad-a67a-431f-a5d5-9e3eb922dae7');

    // 3. Category reads use the auto-persisted defaults immediately, but the
    // user hasn't actually consented to anything yet.
    expect(hasUserConsent()).toBe(false);
    expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
    expect(isCategoryEnabled('dg-category-mystery-category')).toBe(false);

    // 4. User customizes preferences
    const customPrefs: ConsentPreferences = {
      isCustomised: true,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: false },
        { gtmKey: 'dg-category-performance', isEnabled: true },
        { gtmKey: 'dg-category-functional', isEnabled: false },
        { gtmKey: 'dg-category-mystery-category', isEnabled: false },
      ],
    };

    // Reset fetch mock for save call
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          mockHeaders.forEach((v, k) => cb(v, k)),
      },
    });

    await savePreferences(customPrefs);

    // 5. Verify preferences are persisted, and real consent is now recorded
    expect(getPreferences()).toEqual(customPrefs);
    expect(hasUserConsent()).toBe(true);
    expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    expect(isCategoryEnabled('dg-category-performance')).toBe(true);

    // 6. Verify POST was made
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/save_preferences'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('acceptAll enables all categories', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await acceptAll();

    const prefs = getPreferences()!;
    expect(prefs.cookieOptions.every((opt) => opt.isEnabled)).toBe(true);
    expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
    expect(isCategoryEnabled('dg-category-mystery-category')).toBe(true);
  });

  it('rejectAll keeps only essential categories enabled', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await rejectAll();

    expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    expect(isCategoryEnabled('dg-category-performance')).toBe(false);
    expect(isCategoryEnabled('dg-category-functional')).toBe(false);
    expect(isCategoryEnabled('dg-category-mystery-category')).toBe(false);
  });

  it('event listener fires on preference save', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    const listener = jest.fn();
    const unsubscribe = onConsentChanged(listener);

    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    const prefs: ConsentPreferences = {
      isCustomised: true,
      cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
    };

    await savePreferences(prefs);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(prefs);

    // Unsubscribe and verify no more calls
    unsubscribe();
    await savePreferences(prefs);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('offline scenario: queue on failure, drain on reconnect', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    // Simulate network failure on save
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network offline'));

    await savePreferences({
      isCustomised: true,
      cookieOptions: [{ gtmKey: 'dg-category-essential', isEnabled: true }],
    });

    // Preferences should be saved locally despite network failure
    expect(getPreferences()!.isCustomised).toBe(true);

    // Simulate reconnect — mock success for drain
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    const result = await retryPendingRequests();
    expect(result.success).toBeGreaterThan(0);
    expect(result.failed).toBe(0);

    // Queue should be empty now
    const result2 = await retryPendingRequests();
    expect(result2).toEqual({ success: 0, failed: 0 });
  });

  it('reset clears all state and requires re-initialization', async () => {
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

    reset();

    // All methods should throw NOT_INITIALIZED
    expect(() => getPreferences()).toThrow(ConsentError);
    expect(() => isCategoryEnabled('dg-category-essential')).toThrow(ConsentError);
    expect(() => needsConsent()).toThrow(ConsentError);
    expect(getConfig()).toBeNull();
  });

  it('trackBannerShown sends analytics event', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await trackBannerShown();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('save_open');
    expect(url).toContain('dg_customer_id');
    expect(url).toContain('consent_id');
    expect(url).toContain('config_version');
    expect(url).toContain('timestamp');
  });

  it('needsConsent returns true when version changes', async () => {
    // Initialize with showBanner=true
    const configWithBanner = JSON.parse(testConfigJson);
    configWithBanner.showBanner = true;
    mockFetchSuccess(JSON.stringify(configWithBanner));
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    // Fresh init, no real consent yet — banner must show
    expect(needsConsent()).toBe(true);

    // Save prefs (real user consent, sets version to match)
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

    // Re-init with a bumped config version, without resetting — simulates the app
    // relaunching and the backend serving a new config version on top of the
    // user's existing consent (no reset() call, so preferences/consent are
    // untouched). ConfigService caches the fetched config, and its
    // stale-while-revalidate path always returns the cached config
    // synchronously — even past the TTL — so the cache has to be evicted
    // directly for this second initialize() to actually pick up the new
    // version instead of replaying the old cached one.
    const cacheStorage = new MMKV({ id: 'datagrail-consent' });
    cacheStorage.delete(STORAGE_KEYS.CONFIG_CACHE);
    cacheStorage.delete(STORAGE_KEYS.CONFIG_CACHE_TIMESTAMP);

    const newConfig = JSON.parse(testConfigJson);
    newConfig.showBanner = true;
    newConfig.version = 'new-version-xyz';
    mockFetchSuccess(JSON.stringify(newConfig));
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    // Prior real consent exists but for an old config version — reconsent required.
    expect(needsConsent()).toBe(true);
  });

  it('needsConsent returns true on a genuine first run after a full reset', async () => {
    const configWithBanner = JSON.parse(testConfigJson);
    configWithBanner.showBanner = true;
    mockFetchSuccess(JSON.stringify(configWithBanner));
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    reset();
    __resetAllStores();

    mockFetchSuccess(JSON.stringify(configWithBanner));
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    expect(needsConsent()).toBe(true);
  });

  it('persists consent ID across sessions (re-initialization)', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    // Track banner to generate consent ID
    const mockHeaders = new Map<string, string>();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await trackBannerShown();
    const firstUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    const firstConsentId = new URL(firstUrl).searchParams.get('consent_id');

    // Simulate app restart — re-initialize without clearing storage
    // (In a real app, the module reloads fresh but MMKV persists)
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
    });

    await trackBannerShown();
    const secondUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    const secondConsentId = new URL(secondUrl).searchParams.get('consent_id');

    expect(firstConsentId).toBe(secondConsentId);
  });
});
