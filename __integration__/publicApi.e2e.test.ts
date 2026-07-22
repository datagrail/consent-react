/**
 * End-to-end test through the SDK's public entry point (`src/index`).
 *
 * Unlike lifecycle.test.ts (which imports from ConsentManager directly), this
 * exercises the module surface exactly as a customer app consumes it — every
 * assertion here is a guarantee we make to integrators. It also guards the
 * consent-ID generation path (formerly backed by the ESM-only `uuid` package,
 * now by the in-package RFC 4122 v4 generator) end to end.
 */
import {
  initialize,
  needsConsent,
  isCategoryEnabled,
  getPreferences,
  getConfig,
  savePreferences,
  acceptAll,
  onConsentChanged,
  reset,
  hasUserConsent,
  trackBannerShown,
  ConsentError,
} from '../src/index';
import type { ConsentPreferences } from '../src/index';
import { MMKV, __resetAllStores } from 'react-native-mmkv';
import { STORAGE_KEYS } from '../src/storage/keys';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, '../__tests__/fixtures/test-config.json'),
  'utf-8',
);

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

describe('Public API — end to end', () => {
  beforeEach(() => {
    __resetAllStores();
    reset();
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-exports the full documented public surface', () => {
    // Guards against an accidental drop from src/index.ts's re-export list.
    expect(typeof initialize).toBe('function');
    expect(typeof needsConsent).toBe('function');
    expect(typeof isCategoryEnabled).toBe('function');
    expect(typeof getPreferences).toBe('function');
    expect(typeof getConfig).toBe('function');
    expect(typeof savePreferences).toBe('function');
    expect(typeof acceptAll).toBe('function');
    expect(typeof onConsentChanged).toBe('function');
    expect(typeof reset).toBe('function');
    expect(typeof hasUserConsent).toBe('function');
    expect(typeof trackBannerShown).toBe('function');
    expect(ConsentError).toBeDefined();
  });

  it('guards before initialize(): synchronous reads throw ConsentError', () => {
    expect(() => isCategoryEnabled('dg-category-essential')).toThrow(ConsentError);
    expect(() => needsConsent()).toThrow(ConsentError);
    expect(getConfig()).toBeNull();
  });

  it('runs a full consumer flow: init → banner → accept → persist → restart', async () => {
    const bannerConfig = JSON.parse(testConfigJson);
    bannerConfig.showBanner = true;
    mockFetchSuccess(JSON.stringify(bannerConfig));
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    expect(getConfig()).not.toBeNull();
    expect(hasUserConsent()).toBe(false);

    // A brand-new user with a banner-enabled config needs to consent.
    expect(needsConsent()).toBe(true);

    // Track the impression — this generates & persists the consent ID.
    mockFetchSuccess('');
    await trackBannerShown();
    const openUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    const consentId = new URL(openUrl).searchParams.get('consent_id');

    // Regression guard: the consent ID must be a valid RFC 4122 v4 UUID,
    // produced by the in-package generator (the old `uuid` dep broke Metro
    // bundling for consumers on RN 0.76).
    expect(consentId).toMatch(UUID_V4_RE);

    // User accepts all.
    mockFetchSuccess('');
    const listener = jest.fn();
    const unsubscribe = onConsentChanged(listener);
    await acceptAll();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasUserConsent()).toBe(true);
    expect(needsConsent()).toBe(false);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
    expect(getPreferences()!.cookieOptions.every((o) => o.isEnabled)).toBe(true);

    unsubscribe();

    // Simulate an app restart: a fresh initialize() over the same MMKV-backed
    // storage must keep the user's consent and the same consent ID.
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });
    expect(hasUserConsent()).toBe(true);

    mockFetchSuccess('');
    await trackBannerShown();
    const secondOpenUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(new URL(secondOpenUrl).searchParams.get('consent_id')).toBe(consentId);
  });

  it('persists a single stable consent ID in MMKV under the native key', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });
    mockFetchSuccess('');
    await trackBannerShown();

    const store = new MMKV({ id: 'datagrail-consent' });
    const storedId = store.getString(STORAGE_KEYS.UNIQUE_ID);
    expect(storedId).toMatch(UUID_V4_RE);
  });

  it('honors a user who customizes and rejects a category', async () => {
    mockFetchSuccess();
    await initialize({ configUrl: 'https://cdn.example.com/config.json' });

    mockFetchSuccess('');
    const prefs: ConsentPreferences = {
      isCustomised: true,
      cookieOptions: [
        { gtmKey: 'dg-category-essential', isEnabled: true },
        { gtmKey: 'dg-category-marketing', isEnabled: false },
      ],
    };
    await savePreferences(prefs);

    expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    expect(getPreferences()).toEqual(prefs);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/save_preferences'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
