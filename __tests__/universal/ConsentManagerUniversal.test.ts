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
  clearUserIdentifier,
  getConfig,
  setCcpaOptout,
  getCcpaOptout,
  acceptAll,
} from '../../src/ConsentManager';
import { StorageService } from '../../src/storage/StorageService';
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
const SIGNATURE = { signature: 'deadbeef', keyId: 'key-1' };
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

/** Bind the device to an identity, as a prior successful setUserIdentifier would (a re-sync). */
function bindDeviceTo(hash: string) {
  new StorageService().saveBoundUserHash(hash);
}

/** An explicit local choice with every known category, marketing as given. */
function explicitChoice(marketing: boolean): ConsentPreferences {
  return {
    isCustomised: true,
    cookieOptions: [
      { gtmKey: 'dg-category-essential', isEnabled: true },
      { gtmKey: 'dg-category-marketing', isEnabled: marketing },
      { gtmKey: 'dg-category-performance', isEnabled: true },
      { gtmKey: 'dg-category-functional', isEnabled: true },
    ],
  };
}

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

  // TRUST-2603: the edge API key can be delivered via config.json so it rotates server-side with
  // no client release. An explicit param still wins; otherwise the SDK falls back to the config
  // value; with neither present the call fails fast.
  describe('API key delivery via config.json (TRUST-2603)', () => {
    /** Universal config carrying (or omitting) universalConsent.apiKey. */
    const configWithApiKey = (apiKey?: string) => {
      const parsed = JSON.parse(universalConfigJson);
      return JSON.stringify({
        ...parsed,
        universalConsent: {
          ...parsed.universalConsent,
          ...(apiKey ? { apiKey } : {}),
        },
      });
    };

    const apiKeyHeaderOf = (call: unknown[]) =>
      (call[1] as { headers: Record<string, string> }).headers['X-DG-Api-Key'];

    it('falls back to universalConsent.apiKey from config when none is passed', async () => {
      const mock = mockFetchSequence(configWithApiKey('config-key'), notFound());
      await initUniversal();

      await expect(fetchUniversalConsent('user@example.com')).resolves.toBeNull();
      // calls[0] is the config fetch; calls[1] is the GET to /universal_consent.
      expect(apiKeyHeaderOf(mock.mock.calls[1])).toBe('config-key');
    });

    it('prefers an explicit apiKey over the config value', async () => {
      const mock = mockFetchSequence(configWithApiKey('config-key'), notFound());
      await initUniversal();

      await expect(fetchUniversalConsent('user@example.com', 'explicit-key')).resolves.toBeNull();
      expect(apiKeyHeaderOf(mock.mock.calls[1])).toBe('explicit-key');
    });

    it('setUserIdentifier uses the config key when the host omits it', async () => {
      const mock = mockFetchSequence(configWithApiKey('config-key'), notFound());
      await initUniversal();

      await setUserIdentifier('user@example.com', { getSignature });
      expect(apiKeyHeaderOf(mock.mock.calls[1])).toBe('config-key');
    });

    it('throws VALIDATION_ERROR when neither an explicit key nor a config key is present', async () => {
      mockFetchSequence(configWithApiKey(undefined));
      await initUniversal();

      await expect(fetchUniversalConsent('user@example.com')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(setUserIdentifier('user@example.com', { getSignature })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
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
    it('reads then writes the local choice through, in that order', async () => {
      // config fetch + the save_preferences POST that records an explicit local choice.
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      });

      // A found record exists and disagrees (marketing ON), but the write must still carry the
      // user's LOCAL choice — read first, then write. Pre-bound: write-through of a local change
      // over a found record is the RE-SYNC behavior (a login adopts the record instead).
      bindDeviceTo(USER_HASH);
      const uidFetch = jest
        .fn()
        .mockResolvedValueOnce(found())
        .mockResolvedValueOnce(response(200, ''));
      global.fetch = uidFetch;

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const methods = uidFetch.mock.calls.map((call) => (call[1] as { method: string }).method);
      expect(methods).toEqual(['GET', 'POST']);
      // Write-through: the POST carries the LOCAL choice (marketing OFF), not the fetched record.
      const body = JSON.parse((uidFetch.mock.calls[1][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('adopts a found record without re-POSTing it when there is no local change', async () => {
      // A fresh install with no explicit local choice: the found record is adopted into local
      // state, and re-POSTing it would only echo state the edge already holds.
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

      // The record was adopted into local state...
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(needsConsent()).toBe(false);
      // ...but nothing was POSTed: only the config fetch and the universal read (both GET).
      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as { method: string }).method === 'POST',
      );
      expect(posts).toHaveLength(0);
    });

    it('does not write when the read fails, to avoid clobbering a record it could not read', async () => {
      // A read FAILURE is not a read MISS. The server never merges, so a write is a full
      // overwrite — sourcing it from local state (which may be a signal-suppressed view or bare
      // config defaults) over a rich remote record we could not read would silently erase the
      // user's real cross-device choice for every device on their identifier (TRUST-2491). The
      // failure must surface so the caller can retry, which re-reads first.
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        response(500, 'gateway error'),
        response(200, ''),
      );
      await initUniversal();

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toBeDefined();

      const posts = fetchMock.mock.calls.filter(
        (call) => (call[1] as { method: string }).method === 'POST',
      );
      expect(posts).toHaveLength(0);
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

    it('writes the raw local state even when the signal is denied', async () => {
      // The store holds raw choices and the server never merges, so suppressing here would
      // persist this device's transient ATT state as the user's choice — for every device on
      // their identifier. Suppression belongs to the read path.
      // An explicit local choice (only explicit choices are written on a miss).
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        response(200, ''),
        notFound(),
        response(200, ''),
      );
      await initUniversal();
      await savePreferences(explicitChoice(true));

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      const body = JSON.parse((fetchMock.mock.calls[3][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': true,
        'dg-category-performance': true,
        'dg-category-functional': true,
      });
    });

    it('writes the local state unchanged when no signal applies', async () => {
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        response(200, ''),
        notFound(),
        response(200, ''),
      );
      await initUniversal();
      await savePreferences(explicitChoice(true));

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'authorized',
      });

      const body = JSON.parse((fetchMock.mock.calls[3][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(true);
    });

    it('writes the raw local choice, not the fetched record or the signal-suppressed view', async () => {
      // The compounding case. The user has an explicit local opt-in; rehydration then persists a
      // SUPPRESSED view locally. The write must carry the RAW local choice — not the fetched
      // record, and not the suppressed view that getCategories() would read back after rehydrate.
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: true },
        ],
      });

      // The stored record disagrees (marketing OFF) and this device's signal is denied. Pre-bound:
      // this is the RE-SYNC write-through (a login adopts the record and writes nothing).
      bindDeviceTo(USER_HASH);
      const uidFetch = jest
        .fn()
        .mockResolvedValueOnce(
          found({
            consent_preferences: {
              isCustomised: true,
              cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
            },
          }),
        )
        .mockResolvedValueOnce(response(200, ''));
      global.fetch = uidFetch;

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      // The user's real opt-in survives onto the wire — not the record's OFF, not the suppression.
      const body = JSON.parse((uidFetch.mock.calls[1][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(true);
      // ...while local reads still honor the record and this device's signal.
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    });

    it('write-throughs the local choice on a hit rather than re-POSTing the fetched record', async () => {
      // Local opt-out meets a found record that opted IN. The edge resolves cross-device
      // conflicts; the SDK's job is to sync THIS device's current choice, not echo the record.
      // Pre-bound: a RE-SYNC, so the local change is post-login.
      bindDeviceTo(USER_HASH);
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      });

      const uidFetch = jest
        .fn()
        .mockResolvedValueOnce(found())
        .mockResolvedValueOnce(response(200, ''));
      global.fetch = uidFetch;

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const body = JSON.parse((uidFetch.mock.calls[1][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
    });

    it('never derives ccpa_optout from the device tracking signal', async () => {
      // The ad-tracking signal is narrower than a CCPA do-not-sell choice. Treating one as the
      // other would record a legal opt-out the user never made.
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        response(200, ''),
        notFound(),
        response(200, ''),
      );
      await initUniversal();
      await savePreferences(explicitChoice(true));

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      const body = JSON.parse((fetchMock.mock.calls[3][1] as { body: string }).body);
      expect(body.ccpa_optout).toBe(false);
    });

    it('reads the device signal itself when the caller does not pass one', async () => {
      // The signal reaches LOCAL state, never the write — so this asserts on what rehydration
      // persisted rather than on the payload.
      mockFetchSequence(universalConfigJson, found(), response(200, ''));
      await initUniversal();
      mockReadTrackingSignal.mockReturnValue('denied');

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    });

    it('propagates a write failure', async () => {
      mockFetchSequence(
        universalConfigJson,
        response(200, ''),
        notFound(),
        response(403, 'bad signature'),
      );
      await initUniversal();
      await savePreferences(explicitChoice(true));

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });

  describe('identity binding and login attribution (TRUST-2902)', () => {
    const OTHER_HASH = 'b'.repeat(64);

    /** Same MMKV instance ConsentManager uses (the mock shares state by id). */
    const deviceStorage = () => new StorageService();
    const boundHash = () => deviceStorage().loadBoundUserHash();

    function ucPosts(mock: jest.Mock) {
      return mock.mock.calls.filter(
        (call) =>
          (call[1] as { method: string }).method === 'POST' &&
          String(call[0]).includes('/universal_consent'),
      );
    }

    /** Universal config with the banner on, so needsConsent() reflects the consented flag. */
    const bannerConfigJson = JSON.stringify({
      ...JSON.parse(universalConfigJson),
      showBanner: true,
    });

    /** Initialize, then make an explicit local choice (marketing OFF) — pre-login history. */
    async function initWithExplicitChoice() {
      mockFetchSequence(bannerConfigJson, response(200, ''));
      await initUniversal();
      const neutral = persistedMap();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: false },
        ],
      });
      return neutral;
    }

    function stubUcFetch(...responses: ReturnType<typeof response>[]) {
      const mock = jest.fn();
      for (const r of responses) mock.mockResolvedValueOnce(r);
      mock.mockResolvedValue(response(200, ''));
      global.fetch = mock;
      return mock;
    }

    describe('clearUserIdentifier', () => {
      it('clears the binding and returns local reads to the fresh-install default', async () => {
        const neutral = await initWithExplicitChoice();
        stubUcFetch(notFound());
        await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });
        expect(boundHash()).toBe(USER_HASH);
        expect(needsConsent()).toBe(false);

        clearUserIdentifier();

        expect(boundHash()).toBeNull();
        expect(persistedMap()).toEqual(neutral);
        expect(getPreferences()?.isCustomised).toBe(false);
        expect(hasUserConsent()).toBe(false);
        expect(needsConsent()).toBe(true);
      });

      it('is non-destructive: keeps unique id, config, pending queue; stays initialized; no network', async () => {
        await initWithExplicitChoice();
        const storage = deviceStorage();
        const uniqueId = storage.getOrCreateUniqueId();
        storage.savePendingEvents([{ queued: true }]);
        const config = getConfig();
        const fetchMock = stubUcFetch();

        clearUserIdentifier();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(storage.getOrCreateUniqueId()).toBe(uniqueId);
        expect(storage.loadPendingEvents()).toEqual([{ queued: true }]);
        expect(storage.loadConfigVersion()).toBe(config!.version);
        expect(getConfig()).toBe(config);
        expect(isUniversalConsentEnabled()).toBe(true);
        // Still initialized: guarded reads do not throw.
        expect(() => isCategoryEnabled('dg-category-essential')).not.toThrow();
      });

      it('fires the consent-changed listener with the now-effective defaults', async () => {
        const neutral = await initWithExplicitChoice();
        const listener = jest.fn();
        onConsentChanged(listener);

        clearUserIdentifier();

        expect(listener).toHaveBeenCalledTimes(1);
        const emitted: Record<string, boolean> = {};
        for (const opt of (listener.mock.calls[0][0] as ConsentPreferences).cookieOptions) {
          emitted[opt.gtmKey] = opt.isEnabled;
        }
        expect(emitted).toEqual(neutral);
      });

      it('is idempotent and safe when unbound or before initialize', async () => {
        expect(() => clearUserIdentifier()).not.toThrow();
        await initWithExplicitChoice();
        clearUserIdentifier();
        clearUserIdentifier();
        expect(boundHash()).toBeNull();
        expect(needsConsent()).toBe(true);
      });
    });

    it('login + record exists + explicit local choice: no POST, record adopted, bound', async () => {
      await initWithExplicitChoice();
      const fetchMock = stubUcFetch(found());

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(getSignature).not.toHaveBeenCalled();
      // The record (marketing ON) replaced the pre-login choice (marketing OFF).
      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
      expect(needsConsent()).toBe(false);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('login + subset record REPLACES local: an unmentioned category takes its config default', async () => {
      mockFetchSequence(bannerConfigJson, response(200, ''));
      await initUniversal();
      const defaults = persistedMap();
      // An explicit local choice that differs from the default on performance, which the record
      // below does not mention.
      expect(defaults['dg-category-performance']).toBe(true);
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: true },
          { gtmKey: 'dg-category-performance', isEnabled: false },
          { gtmKey: 'dg-category-functional', isEnabled: false },
        ],
      });
      const fetchMock = stubUcFetch(
        found({
          consent_preferences: {
            isCustomised: true,
            cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
          },
        }),
      );
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      // Record-carried category: the record's value.
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      // Unmentioned categories: the config default, not the prior local value.
      expect(isCategoryEnabled('dg-category-performance')).toBe(
        defaults['dg-category-performance'],
      );
      expect(isCategoryEnabled('dg-category-functional')).toBe(defaults['dg-category-functional']);
      expect(persistedMap()).toEqual({ ...defaults, 'dg-category-marketing': false });
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('login + found record with no consent choice + explicit local: neutral, no POST', async () => {
      const neutral = await initWithExplicitChoice();
      const fetchMock = stubUcFetch(found({ consent_preferences: null }));
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(persistedMap()).toEqual(neutral);
      expect(hasUserConsent()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('login + found record with no consent choice + neutral local: no-op, no listener, no POST', async () => {
      const fetchMock = mockFetchSequence(
        bannerConfigJson,
        found({ consent_preferences: { isCustomised: true, cookieOptions: {} } }),
      );
      await initUniversal();
      const before = getPreferences();
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(getPreferences()).toEqual(before);
      expect(listener).not.toHaveBeenCalled();
      expect(boundHash()).toBe(USER_HASH);
    });

    it("re-sync + subset record keeps today's adopt (no neutral fill)", async () => {
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
      bindDeviceTo(USER_HASH);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(persistedMap()).toEqual({
        'dg-category-essential': true,
        'dg-category-marketing': false,
      });
    });

    it('login + record exists + no local choice: no POST, record adopted, bound', async () => {
      const fetchMock = mockFetchSequence(
        universalConfigJson,
        found({
          consent_preferences: {
            isCustomised: true,
            cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
          },
        }),
      );
      await initUniversal();

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(hasUserConsent()).toBe(true);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('login + no record + explicit local choice: POSTs the raw local choice, bound', async () => {
      await initWithExplicitChoice();
      const fetchMock = stubUcFetch(notFound());

      await setUserIdentifier('user@example.com', {
        apiKey: API_KEY,
        getSignature,
        trackingSignal: 'denied',
      });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      const body = JSON.parse((posts[0][1] as { body: string }).body);
      expect(body.consent_preferences).toEqual({
        isCustomised: true,
        cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
      });
      expect(hasUserConsent()).toBe(true);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('login + no record + defaults-only local: no POST, local unchanged, bound', async () => {
      const fetchMock = mockFetchSequence(bannerConfigJson, notFound());
      await initUniversal();
      const before = getPreferences();
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(getSignature).not.toHaveBeenCalled();
      expect(getPreferences()).toEqual(before);
      expect(hasUserConsent()).toBe(false);
      expect(needsConsent()).toBe(true);
      expect(listener).not.toHaveBeenCalled();
      expect(boundHash()).toBe(USER_HASH);
    });

    it('already bound to this identity + miss + explicit choice: still syncs (sync-on-change)', async () => {
      await initWithExplicitChoice();
      deviceStorage().saveBoundUserHash(USER_HASH);
      const fetchMock = stubUcFetch(notFound());

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      const body = JSON.parse((posts[0][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('bound to user A, setUserIdentifier(B) misses with A local state: no POST, local neutral', async () => {
      mockComputeUserHash.mockImplementation((_c, _p, id) =>
        Promise.resolve(id === 'b@example.com' ? OTHER_HASH : USER_HASH),
      );
      const neutral = await initWithExplicitChoice();
      deviceStorage().saveBoundUserHash(USER_HASH);
      const fetchMock = stubUcFetch(notFound());
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('b@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(persistedMap()).toEqual(neutral);
      expect(hasUserConsent()).toBe(false);
      expect(needsConsent()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(boundHash()).toBe(OTHER_HASH);
    });

    it('re-sync + record exists + local change: writes the local choice through', async () => {
      await initWithExplicitChoice();
      bindDeviceTo(USER_HASH);
      const fetchMock = stubUcFetch(found());

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      const body = JSON.parse((posts[0][1] as { body: string }).body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('re-sync + no record + defaults-only local: writes nothing (defaults are never seeded)', async () => {
      const fetchMock = mockFetchSequence(universalConfigJson, notFound());
      await initUniversal();
      bindDeviceTo(USER_HASH);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(boundHash()).toBe(USER_HASH);
    });

    it('leaves the binding unchanged on a read failure', async () => {
      await initWithExplicitChoice();
      deviceStorage().saveBoundUserHash(OTHER_HASH);
      stubUcFetch(response(500, 'gateway error'));

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toBeDefined();

      expect(boundHash()).toBe(OTHER_HASH);
      // The local choice is untouched too.
      expect(hasUserConsent()).toBe(true);
    });

    it('does not bind when the write fails, so a retry is still a transition', async () => {
      await initWithExplicitChoice();
      stubUcFetch(notFound(), response(403, 'bad signature'));

      await expect(
        setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

      expect(boundHash()).toBeNull();
    });

    it('reset() clears the binding', async () => {
      mockFetchSequence(universalConfigJson, found(), response(200, ''));
      await initUniversal();
      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });
      expect(boundHash()).toBe(USER_HASH);

      reset();

      expect(boundHash()).toBeNull();
    });

    it('rehydrate alone does not bind', async () => {
      mockFetchSequence(universalConfigJson, found());
      await initUniversal();

      await rehydrateFromUniversalConsent('user@example.com', API_KEY);

      expect(boundHash()).toBeNull();
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
  describe('ccpa_optout (TRUST-2591)', () => {
    const OTHER_HASH = 'c'.repeat(64);
    const ID = 'user@example.com';
    const deviceStorage = () => new StorageService();

    /** Universal config with the sync_optout gate as given. */
    const configWithGate = (syncOptout: boolean) => {
      const parsed = JSON.parse(universalConfigJson);
      return JSON.stringify({
        ...parsed,
        universalConsent: { ...parsed.universalConsent, sync_optout: syncOptout },
      });
    };

    function ucPosts(mock: jest.Mock) {
      return mock.mock.calls.filter(
        (call) =>
          (call[1] as { method: string }).method === 'POST' &&
          String(call[0]).includes('/universal_consent'),
      );
    }

    function postBody(call: unknown[]) {
      return JSON.parse((call[1] as { body: string }).body);
    }

    /** Init, then replace fetch with a stub serving `responses` in order (default empty 200). */
    async function initThenStub(configJson: string, ...responses: ReturnType<typeof response>[]) {
      mockFetchSequence(configJson);
      await initUniversal();
      const mock = jest.fn();
      for (const r of responses) {
        mock.mockResolvedValueOnce(r);
      }
      mock.mockResolvedValue(response(200, ''));
      global.fetch = mock;
      return mock;
    }

    describe('setCcpaOptout / getCcpaOptout', () => {
      it('defaults to false and persists the setter value', async () => {
        await initThenStub(configWithGate(true));
        expect(getCcpaOptout()).toBe(false);

        await setCcpaOptout(true);
        expect(getCcpaOptout()).toBe(true);
        expect(deviceStorage().loadCcpaOptout()).toBe(true);

        await setCcpaOptout(false);
        expect(getCcpaOptout()).toBe(false);
      });

      it('changes no category, consent flag or listener', async () => {
        await initThenStub(configWithGate(true));
        const before = persistedMap();
        const listener = jest.fn();
        onConsentChanged(listener);

        await setCcpaOptout(true);

        expect(persistedMap()).toEqual(before);
        expect(hasUserConsent()).toBe(false);
        expect(listener).not.toHaveBeenCalled();
      });

      it('throws before initialize', async () => {
        await expect(setCcpaOptout(true)).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
        expect(() => getCcpaOptout()).toThrow();
      });

      it('writes through when bound, gate on and an explicit choice exists: POST carries true', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        const body = postBody(posts[0]);
        expect(body.ccpa_optout).toBe(true);
        // The current RAW local categories ride along unchanged.
        expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(true);
        expect(getSignature).toHaveBeenCalledTimes(1);
      });

      it('propagates a write-through failure and keeps the local flag', async () => {
        await initThenStub(configWithGate(true), response(200, ''), response(500, 'boom'));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await expect(
          setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature }),
        ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        expect(getCcpaOptout()).toBe(true);
      });

      it('is local only when the device is unbound', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });

      it('is local only when bound to a different identity', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(OTHER_HASH);

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
      });

      it('is local only when the sync_optout gate is off', async () => {
        const fetchMock = await initThenStub(configWithGate(false));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });

      it('is local only without sync credentials', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await setCcpaOptout(true);

        expect(ucPosts(fetchMock)).toHaveLength(0);
      });

      it('never seeds config defaults: bound with no explicit category choice stays local', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        bindDeviceTo(USER_HASH);

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });
    });

    describe('wire field', () => {
      it('is false when the gate is off even if the local flag is true', async () => {
        const fetchMock = await initThenStub(configWithGate(false), response(200, ''), notFound());
        await savePreferences(explicitChoice(true));
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(false);
      });

      it('is never derived from marketing rejection or a denied tracking signal', async () => {
        const fetchMock = await initThenStub(configWithGate(true), response(200, ''), notFound());
        await savePreferences(explicitChoice(false));

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature, trackingSignal: 'denied' });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(false);
        expect(getCcpaOptout()).toBe(false);
      });

      it('re-sync write-through carries the local flag, not the record value', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          response(200, ''),
          found({ ccpa_optout: false }),
        );
        await savePreferences(explicitChoice(false));
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(true);
        expect(getCcpaOptout()).toBe(true);
      });

      it('re-sync adopt takes the record value when the gate is on', async () => {
        const fetchMock = await initThenStub(configWithGate(true), found({ ccpa_optout: true }));
        bindDeviceTo(USER_HASH);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });

      it('re-sync adopt keeps a local-only flag when the gate is off', async () => {
        const fetchMock = await initThenStub(configWithGate(false), found({ ccpa_optout: false }));
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });
    });

    describe('login (TRUST-2902 rule)', () => {
      it('found record: local flag := record value, no POST, pre-login true dropped', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          response(200, ''),
          found({ ccpa_optout: false }),
        );
        await savePreferences(explicitChoice(true));
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(false);
      });

      it('found record carrying ccpa_optout true is adopted', async () => {
        await initThenStub(configWithGate(true), found({ ccpa_optout: true }));

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(getCcpaOptout()).toBe(true);
      });

      it('found record with no consent choice still replaces the local flag', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          found({ consent_preferences: null, ccpa_optout: false }),
        );
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(false);
      });

      it('miss + explicit category choice + local true: POST carries ccpa_optout true', async () => {
        const fetchMock = await initThenStub(configWithGate(true), response(200, ''), notFound());
        await acceptAll();
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(true);
        expect(deviceStorage().loadBoundUserHash()).toBe(USER_HASH);
      });

      it('miss + only a ccpa setter call: no POST, flag stays local', async () => {
        const fetchMock = await initThenStub(configWithGate(true), notFound());
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
        expect(hasUserConsent()).toBe(false);
      });

      it('miss while bound to another identity: neutral reset clears the flag', async () => {
        const fetchMock = await initThenStub(configWithGate(true), notFound());
        bindDeviceTo(OTHER_HASH);
        await setCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(false);
      });
    });

    it('rehydrateFromUniversalConsent adopts the record value', async () => {
      await initThenStub(configWithGate(true), found({ ccpa_optout: true }));

      await rehydrateFromUniversalConsent(ID, API_KEY);

      expect(getCcpaOptout()).toBe(true);
    });

    it('clearUserIdentifier returns the flag to false', async () => {
      await initThenStub(configWithGate(true));
      await setCcpaOptout(true);

      clearUserIdentifier();

      expect(getCcpaOptout()).toBe(false);
    });

    it('clearUserIdentifier clears the flag while the SDK is not initialized', async () => {
      await initThenStub(configWithGate(true));
      reset();
      deviceStorage().saveCcpaOptout(true);

      clearUserIdentifier();

      expect(deviceStorage().loadCcpaOptout()).toBe(false);
    });

    it('reset wipes the flag', async () => {
      await initThenStub(configWithGate(true));
      await setCcpaOptout(true);

      reset();

      expect(deviceStorage().loadCcpaOptout()).toBe(false);
    });
  });
});
