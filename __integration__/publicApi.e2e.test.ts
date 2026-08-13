/**
 * End-to-end test through the SDK's public entry point (`src/index`).
 *
 * Unlike lifecycle.test.ts (which imports from ConsentManager directly), this
 * exercises the module surface exactly as a customer app consumes it — every
 * assertion here is a guarantee we make to integrators. It also guards the
 * consent-ID generation path (formerly backed by the ESM-only `uuid` package,
 * now by the in-package RFC 4122 v4 generator) end to end.
 */
import { NativeModules } from 'react-native';

// Stubbed before importing src/index so the Universal Consent hash path resolves. The real
// module computes the hash natively (Hermes has neither SHA-256 nor dependable NFC), so a
// JS-only test environment has to stand in for it — the canonical vector below is the contract
// the native modules are held to.
const USER_HASH = '1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4';
NativeModules.DataGrailConsentCrypto = {
  computeUserHash: () => Promise.resolve(USER_HASH),
};

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
  isUniversalConsentEnabled,
  fetchUniversalConsent,
  rehydrateFromUniversalConsent,
  setUserIdentifier,
  ConsentError,
} from '../src/index';
import type { ConsentPreferences, UniversalConsentSignature } from '../src/index';
import { MMKV, __resetAllStores } from 'react-native-mmkv';
import { STORAGE_KEYS } from '../src/storage/keys';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, '../__tests__/fixtures/test-config.json'),
  'utf-8',
);
const universalConfigJson = fs.readFileSync(
  path.join(__dirname, '../__tests__/fixtures/test-config-universal.json'),
  'utf-8',
);

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function mockFetchSuccess(data: string = testConfigJson) {
  const mockHeaders = new Map<string, string>();
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    text: () => Promise.resolve(data),
    headers: {
      forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)),
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
    expect(typeof isUniversalConsentEnabled).toBe('function');
    expect(typeof fetchUniversalConsent).toBe('function');
    expect(typeof rehydrateFromUniversalConsent).toBe('function');
    expect(typeof setUserIdentifier).toBe('function');
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

  describe('Universal Consent', () => {
    const API_KEY = 'api-key-123';
    const getSignature = jest.fn<Promise<UniversalConsentSignature>, [string, string]>();

    /**
     * Serve the config to the first fetch (`initialize`'s) and a caller-supplied sequence
     * afterwards, so the Universal Consent read and write can be driven independently.
     */
    function mockFetchSequence(configJson: string, ...rest: string[]) {
      let call = 0;
      const respond = (data: string) => ({
        status: 200,
        text: () => Promise.resolve(data),
        headers: { forEach: () => undefined },
      });
      global.fetch = jest.fn().mockImplementation(() => {
        const index = call++;
        return Promise.resolve(respond(index === 0 ? configJson : (rest[index - 1] ?? '')));
      });
      return global.fetch as jest.Mock;
    }

    beforeEach(() => {
      getSignature.mockReset();
      getSignature.mockResolvedValue({
        signature: 'deadbeef',
        keyId: 'key-1',
        timestamp: 1_700_000_000,
      });
    });

    it('stays off for a config published without universal consent', async () => {
      mockFetchSuccess();
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      expect(isUniversalConsentEnabled()).toBe(false);
      await expect(fetchUniversalConsent('user@example.com', API_KEY)).rejects.toThrow(
        ConsentError,
      );
    });

    it('carries a choice made on another device onto a fresh install without re-prompting', async () => {
      // The scenario the feature exists for. This install has never shown a banner; the user
      // already answered on the web, opting out of marketing.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(
        JSON.stringify(bannerConfig),
        JSON.stringify({
          status: 'found',
          consent_preferences: {
            isCustomised: true,
            cookieOptions: {
              'dg-category-essential': true,
              'dg-category-marketing': false,
              'dg-category-performance': true,
            },
          },
          consent_mode: 'optout',
          platform: 'web',
          config_version: 'v-from-the-web',
          gpc: false,
        }),
      );

      await initialize({ configUrl: 'https://cdn.example.com/config.json' });
      expect(isUniversalConsentEnabled()).toBe(true);
      // Local state is the config defaults, which have marketing ON — the disagreement the
      // stored record has to win.
      expect(needsConsent()).toBe(true);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);

      const listener = jest.fn();
      const unsubscribe = onConsentChanged(listener);

      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(true);

      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(isCategoryEnabled('dg-category-performance')).toBe(true);
      expect(hasUserConsent()).toBe(true);
      expect(needsConsent()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('leaves the banner up when the user has no stored record', async () => {
      // A miss is "no signal", not a denial — the banner must still collect a choice.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      const miss = JSON.stringify({ status: 'not_found' });
      // Two responses: this test reads twice, once directly and once via rehydrate.
      mockFetchSequence(JSON.stringify(bannerConfig), miss, miss);

      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      await expect(fetchUniversalConsent('user@example.com', API_KEY)).resolves.toBeNull();
      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(false);
      expect(hasUserConsent()).toBe(false);
      expect(needsConsent()).toBe(true);
    });

    it('reads then writes on setUserIdentifier, signing only the write', async () => {
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        JSON.stringify({ status: 'not_found' }),
        '',
      );
      await initialize({ configUrl: 'https://cdn.example.com/config.json' });

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const [readUrl, readInit] = fetchMock.mock.calls[1] as [
        string,
        { method: string; headers: Record<string, string> },
      ];
      const [writeUrl, writeInit] = fetchMock.mock.calls[2] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];

      // No /api/v1/ prefix — /universal_consent is a CloudFront behavior, not a Rails route.
      expect(readUrl).toContain('/universal_consent?');
      expect(readUrl).not.toContain('/api/v1/');
      expect(readInit.method).toBe('GET');
      expect(readInit.headers['X-DG-Api-Key']).toBe(API_KEY);
      // Reads are unsigned.
      expect(readInit.headers).not.toHaveProperty('X-DG-Signature');

      expect(writeUrl).toMatch(/\/universal_consent$/);
      expect(writeInit.method).toBe('POST');
      expect(writeInit.headers['X-DG-Signature']).toBe('deadbeef');
      expect(writeInit.headers['X-DG-Key-Id']).toBe('key-1');
      expect(writeInit.headers['X-DG-Timestamp']).toBe('1700000000');
      expect(writeInit.headers['X-DG-Nonce']).toMatch(UUID_V4_RE);

      // The SDK asks the customer's backend to sign; the shared secret never reaches the device.
      expect(getSignature).toHaveBeenCalledWith('ac46d8ad-a67a-431f-a5d5-9e3eb922dae7', USER_HASH);

      const body = JSON.parse(writeInit.body);
      expect(body.user_hash).toBe(USER_HASH);
      expect(body.platform).toBe('react-native');
      // Map-shaped on the wire, unlike the array-shaped local ConsentPreferences.
      expect(body.consent_preferences.cookieOptions['dg-category-essential']).toBe(true);
    });
  });
});
