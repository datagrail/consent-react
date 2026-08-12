import * as fs from 'fs';
import * as path from 'path';
import { __resetAllStores } from 'react-native-mmkv';

const USER_HASH = '1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4';
const mockComputeUserHash = jest.fn<Promise<string>, [string, string, string]>();

jest.mock('../../src/universal/userHash', () => ({
  computeUserHash: (customerId: string, projectId: string, identifier: string) =>
    mockComputeUserHash(customerId, projectId, identifier),
}));

const mockReadTrackingSignal = jest.fn<string, []>();

jest.mock('../../src/platform/trackingSignal', () => ({
  readTrackingSignal: () => mockReadTrackingSignal(),
}));

import {
  initialize,
  reset,
  needsConsent,
  hasUserConsent,
  isCategoryEnabled,
  getPreferences,
  getCategories,
  onConsentChanged,
  savePreferences,
  isUniversalConsentEnabled,
  fetchUniversalConsent,
  rehydrateFromUniversalConsent,
  setUserIdentifier,
} from '../../src/ConsentManager';
import type { ConsentPreferences } from '../../src/types';

const baseConfigJson = fs.readFileSync(
  path.join(__dirname, '../fixtures/test-config.json'),
  'utf-8',
);
const universalConfigJson = fs.readFileSync(
  path.join(__dirname, '../fixtures/test-config-universal.json'),
  'utf-8',
);

const API_KEY = 'api-key-123';
const SIGNATURE = { signature: 'deadbeef', keyId: 'key-1', timestamp: 1_700_000_000 };
const getSignature = jest.fn().mockResolvedValue(SIGNATURE);

/** A `{ gtmKey: isEnabled }` view of the persisted preferences, for concise assertions. */
function persistedMap(): Record<string, boolean> {
  const prefs = getPreferences();
  const map: Record<string, boolean> = {};
  for (const opt of prefs?.cookieOptions ?? []) map[opt.gtmKey] = opt.isEnabled;
  return map;
}

function response(status: number, data: string) {
  return {
    status,
    text: () => Promise.resolve(data),
    headers: { forEach: () => undefined },
  };
}

/**
 * Serve the config from the first fetch (the one `initialize` makes) and a caller-supplied
 * sequence from subsequent fetches, so a test can drive the Universal Consent read and write
 * independently of initialization.
 */
function mockFetchSequence(configJson: string, ...rest: ReturnType<typeof response>[]) {
  let call = 0;
  const mock = jest.fn().mockImplementation(() => {
    const index = call++;
    if (index === 0) return Promise.resolve(response(200, configJson));
    const next = rest[index - 1];
    // Default to an empty 200 so a write with no explicit stub still succeeds.
    return Promise.resolve(next ?? response(200, ''));
  });
  global.fetch = mock;
  return mock;
}

function found(overrides: Record<string, unknown> = {}) {
  return response(
    200,
    JSON.stringify({
      status: 'found',
      consent_preferences: {
        isCustomised: true,
        cookieOptions: {
          'dg-category-essential': true,
          'dg-category-marketing': true,
          'dg-category-performance': true,
          'dg-category-functional': true,
        },
      },
      consent_mode: 'optout',
      ccpa_optout: false,
      platform: 'web',
      policy_name: 'CPRA',
      config_version: 'v-remote',
      updated_at: '2026-01-01T00:00:00Z',
      gpc: false,
      tcf_string: null,
      gpp_string: null,
      ...overrides,
    }),
  );
}

const notFound = () => response(200, JSON.stringify({ status: 'not_found' }));

async function initUniversal() {
  await initialize({ configUrl: 'https://cdn.example.com/config.json' });
}

describe('ConsentManager — Universal Consent', () => {
  beforeEach(() => {
    __resetAllStores();
    reset();
    jest.clearAllMocks();
    mockComputeUserHash.mockResolvedValue(USER_HASH);
    // The default: no signal, so nothing is suppressed unless a test says otherwise.
    mockReadTrackingSignal.mockReturnValue('notDetermined');
    getSignature.mockResolvedValue(SIGNATURE);
  });

  describe('isUniversalConsentEnabled', () => {
    it('returns false before initialization', () => {
      expect(isUniversalConsentEnabled()).toBe(false);
    });

    it('returns false for a config published without universal consent', async () => {
      mockFetchSequence(baseConfigJson);
      await initUniversal();

      expect(isUniversalConsentEnabled()).toBe(false);
    });

    it('returns true when the config enables it', async () => {
      mockFetchSequence(universalConfigJson);
      await initUniversal();

      expect(isUniversalConsentEnabled()).toBe(true);
    });
  });

  describe('gating', () => {
    it('fetch throws NOT_INITIALIZED before initialize', async () => {
      await expect(fetchUniversalConsent('user@example.com', API_KEY)).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('fetch throws VALIDATION_ERROR when the feature is disabled', async () => {
      mockFetchSequence(baseConfigJson);
      await initUniversal();

      await expect(fetchUniversalConsent('user@example.com', API_KEY)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('setUserIdentifier throws VALIDATION_ERROR when the feature is disabled', async () => {
      mockFetchSequence(baseConfigJson);
      await initUniversal();

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('fetchUniversalConsent', () => {
    it('returns the record without touching local state', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();
      const before = persistedMap();

      const record = await fetchUniversalConsent('user@example.com', API_KEY);

      expect(record?.status).toBe('found');
      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(true);
      // Inspecting is not applying.
      expect(persistedMap()).toEqual(before);
      expect(hasUserConsent()).toBe(false);
    });

    it('returns null on a miss', async () => {
      mockFetchSequence(universalConfigJson, notFound());
      await initUniversal();

      await expect(fetchUniversalConsent('user@example.com', API_KEY)).resolves.toBeNull();
    });

    it('suppresses non-essential categories when the record carries GPC', async () => {
      // React Native has no GPC of its own. A GPC recorded on the web reaches the device only
      // through the record's stored `gpc` field, so it has to be honored on read.
      mockFetchSequence(universalConfigJson, found({ gpc: true }));
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY);

      expect(record?.consentPreferences?.cookieOptions).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
        'dg-category-performance': false,
        'dg-category-functional': false,
      });
    });

    it('suppresses non-essential categories when the device signal is denied', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY, 'denied');

      expect(record?.consentPreferences?.cookieOptions).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
        'dg-category-performance': false,
        'dg-category-functional': false,
      });
    });

    it('suppresses when the device signal is restricted', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY, 'restricted');

      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('does not suppress when the device signal is authorized', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY, 'authorized');

      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(true);
    });

    it('does not suppress when the device signal is undetermined', async () => {
      // An unread signal is not a choice. Degrading to a blanket opt-out would fabricate one.
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY, 'notDetermined');

      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(true);
    });

    it('an authorized device signal cannot re-enable what stored GPC suppressed', async () => {
      // Suppression is one-directional and the more privacy-protective signal wins.
      mockFetchSequence(universalConfigJson, found({ gpc: true }));
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY, 'authorized');

      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('reads the device signal itself when the caller does not pass one', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();
      mockReadTrackingSignal.mockReturnValue('denied');

      const record = await fetchUniversalConsent('user@example.com', API_KEY);

      expect(mockReadTrackingSignal).toHaveBeenCalled();
      expect(record?.consentPreferences?.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('returns a record whose preferences are null without throwing', async () => {
      mockFetchSequence(universalConfigJson, found({ consent_preferences: null }));
      await initUniversal();

      const record = await fetchUniversalConsent('user@example.com', API_KEY);

      expect(record?.status).toBe('found');
      expect(record?.consentPreferences).toBeNull();
    });
  });

  describe('rehydrateFromUniversalConsent', () => {
    it('applies the stored record to local state and suppresses the banner', async () => {
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(JSON.stringify(bannerConfig), found());
      await initUniversal();
      expect(needsConsent()).toBe(true);

      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(true);

      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
      expect(hasUserConsent()).toBe(true);
      // The whole point: someone who already answered on another device is not re-prompted.
      expect(needsConsent()).toBe(false);
    });

    it('marks the rehydrated state as customised', async () => {
      mockFetchSequence(
        universalConfigJson,
        found({
          consent_preferences: {
            isCustomised: false,
            cookieOptions: { 'dg-category-essential': true },
          },
        }),
      );
      await initUniversal();

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(getPreferences()?.isCustomised).toBe(true);
    });

    it('stamps the current config version, not the record’s', async () => {
      // Carrying the writing device's version over would fail needsConsent()'s version check and
      // re-prompt immediately, undoing the rehydration.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(JSON.stringify(bannerConfig), found({ config_version: 'stale-version' }));
      await initUniversal();

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(needsConsent()).toBe(false);
    });

    it('emits a consent-change event with the applied preferences', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();
      const listener = jest.fn();
      onConsentChanged(listener);

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(listener).toHaveBeenCalledTimes(1);
      const emitted = listener.mock.calls[0][0] as ConsentPreferences;
      expect(emitted.cookieOptions).toContainEqual({
        gtmKey: 'dg-category-marketing',
        isEnabled: true,
      });
    });

    it('applies a stored opt-out over a more permissive local state', async () => {
      // A found record is authoritative in BOTH directions of disagreement.
      mockFetchSequence(
        universalConfigJson,
        found({
          consent_preferences: {
            isCustomised: true,
            cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
          },
        }),
      );
      await initUniversal();
      // Locally everything is on (the fixture's initial categories include marketing).
      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('applies a stored opt-in over a more restrictive local state', async () => {
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(
        JSON.stringify(bannerConfig),
        response(200, ''), // the rejectAll write
        found(),
      );
      await initUniversal();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      });
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
    });

    it('writes nothing on a miss and leaves the banner showing', async () => {
      // "No record" is the absence of a signal, not a denial. Persisting one would both
      // fabricate a choice and hide the banner meant to collect it.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(JSON.stringify(bannerConfig), notFound());
      await initUniversal();

      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(false);

      expect(hasUserConsent()).toBe(false);
      expect(needsConsent()).toBe(true);
    });

    it('writes nothing when the stored cookie options map is empty', async () => {
      // An empty map carries no category state. Saving it would read back as a blanket opt-out
      // (isCategoryEnabled defaults unknown keys to false) while also hiding the banner.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(
        JSON.stringify(bannerConfig),
        found({ consent_preferences: { isCustomised: true, cookieOptions: {} } }),
      );
      await initUniversal();

      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(false);

      expect(hasUserConsent()).toBe(false);
      expect(needsConsent()).toBe(true);
    });

    it('persists the signal-suppressed state, not the raw stored state', async () => {
      mockFetchSequence(universalConfigJson, found({ gpc: true }));
      await initUniversal();

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(persistedMap()).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
        'dg-category-performance': false,
        'dg-category-functional': false,
      });
    });
  });

  describe('setUserIdentifier', () => {
    it('reads before it writes', async () => {
      const fetchMock = mockFetchSequence(universalConfigJson, found(), response(200, ''));
      await initUniversal();

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const methods = fetchMock.mock.calls
        .slice(1)
        .map((call) => (call[1] as { method: string }).method);
      expect(methods).toEqual(['GET', 'POST']);
    });

    it('writes the rehydrated state rather than clobbering the record with local defaults', async () => {
      // A fresh install with no local preferences must not overwrite the richer record the same
      // person built up on another device.
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        found({
          consent_preferences: {
            isCustomised: true,
            cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
          },
        }),
        response(200, ''),
      );
      await initUniversal();

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const body = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('still writes when the read fails', async () => {
      // Someone who just answered the banner needs their choice saved even if the read broke.
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        response(500, 'gateway error'),
        response(200, ''),
      );
      await initUniversal();

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).resolves.toBeUndefined();

      expect((fetchMock.mock.calls[2][1] as { method: string }).method).toBe('POST');
    });

    it('does not write when the identifier is empty after normalization', async () => {
      // The write would fail the same way, so failing fast beats a confusing second error.
      const fetchMock = mockFetchSequence(universalConfigJson);
      await initUniversal();
      mockComputeUserHash.mockRejectedValue(
        Object.assign(new Error('empty'), { code: 'VALIDATION_ERROR' }),
      );

      await expect(
        setUserIdentifier('   ', { apiKey: API_KEY, getSignature }),
      ).rejects.toBeDefined();

      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as { method: string }).method === 'POST',
      );
      expect(posts).toHaveLength(0);
    });

    it('suppresses non-essential categories in the written state when the signal is denied', async () => {
      const fetchMock = mockFetchSequence(universalConfigJson, notFound(), response(200, ''));
      await initUniversal();

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      const body = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
      // Every category the config knows about is written, not just the initially-enabled ones —
      // `dg-category-mystery-category` comes from the consent layers rather than `initial`.
      expect(body.consent_preferences.cookieOptions).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
        'dg-category-performance': false,
        'dg-category-functional': false,
        'dg-category-mystery-category': false,
      });
    });

    it('writes the local state unchanged when no signal applies', async () => {
      const fetchMock = mockFetchSequence(universalConfigJson, notFound(), response(200, ''));
      await initUniversal();

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'authorized',
      });

      const body = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(true);
    });

    it('never derives ccpa_optout from the device tracking signal', async () => {
      // The ad-tracking signal is narrower than a CCPA do-not-sell choice. Treating one as the
      // other would record a legal opt-out the user never made.
      const fetchMock = mockFetchSequence(universalConfigJson, notFound(), response(200, ''));
      await initUniversal();

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      const body = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
      expect(body.ccpa_optout).toBe(false);
    });

    it('reads the device signal itself when the caller does not pass one', async () => {
      const fetchMock = mockFetchSequence(universalConfigJson, notFound(), response(200, ''));
      await initUniversal();
      mockReadTrackingSignal.mockReturnValue('denied');

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const body = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('propagates a write failure', async () => {
      mockFetchSequence(universalConfigJson, notFound(), response(403, 'bad signature'));
      await initUniversal();

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });

  describe('reset', () => {
    it('disables universal consent until the next initialize', async () => {
      mockFetchSequence(universalConfigJson);
      await initUniversal();
      expect(isUniversalConsentEnabled()).toBe(true);

      reset();

      expect(isUniversalConsentEnabled()).toBe(false);
      await expect(fetchUniversalConsent('user@example.com', API_KEY)).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('getCategories after rehydration', () => {
    it('reflects the rehydrated state', async () => {
      mockFetchSequence(universalConfigJson, found({ gpc: true }));
      await initUniversal();

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      const map: Record<string, boolean> = {};
      for (const opt of getCategories()!.cookieOptions) map[opt.gtmKey] = opt.isEnabled;
      expect(map['dg-category-marketing']).toBe(false);
      expect(map['dg-category-essential']).toBe(true);
    });
  });
});
