import * as fs from 'fs';
import * as path from 'path';
import { __resetAllStores } from 'react-native-mmkv';

const USER_HASH = '1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4';
// An opaque customer-side identifier, for tests that don't need USER_HASH's identity.
const OPAQUE_ID = 'cust-7f3a9c2e41b8';
const mockComputeUserHash = jest.fn<Promise<string>, [string, string, string]>();

jest.mock('../../src/universal/userHash', () => ({
  computeUserHash: (customerId: string, projectId: string, identifier: string) =>
    mockComputeUserHash(customerId, projectId, identifier),
}));

// Stand in for the native SHA-256 bridge with node's own SHA-256 (same standard digest) so the
// write signing path — which now folds a provenance sub-digest into stringToSign — resolves in a
// JS-only test environment instead of hitting the unlinked native module.
jest.mock('../../src/universal/sha256', () => ({
  sha256Hex: (input: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Promise.resolve(require('crypto').createHash('sha256').update(input, 'utf8').digest('hex')),
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
  rejectAll,
  decideIdentityBind,
  saveTrackingAuthorizationPreferences,
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

    it('treats an empty explicit key as absent and uses the config key', async () => {
      const mock = mockFetchSequence(configWithApiKey('config-key'), notFound());
      await initUniversal();

      await expect(fetchUniversalConsent(OPAQUE_ID, '')).resolves.toBeNull();
      expect(apiKeyHeaderOf(mock.mock.calls[1])).toBe('config-key');
    });

    it('setUserIdentifier uses the config key when the host omits it', async () => {
      const mock = mockFetchSequence(configWithApiKey('config-key'), notFound());
      await initUniversal();

      await setUserIdentifier('user@example.com', { getSignature });
      expect(apiKeyHeaderOf(mock.mock.calls[1])).toBe('config-key');
    });

    it('ignores a non-string config apiKey, failing with VALIDATION_ERROR rather than sending it', async () => {
      const parsed = JSON.parse(universalConfigJson);
      mockFetchSequence(
        JSON.stringify({
          ...parsed,
          universalConsent: { ...parsed.universalConsent, apiKey: 12345 },
        }),
      );
      await initUniversal();

      expect(getConfig()?.universalConsent?.apiKey).toBeUndefined();
      await expect(fetchUniversalConsent(OPAQUE_ID)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
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

    it('rehydrates a present but empty cookie options map as an answered essential-only choice', async () => {
      // TRUST-2961: a PRESENT consent_preferences block whose cookieOptions map is empty is an
      // answered essential-only choice — the user accepted only always-on categories. It must
      // rehydrate and suppress the banner, exactly as iOS and web already do. Collapsing it into a
      // "no choice" miss would re-prompt a user who already answered elsewhere.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(
        JSON.stringify(bannerConfig),
        found({ consent_preferences: { isCustomised: true, cookieOptions: {} } }),
      );
      await initUniversal();

      await expect(rehydrateFromUniversalConsent('user@example.com', API_KEY)).resolves.toBe(true);

      // The answered choice is persisted, so the banner does not re-prompt.
      expect(hasUserConsent()).toBe(true);
      expect(needsConsent()).toBe(false);
      // Essential-only: essential reads on, never a blanket opt-out; everything else stays off.
      expect(persistedMap()).toEqual({ 'dg-category-essential': true });
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it.each([
      ['essential keys only', { 'dg-category-essential': true }],
      ['only keys this config does not know', { 'another-sdk-category': true }],
    ])(
      'a login treats a record naming no optional category (%s) as essential-only',
      async (_name, map) => {
        mockFetchSequence(
          universalConfigJson,
          found({ consent_preferences: { isCustomised: true, cookieOptions: map } }),
        );
        await initUniversal();

        await setUserIdentifier(OPAQUE_ID, { apiKey: API_KEY, getSignature });

        // Same outcome a re-sync of the record gives: no optional category takes its config default.
        expect(isCategoryEnabled('dg-category-essential')).toBe(true);
        expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
        expect(isCategoryEnabled('dg-category-performance')).toBe(false);
      },
    );

    it('re-sync + present but empty found record: essential-only, essential stays on', async () => {
      mockFetchSequence(
        universalConfigJson,
        found({ consent_preferences: { isCustomised: true, cookieOptions: {} } }),
      );
      await initUniversal();
      bindDeviceTo(USER_HASH);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      expect(hasUserConsent()).toBe(true);
      expect(needsConsent()).toBe(false);
      expect(persistedMap()).toEqual({ 'dg-category-essential': true });
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('writes nothing when a found record has absent consent preferences (signal-only)', async () => {
      // The TRUST-2961 boundary: an ABSENT consent_preferences block (null, not an empty map) is
      // signal-only — the user made no choice. This is the only "no choice" shape and stays a miss:
      // nothing persists and the banner keeps showing to collect the answer.
      const bannerConfig = JSON.parse(universalConfigJson);
      bannerConfig.showBanner = true;
      mockFetchSequence(JSON.stringify(bannerConfig), found({ consent_preferences: null }));
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
      // ...while local reads keep the written choice (TRUST-3310), seen through this device's
      // signal: marketing reads off because the signal is denied, not because the record said off.
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
    });

    it('after a re-sync write-through, local reads show the choice written, not the older record (TRUST-3310)', async () => {
      // Same shape with no signal: the record says marketing OFF, the newer local choice says ON.
      // Before TRUST-3310 local reads were left on the record's OFF until the next sync.
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      await savePreferences({
        isCustomised: true,
        cookieOptions: [
          { gtmKey: 'dg-category-essential', isEnabled: true },
          { gtmKey: 'dg-category-marketing', isEnabled: true },
        ],
      });
      bindDeviceTo(USER_HASH);
      const listener = jest.fn();
      onConsentChanged(listener);
      global.fetch = jest
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

      await setUserIdentifier('uc-user-7f3a9c', { apiKey: API_KEY, getSignature });

      expect(isCategoryEnabled('dg-category-marketing')).toBe(true);
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      // The last state the host was told about is the restored choice.
      const last = listener.mock.calls[listener.mock.calls.length - 1][0] as ConsentPreferences;
      expect(last.cookieOptions.find((o) => o.gtmKey === 'dg-category-marketing')?.isEnabled).toBe(
        true,
      );
    });

    it('a re-sync write-through keeps the local isCustomised, matching the write (not the adopt)', async () => {
      // rejectAll stores isCustomised:false. The read's adopt forces true for the record; the restore
      // puts back the local choice's own flag, which is what the write carries.
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      await rejectAll();
      bindDeviceTo(USER_HASH);
      const stub = jest
        .fn()
        .mockResolvedValueOnce(found())
        .mockResolvedValueOnce(response(200, ''));
      global.fetch = stub;

      await setUserIdentifier('uc-user-7f3a9c', { apiKey: API_KEY, getSignature });

      const post = stub.mock.calls.find(
        (call) => (call[1] as { method: string }).method === 'POST',
      )!;
      expect(JSON.parse((post[1] as { body: string }).body).consent_preferences.isCustomised).toBe(
        false,
      );
      expect(new StorageService().loadPreferences()?.isCustomised).toBe(false);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
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

    it('login + present but empty found record: adopted as an answered choice, no POST', async () => {
      // TRUST-2961: a PRESENT consent_preferences block with an empty cookieOptions map is an
      // ANSWERED choice on a login, not a no-choice miss. It is ADOPTED (local state replaced, the
      // listener fired, the banner suppressed) rather than left neutral — only an ABSENT block is
      // signal-only. No POST: the record wins as-is. Aligns Android/RN with iOS and web.
      const fetchMock = mockFetchSequence(
        bannerConfigJson,
        found({ consent_preferences: { isCustomised: true, cookieOptions: {} } }),
      );
      await initUniversal();
      const listener = jest.fn();
      onConsentChanged(listener);

      await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

      // The record wins as-is: adopted locally, never posted.
      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(getPreferences()?.isCustomised).toBe(true);
      expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      // Essential-only means every optional category stays OFF, even one whose config default is on
      // (performance here): the login neutral fill must not enable what the answer left off.
      expect(isCategoryEnabled('dg-category-performance')).toBe(false);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(isCategoryEnabled('dg-category-functional')).toBe(false);
      // The answered choice is persisted, so the banner does not re-prompt, and the listener fires.
      expect(hasUserConsent()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
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

    it.each([
      ['login', false],
      ['re-sync', true],
    ])(
      '%s + record carrying essential false or omitting it: essential stays on locally',
      async (_label, resync) => {
        mockFetchSequence(
          universalConfigJson,
          found({
            consent_preferences: {
              isCustomised: true,
              cookieOptions: { 'dg-category-essential': false, 'dg-category-marketing': true },
            },
          }),
          found({
            consent_preferences: {
              isCustomised: true,
              cookieOptions: { 'dg-category-marketing': true },
            },
          }),
        );
        await initUniversal();
        if (resync) bindDeviceTo(USER_HASH);

        await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });
        expect(isCategoryEnabled('dg-category-essential')).toBe(true);
        expect(isCategoryEnabled('dg-category-marketing')).toBe(true);

        // Second call is a re-sync against a record that omits essential entirely.
        await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });
        expect(isCategoryEnabled('dg-category-essential')).toBe(true);
      },
    );

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

    // TRUST-3075: the binding write is now applied in exactly one place, driven by the pure
    // `decideIdentityBind` decision, instead of being hand-placed at each success exit. These assert
    // the invariant that refactor is meant to make structural: `saveBoundUserHash` runs exactly ONCE
    // on every success path and NEVER on a throwing/failure path.
    describe('binds exactly once on success, never on failure (TRUST-3075)', () => {
      /** A found record whose consent_preferences block is absent (signal-only). */
      const signalOnly = () => found({ consent_preferences: null });

      type Scenario = {
        name: string;
        /** Arrange config, network stubs and any pre-existing binding; resolves before the spy. */
        arrange: () => Promise<void>;
        /** The hash the device should be bound to after the call (null = unchanged/unbound). */
        boundAfter: string | null;
        /** Whether the call rejects (a read or write failure). */
        throws?: boolean;
      };

      const successes: Scenario[] = [
        {
          name: 'login + miss + explicit choice (write path)',
          arrange: async () => {
            await initWithExplicitChoice();
            stubUcFetch(notFound());
          },
          boundAfter: USER_HASH,
        },
        {
          name: 'login + found usable record (adopt, no write)',
          arrange: async () => {
            mockFetchSequence(universalConfigJson, found());
            await initUniversal();
          },
          boundAfter: USER_HASH,
        },
        {
          name: 'login + found signal-only record (neutral + bind, no write)',
          arrange: async () => {
            await initWithExplicitChoice();
            stubUcFetch(signalOnly());
          },
          boundAfter: USER_HASH,
        },
        {
          name: 'login + miss + defaults-only local (no write)',
          arrange: async () => {
            mockFetchSequence(bannerConfigJson, notFound());
            await initUniversal();
          },
          boundAfter: USER_HASH,
        },
        {
          name: 're-sync + found + local change (write-through)',
          arrange: async () => {
            await initWithExplicitChoice();
            bindDeviceTo(USER_HASH);
            stubUcFetch(found());
          },
          boundAfter: USER_HASH,
        },
        {
          name: 're-sync + found + no local change (adopt, no write)',
          arrange: async () => {
            mockFetchSequence(universalConfigJson, found());
            await initUniversal();
            bindDeviceTo(USER_HASH);
          },
          boundAfter: USER_HASH,
        },
        {
          name: 're-sync + miss + explicit choice (write)',
          arrange: async () => {
            await initWithExplicitChoice();
            bindDeviceTo(USER_HASH);
            stubUcFetch(notFound());
          },
          boundAfter: USER_HASH,
        },
      ];

      const failures: Scenario[] = [
        {
          name: 'read failure (5xx on the GET)',
          arrange: async () => {
            await initWithExplicitChoice();
            bindDeviceTo(OTHER_HASH);
            stubUcFetch(response(500, 'gateway error'));
          },
          boundAfter: OTHER_HASH,
          throws: true,
        },
        {
          name: 'write failure (4xx on the POST)',
          arrange: async () => {
            await initWithExplicitChoice();
            stubUcFetch(notFound(), response(403, 'bad signature'));
          },
          boundAfter: null,
          throws: true,
        },
      ];

      it.each(successes)('binds exactly once: $name', async ({ arrange, boundAfter }) => {
        await arrange();
        const bindSpy = jest.spyOn(StorageService.prototype, 'saveBoundUserHash');

        await setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature });

        expect(bindSpy).toHaveBeenCalledTimes(1);
        expect(bindSpy).toHaveBeenCalledWith(USER_HASH);
        expect(boundHash()).toBe(boundAfter);
        bindSpy.mockRestore();
      });

      it.each(failures)('never binds: $name', async ({ arrange, boundAfter }) => {
        await arrange();
        const bindSpy = jest.spyOn(StorageService.prototype, 'saveBoundUserHash');

        await expect(
          setUserIdentifier('user@example.com', { apiKey: API_KEY, getSignature }),
        ).rejects.toBeDefined();

        expect(bindSpy).not.toHaveBeenCalled();
        expect(boundHash()).toBe(boundAfter);
        bindSpy.mockRestore();
      });
    });
  });

  // The pure decision behind the one-place binding (TRUST-3075). Exercised directly so every branch
  // of the TRUST-2902 rule maps to a tagged action with no I/O — the integration tests above prove
  // the executor binds once per decision.
  describe('decideIdentityBind (TRUST-3075)', () => {
    const base = {
      recordFound: false,
      hasUsablePrefs: false,
      isResync: false,
      boundToOther: false,
      hadConsentedFlag: false,
      hasExplicitChoice: false,
      localIsNewerThanRecord: false,
      recordCcpaOptout: null as boolean | null,
      syncOptout: false,
      ccpaPendingSync: false,
    };

    it('login + found signal-only record: bindOnly, neutral when explicit/other state, adopts record CCPA', () => {
      expect(
        decideIdentityBind({
          ...base,
          recordFound: true,
          hadConsentedFlag: true,
          hasExplicitChoice: true,
          recordCcpaOptout: true,
        }),
      ).toEqual({ kind: 'bindOnly', returnToNeutral: true, adoptCcpaFromRecord: true });

      // Nothing explicit and not bound elsewhere: no neutral reset, but the record's CCPA still wins.
      expect(decideIdentityBind({ ...base, recordFound: true, recordCcpaOptout: false })).toEqual({
        kind: 'bindOnly',
        returnToNeutral: false,
        adoptCcpaFromRecord: false,
      });
    });

    it('found usable record: adopt (bindOnly) on login or a no-change re-sync, write on a re-sync change', () => {
      expect(decideIdentityBind({ ...base, hasUsablePrefs: true, recordFound: true })).toEqual({
        kind: 'bindOnly',
        returnToNeutral: false,
        adoptCcpaFromRecord: null,
      });
      expect(
        decideIdentityBind({ ...base, hasUsablePrefs: true, recordFound: true, isResync: true }),
      ).toEqual({ kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: null });
      expect(
        decideIdentityBind({
          ...base,
          hasUsablePrefs: true,
          recordFound: true,
          isResync: true,
          hasExplicitChoice: true,
          localIsNewerThanRecord: true,
        }),
      ).toEqual({ kind: 'write' });
    });

    it('found usable record + re-sync change that is NOT newer than the record: adopt (TRUST-3225)', () => {
      // A stale local copy (or one with an unknown time) never out-ranks the record.
      expect(
        decideIdentityBind({
          ...base,
          hasUsablePrefs: true,
          recordFound: true,
          isResync: true,
          hasExplicitChoice: true,
          localIsNewerThanRecord: false,
        }),
      ).toEqual({ kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: null });
    });

    it('no usable prefs + nothing explicit: bindOnly, neutral only when bound elsewhere', () => {
      expect(decideIdentityBind({ ...base })).toEqual({
        kind: 'bindOnly',
        returnToNeutral: false,
        adoptCcpaFromRecord: null,
      });
      expect(decideIdentityBind({ ...base, boundToOther: true })).toEqual({
        kind: 'bindOnly',
        returnToNeutral: true,
        adoptCcpaFromRecord: null,
      });
    });

    it('re-sync + found signal-only record: adopts the record CCPA only when the syncOptout gate is on', () => {
      expect(
        decideIdentityBind({
          ...base,
          recordFound: true,
          isResync: true,
          syncOptout: true,
          recordCcpaOptout: true,
        }),
      ).toEqual({ kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: true });
      expect(
        decideIdentityBind({
          ...base,
          recordFound: true,
          isResync: true,
          syncOptout: false,
          recordCcpaOptout: true,
        }),
      ).toEqual({ kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: null });
    });

    it('re-sync adopt of a found usable record + pending CCPA choice: flushCcpa (TRUST-3308)', () => {
      const resyncAdopt = {
        ...base,
        hasUsablePrefs: true,
        recordFound: true,
        isResync: true,
        hasExplicitChoice: true,
        syncOptout: true,
        ccpaPendingSync: true,
      };
      expect(decideIdentityBind(resyncAdopt)).toEqual({ kind: 'flushCcpa' });
      // A newer local choice is a full write, which carries the flag anyway.
      expect(decideIdentityBind({ ...resyncAdopt, localIsNewerThanRecord: true })).toEqual({
        kind: 'write',
      });
      // No flush on a login, with the gate off, or without an explicit local choice.
      const adopt = { kind: 'bindOnly', returnToNeutral: false, adoptCcpaFromRecord: null };
      expect(decideIdentityBind({ ...resyncAdopt, isResync: false })).toEqual(adopt);
      expect(decideIdentityBind({ ...resyncAdopt, syncOptout: false })).toEqual(adopt);
      expect(decideIdentityBind({ ...resyncAdopt, hasExplicitChoice: false })).toEqual(adopt);
    });

    it('miss (or re-sync signal-only) + explicit local choice: write', () => {
      expect(decideIdentityBind({ ...base, hasExplicitChoice: true })).toEqual({ kind: 'write' });
      expect(
        decideIdentityBind({
          ...base,
          recordFound: true,
          isResync: true,
          hasExplicitChoice: true,
        }),
      ).toEqual({ kind: 'write' });
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
  describe('stale re-sync guard (TRUST-3225, P0-06)', () => {
    // Opaque, customer-supplied identifier: UC never sees anything email-shaped.
    const ID = 'uc-user-7f3a9c';
    const deviceStorage = () => new StorageService();
    const T0 = 1_790_000_000; // the test's "now", unix seconds
    let nowSpy: jest.SpyInstance<number, []>;
    const setNow = (seconds: number) => nowSpy.mockReturnValue(seconds * 1000);
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
    const sha256 = (input: string) =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('crypto').createHash('sha256').update(input, 'utf8').digest('hex') as string;

    function ucPosts(mock: jest.Mock) {
      return mock.mock.calls.filter(
        (call) =>
          (call[1] as { method: string }).method === 'POST' &&
          String(call[0]).includes('/universal_consent'),
      );
    }

    /** A found record with marketing as given, last decided at `updatedAt` (unix seconds). */
    const recordAt = (updatedAt: number | null, marketing: boolean) =>
      found({
        consent_preferences: {
          isCustomised: true,
          cookieOptions: {
            'dg-category-essential': true,
            'dg-category-marketing': marketing,
            'dg-category-performance': true,
            'dg-category-functional': true,
          },
        },
        updated_at: updatedAt === null ? null : iso(updatedAt),
      });

    /** Init bound to the user (so the next call is a RE-SYNC), then make a choice at `choiceAt`. */
    async function boundDeviceWithChoiceAt(
      choiceAt: number,
      marketing: boolean,
      configJson = universalConfigJson,
    ) {
      setNow(choiceAt);
      bindDeviceTo(USER_HASH);
      mockFetchSequence(configJson, response(200, ''));
      await initUniversal();
      await savePreferences(explicitChoice(marketing));
    }

    function stubUcFetch(...responses: ReturnType<typeof response>[]) {
      const mock = jest.fn();
      for (const r of responses) mock.mockResolvedValueOnce(r);
      mock.mockResolvedValue(response(200, ''));
      global.fetch = mock;
      return mock;
    }

    beforeEach(() => {
      nowSpy = jest.spyOn(Date, 'now');
      setNow(T0);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('P0-06: grant here, revoke elsewhere later, re-sync here adopts the revocation and writes nothing', async () => {
      // This device granted marketing at T0 and went quiet.
      await boundDeviceWithChoiceAt(T0, true);
      // The user revoked marketing on another device at T0+60. This device re-syncs at T0+120.
      setNow(T0 + 120);
      const fetchMock = stubUcFetch(recordAt(T0 + 60, false));

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      // The adopted choice carries the record's time, not "now", so it cannot out-rank a later one.
      expect(deviceStorage().loadDecisionTs()).toBe(T0 + 60);
    });

    it('a re-sync change made AFTER the record writes through with its true decision_ts', async () => {
      await boundDeviceWithChoiceAt(T0 + 60, false);
      setNow(T0 + 120);
      const fetchMock = stubUcFetch(recordAt(T0, true));

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      const init = posts[0][1] as { body: string; headers: Record<string, string> };
      const body = JSON.parse(init.body);
      expect(body.consent_preferences.cookieOptions['dg-category-marketing']).toBe(false);
      expect(body.is_explicit).toBe(true);
      // The time of the choice, not the request time...
      expect(body.decision_ts).toBe(T0 + 60);
      expect(init.headers['X-DG-Timestamp']).toBe(String(T0 + 120));
      // ...and that is the decision_ts signed into provDigest.
      const payload = getSignature.mock.calls[0][0];
      expect(payload.stringToSign.split(':')[4]).toBe(sha256(`true\n${T0 + 60}\n`));
      // Local keeps the time of its own choice, and the choice itself (TRUST-3310).
      expect(deviceStorage().loadDecisionTs()).toBe(T0 + 60);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('a same-second tie adopts the record (the revocation-safe default)', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      const fetchMock = stubUcFetch(recordAt(T0, false));

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('a local choice with no recorded time (stored before TRUST-3225) adopts', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      deviceStorage().clearDecisionTs();
      setNow(T0 + 120);
      const fetchMock = stubUcFetch(recordAt(T0 - 3600, false));

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('a record with no usable updated_at adopts, and leaves the local time unknown', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      const fetchMock = stubUcFetch(recordAt(null, false));

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      expect(deviceStorage().loadDecisionTs()).toBeNull();
    });

    it('an API-key-only re-sync (no getSignature) is guarded too', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      setNow(T0 + 120);
      const fetchMock = stubUcFetch(recordAt(T0 + 60, false));

      await setUserIdentifier(ID, { apiKey: API_KEY });

      expect(ucPosts(fetchMock)).toHaveLength(0);
      expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
    });

    it('a miss seeds the record with the true decision_ts of the local choice', async () => {
      await boundDeviceWithChoiceAt(T0, false);
      setNow(T0 + 600);
      const fetchMock = stubUcFetch(notFound());

      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      expect(JSON.parse((posts[0][1] as { body: string }).body).decision_ts).toBe(T0);
    });

    it('a login adopt stamps the record time; a later choice here is newer and writes through', async () => {
      mockFetchSequence(universalConfigJson, response(200, ''));
      await initUniversal();
      stubUcFetch(recordAt(T0 - 60, true));
      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });
      expect(deviceStorage().loadDecisionTs()).toBe(T0 - 60);

      // A choice right after the adopt is stamped now and so out-ranks the adopted record.
      await savePreferences(explicitChoice(false));
      expect(deviceStorage().loadDecisionTs()).toBe(T0);
      const fetchMock = stubUcFetch(recordAt(T0 - 60, true));
      await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(1);
      expect(JSON.parse((posts[0][1] as { body: string }).body).decision_ts).toBe(T0);
    });

    it('a choice is stamped monotonically, and logout clears the stamp with the choice', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      expect(deviceStorage().loadDecisionTs()).toBe(T0);
      // Choices in the same second still order.
      await savePreferences(explicitChoice(false));
      expect(deviceStorage().loadDecisionTs()).toBe(T0 + 1);
      await acceptAll();
      expect(deviceStorage().loadDecisionTs()).toBe(T0 + 2);

      clearUserIdentifier();

      expect(deviceStorage().loadDecisionTs()).toBeNull();
    });

    it('a stored stamp implausibly far ahead of this clock reads as unknown', async () => {
      await boundDeviceWithChoiceAt(T0, true);
      deviceStorage().saveDecisionTs(T0 + 3600);
      expect(deviceStorage().loadDecisionTs()).toBeNull();
    });

    it("setCcpaOptout writes the categories at that choice's time, then the flag dated now", async () => {
      const parsed = JSON.parse(universalConfigJson);
      const gated = JSON.stringify({
        ...parsed,
        universalConsent: { ...parsed.universalConsent, sync_optout: true },
      });
      await boundDeviceWithChoiceAt(T0, true, gated);
      setNow(T0 + 300);
      const fetchMock = stubUcFetch();

      await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(2);
      const categories = JSON.parse((posts[0][1] as { body: string }).body);
      // The category choice keeps its own time, and carries no CCPA decision.
      expect(categories.decision_ts).toBe(T0);
      expect(categories.ccpa_optout).toBeUndefined();
      const ccpa = JSON.parse((posts[1][1] as { body: string }).body);
      // The CCPA-only write is dated when the choice was made (now), so a newer stored ccpa
      // register can't reject it as stale, and no category is re-stamped.
      expect(ccpa.consent_preferences).toEqual({ cookieOptions: {} });
      expect(ccpa.ccpa_optout).toBe(true);
      expect(ccpa.decision_ts).toBe(T0 + 300);
    });

    describe('the CCPA decision time is monotonic per device', () => {
      const gatedConfig = () => {
        const parsed = JSON.parse(universalConfigJson);
        return JSON.stringify({
          ...parsed,
          universalConsent: { ...parsed.universalConsent, sync_optout: true },
        });
      };
      const ccpaWrites = (mock: jest.Mock) =>
        ucPosts(mock)
          .map((call) => JSON.parse((call[1] as { body: string }).body))
          .filter((body) => body.ccpa_optout !== undefined);

      it('a clock running behind still dates a choice after the adopted record and the last choice', async () => {
        // This device's clock is 200 s behind: the record it re-syncs was decided at T0+200 by its
        // clock, T0+150 being the opt-out made on another device just before.
        await boundDeviceWithChoiceAt(T0 - 100, true, gatedConfig());
        setNow(T0);
        stubUcFetch(found({ updated_at: iso(T0 + 200), ccpa_optout: true }));
        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });
        expect(getCcpaOptout()).toBe(true);

        // The user opts back in here. A bare "now" (T0) would lose to the record's T0+150..T0+200
        // register at the edge and be reverted by the next re-sync.
        const fetchMock = stubUcFetch();
        await setCcpaOptout(false, { identifier: ID, apiKey: API_KEY, getSignature });
        // ...and toggles back within the same second: still strictly later.
        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        const writes = ccpaWrites(fetchMock);
        expect(writes.map((body) => [body.ccpa_optout, body.decision_ts])).toEqual([
          [false, T0 + 201],
          [true, T0 + 202],
        ]);
        expect(deviceStorage().loadCcpaDecisionTs()).toBe(T0 + 202);
      });

      it('a clock that ran ahead and was corrected stamps now, not a time beyond the stored one', async () => {
        await boundDeviceWithChoiceAt(T0, true, gatedConfig());
        // A choice made while this clock ran an hour ahead...
        setNow(T0 + 3600);
        stubUcFetch();
        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });
        expect(deviceStorage().loadCcpaDecisionTs()).toBe(T0 + 3600);

        // ...then the clock is corrected. That stored stamp is implausibly far ahead now, so it is
        // ignored (the same guard as the category decision time) instead of pushing every later
        // choice an hour into the future, where the edge would clamp it.
        setNow(T0 + 10);
        expect(deviceStorage().loadCcpaDecisionTs()).toBeNull();
        const fetchMock = stubUcFetch();
        await setCcpaOptout(false, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ccpaWrites(fetchMock).map((body) => body.decision_ts)).toEqual([T0 + 10]);
      });

      it('a clock running slightly ahead dates the choice by its own clock', async () => {
        await boundDeviceWithChoiceAt(T0, true, gatedConfig());
        setNow(T0 + 120);
        const fetchMock = stubUcFetch();

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        expect(ccpaWrites(fetchMock).map((body) => body.decision_ts)).toEqual([T0 + 120]);
      });

      it('logout keeps the floor; reset() wipes it', async () => {
        await boundDeviceWithChoiceAt(T0, true, gatedConfig());
        stubUcFetch();
        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        clearUserIdentifier();
        expect(deviceStorage().loadCcpaDecisionTs()).toBe(T0);

        reset();
        expect(deviceStorage().loadCcpaDecisionTs()).toBeNull();
      });
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
        expect(posts).toHaveLength(2);
        // The current RAW local categories first, at their own time, with no CCPA decision...
        const categories = postBody(posts[0]);
        expect(categories.consent_preferences.cookieOptions['dg-category-marketing']).toBe(true);
        expect(categories.ccpa_optout).toBeUndefined();
        // ...then the CCPA-only write.
        const ccpa = postBody(posts[1]);
        expect(ccpa.ccpa_optout).toBe(true);
        expect(ccpa.consent_preferences).toEqual({ cookieOptions: {} });
        expect(getSignature).toHaveBeenCalledTimes(2);
      });

      it('resolves true when written and false when saved locally only', async () => {
        await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));

        await expect(
          setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature }),
        ).resolves.toBe(false); // unbound
        bindDeviceTo(USER_HASH);
        await expect(
          setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature }),
        ).resolves.toBe(true);
        await expect(setCcpaOptout(false)).resolves.toBe(false); // no sync
      });

      it('writes the flag stored at write time, not the one captured before the hash', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        const first = setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });
        // A later call saves a newer value while the first awaits its native hash.
        deviceStorage().saveCcpaOptout(false);
        await first;

        expect(postBody(ucPosts(fetchMock)[1]).ccpa_optout).toBe(false);
      });

      it('reports a CCPA write the record already outranks as not written, and settles it', async () => {
        await initThenStub(
          configWithGate(true),
          response(200, ''), // save_preferences
          response(200, ''), // categories
          response(
            200,
            JSON.stringify({
              status: 'ok',
              stale: true,
              stale_categories: [],
              stale_fields: ['ccpa_optout'],
            }),
          ),
        );
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await expect(
          setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature }),
        ).resolves.toBe(false);
        // Settled: the next re-sync adopts the record's newer decision rather than keeping this one.
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('a re-sync flush the record outranks adopts the record flag', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          response(200, ''), // save_preferences
          found({ ccpa_optout: true, updated_at: '2099-01-01T00:00:00Z' }),
          response(
            200,
            JSON.stringify({
              status: 'ok',
              stale: true,
              stale_categories: [],
              stale_fields: ['ccpa_optout'],
            }),
          ),
        );
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(false); // pending, no sync

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(postBody(ucPosts(fetchMock)[0]).ccpa_optout).toBe(false);
        expect(getCcpaOptout()).toBe(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('the ATT save keeps an adopted raw choice unchanged: the tracking status stays device-local', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          found({
            gpc: true,
            consent_preferences: {
              isCustomised: true,
              cookieOptions: {
                'dg-category-essential': true,
                'dg-category-performance': true,
                'dg-category-marketing': true,
              },
            },
          }),
        );
        await rehydrateFromUniversalConsent(ID, API_KEY);
        // GPC suppressed performance locally; that is the record's signal, not the user's choice.
        expect(isCategoryEnabled('dg-category-performance')).toBe(false);

        const view = getPreferences();
        await saveTrackingAuthorizationPreferences({
          isCustomised: true,
          cookieOptions: view.cookieOptions.map((o) =>
            o.gtmKey === 'dg-category-marketing' ? { ...o, isEnabled: false } : o,
          ),
        });
        // The ATT denial applies to this device's view only.
        expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        const sent = postBody(ucPosts(fetchMock)[0]).consent_preferences.cookieOptions;
        expect(sent['dg-category-performance']).toBe(true); // the raw choice, not the GPC view
        // The record's own marketing value, not a cross-device denial from this device's ATT status.
        expect(sent['dg-category-marketing']).toBe(true);
      });

      it('rejects with VALIDATION_ERROR when no API key is configured, even on an unbound device', async () => {
        // The fixture config carries no universalConsent.apiKey, and none is passed.
        const fetchMock = await initThenStub(configWithGate(true));

        await expect(setCcpaOptout(true, { identifier: OPAQUE_ID })).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
        // The local choice is still stored; nothing is sent.
        expect(getCcpaOptout()).toBe(true);
        expect(ucPosts(fetchMock)).toHaveLength(0);
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

      it('does not write when a logout and a new local choice land while the hash is computed', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);
        let resolveHash: (hash: string) => void = () => undefined;
        mockComputeUserHash.mockImplementationOnce(
          () => new Promise<string>((resolve) => (resolveHash = resolve)),
        );

        const pending = setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });
        // User A logs out and the next visitor makes their own choice before the hash resolves.
        clearUserIdentifier();
        await savePreferences(explicitChoice(false));
        resolveHash(USER_HASH);
        await pending;

        // The next visitor's categories never reach A's record.
        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(deviceStorage().loadBoundUserHash()).toBeNull();
      });

      it('re-sends the adopted record RAW choice, not the ATT-suppressed local view', async () => {
        // Login adopts a record with marketing ON while ATT is denied: local reads suppress it.
        const fetchMock = await initThenStub(configWithGate(true), found());
        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature, trackingSignal: 'denied' });
        expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
        expect(hasUserConsent()).toBe(true);

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        // Changing only the Do Not Sell flag leaves the stored marketing choice enabled.
        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(2);
        expect(postBody(posts[0]).consent_preferences.cookieOptions['dg-category-marketing']).toBe(
          true,
        );
        expect(postBody(posts[1]).ccpa_optout).toBe(true);
        // Local reads keep the suppressed view.
        expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
      });

      it('sends an explicit local choice made after an adopt as stored', async () => {
        const fetchMock = await initThenStub(configWithGate(true), found(), response(200, ''));
        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature, trackingSignal: 'denied' });
        // The user now turns marketing off themselves: that is a raw choice, not a suppression.
        await savePreferences(explicitChoice(false));

        await setCcpaOptout(true, { identifier: ID, apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(2);
        expect(postBody(posts[0]).consent_preferences.cookieOptions['dg-category-marketing']).toBe(
          false,
        );
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

      it('re-sync write-through leaves the record flag alone; a pending flag goes in its own write', async () => {
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
        expect(posts).toHaveLength(2);
        // The category write-through carries no CCPA decision...
        expect(postBody(posts[0]).ccpa_optout).toBeUndefined();
        // ...and the pending choice is flushed CCPA-only.
        expect(postBody(posts[1]).ccpa_optout).toBe(true);
        expect(postBody(posts[1]).consent_preferences).toEqual({ cookieOptions: {} });
        expect(getCcpaOptout()).toBe(true);
      });

      it('a re-sync over a MISS recreates the record with the local opt-out', async () => {
        const fetchMock = await initThenStub(configWithGate(true), response(200, ''), notFound());
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);
        // A synced opt-out (not pending): the record was since deleted.
        deviceStorage().saveCcpaOptout(true);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(true);
        expect(getCcpaOptout()).toBe(true);
      });

      it('re-sync write-through with nothing pending keeps the record opt-out locally', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          response(200, ''),
          found({ ccpa_optout: true }),
        );
        await savePreferences(explicitChoice(false));
        bindDeviceTo(USER_HASH);
        expect(getCcpaOptout()).toBe(false);

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBeUndefined();
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

      it.each([
        ['null preferences', true, null],
        ['null preferences', false, null],
        ['an empty map', true, { isCustomised: true, cookieOptions: {} }],
        ['an empty map', false, { isCustomised: true, cookieOptions: {} }],
      ])(
        're-sync + found record with %s, sync_optout %s: adopts the record flag only with the gate on',
        async (_label, gate, consentPreferences) => {
          const fetchMock = await initThenStub(
            configWithGate(gate),
            found({ consent_preferences: consentPreferences, ccpa_optout: true }),
          );
          bindDeviceTo(USER_HASH);

          await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

          expect(ucPosts(fetchMock)).toHaveLength(0);
          expect(getCcpaOptout()).toBe(gate);
        },
      );
    });

    it('a re-sync sends a setCcpaOptout made while its read was in flight', async () => {
      const fetchMock = await initThenStub(configWithGate(true));
      await savePreferences(explicitChoice(false));
      bindDeviceTo(USER_HASH);
      fetchMock.mockImplementationOnce(() => {
        void setCcpaOptout(true);
        return Promise.resolve(found({ ccpa_optout: false }));
      });

      await setUserIdentifier(OPAQUE_ID, { apiKey: API_KEY, getSignature });

      // The category write-through leaves the record's flag alone (TRUST-3308); the choice made
      // during the read is pending, so it follows as its own CCPA-only write.
      const posts = ucPosts(fetchMock);
      expect(posts).toHaveLength(2);
      expect(postBody(posts[0])).not.toHaveProperty('ccpa_optout');
      expect(postBody(posts[1]).consent_preferences).toEqual({ cookieOptions: {} });
      expect(postBody(posts[1]).ccpa_optout).toBe(true);
      expect(getCcpaOptout()).toBe(true);
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

      // Decision 2026-10-26 (TRUST-2591): a LOGIN adopts the record's ccpa_optout whatever the
      // sync_optout gate says. The gate only governs re-sync adoption and the wire.
      it('sync_optout off: a login still adopts the record opt-out', async () => {
        const fetchMock = await initThenStub(configWithGate(false), found({ ccpa_optout: true }));

        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('sync_optout off: a later local change still writes, and a re-sync does not undo it', async () => {
        const fetchMock = await initThenStub(
          configWithGate(false),
          found({ ccpa_optout: true }),
          found({ ccpa_optout: true }),
        );
        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });
        expect(getCcpaOptout()).toBe(true);

        // Local only with the gate off: stored, nothing sent.
        await expect(
          setCcpaOptout(false, { identifier: ID, apiKey: API_KEY, getSignature }),
        ).resolves.toBe(false);
        expect(getCcpaOptout()).toBe(false);

        // The record still says true; a RE-SYNC with the gate off does not adopt it over the choice.
        await setUserIdentifier(ID, { apiKey: API_KEY, getSignature });

        expect(getCcpaOptout()).toBe(false);
        expect(
          ucPosts(fetchMock).filter((call) => postBody(call).ccpa_optout === true),
        ).toHaveLength(0);
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

      it('a setCcpaOptout made while the login read is in flight is kept over the record', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        fetchMock.mockImplementationOnce(() => {
          // The host stores the user's choice while the GET is outstanding.
          void setCcpaOptout(true);
          return Promise.resolve(found({ ccpa_optout: false }));
        });

        await setUserIdentifier(OPAQUE_ID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
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
    describe('a pending setCcpaOptout choice survives RE-SYNC (TRUST-3308)', () => {
      // Opaque, customer-supplied identifier: UC never sees anything email-shaped.
      const UID = 'uc-user-7f3a9c';

      it('a local-only change on a bound device is kept over the stale record, then written and cleared', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          // The save_preferences POST from savePreferences below.
          response(200, ''),
          found({ ccpa_optout: false, updated_at: '2026-01-01T00:00:00Z' }),
        );
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);
        // No `sync`: the choice cannot write through now, so it is pending.
        await setCcpaOptout(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);

        // The category choice is newer than the record, so the re-sync writes through, then flushes
        // the pending flag in its own CCPA-only write rather than adopting the record's stale false.
        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

        const posts = ucPosts(fetchMock);
        expect(posts).toHaveLength(2);
        expect(postBody(posts[0]).ccpa_optout).toBeUndefined();
        expect(postBody(posts[1]).ccpa_optout).toBe(true);
        expect(getCcpaOptout()).toBe(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('a re-sync ADOPT keeps the pending flag and leaves it pending', async () => {
        // Record newer than the local category choice: the categories adopt, the pending flag stays.
        const fetchMock = await initThenStub(
          configWithGate(true),
          found({ ccpa_optout: false, updated_at: '2099-01-01T00:00:00Z' }),
        );
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);

        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);
      });

      it('a re-sync of a signal-only record keeps the pending flag', async () => {
        const fetchMock = await initThenStub(
          configWithGate(true),
          found({ consent_preferences: null, ccpa_optout: false }),
        );
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);

        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(0);
        expect(getCcpaOptout()).toBe(true);
      });

      it('a failed write-through leaves the choice pending, so the next re-sync keeps it', async () => {
        await initThenStub(configWithGate(true), response(200, ''), response(500, 'boom'));
        bindDeviceTo(USER_HASH);
        await savePreferences(explicitChoice(true));
        await expect(
          setCcpaOptout(true, { identifier: UID, apiKey: API_KEY, getSignature }),
        ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);

        const stub = jest
          .fn()
          .mockResolvedValueOnce(found({ ccpa_optout: false, updated_at: '2099-01-01T00:00:00Z' }))
          // The re-sync flushes the still-pending flag.
          .mockResolvedValueOnce(response(200, ''));
        global.fetch = stub;
        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

        expect(getCcpaOptout()).toBe(true);
        const posts = ucPosts(stub);
        expect(posts).toHaveLength(1);
        expect(postBody(posts[0]).ccpa_optout).toBe(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      describe('a re-sync ADOPT flushes a pending flag with the record categories (TRUST-3308)', () => {
        // Older than the record, so the re-sync adopts the record's categories.
        const LOCAL_TS = Math.floor(Date.parse('2025-06-01T00:00:00Z') / 1000);
        const RECORD_AT = '2026-01-01T00:00:00Z';
        const RECORD_TS = Math.floor(Date.parse(RECORD_AT) / 1000);

        async function staleDeviceWithPendingOptout(...responses: ReturnType<typeof response>[]) {
          const fetchMock = await initThenStub(
            configWithGate(true),
            // The save_preferences POST from savePreferences below.
            response(200, ''),
            ...responses,
          );
          await savePreferences(explicitChoice(true));
          deviceStorage().saveDecisionTs(LOCAL_TS);
          bindDeviceTo(USER_HASH);
          await setCcpaOptout(true);
          expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);
          return fetchMock;
        }

        it('flushes the pending flag CCPA-only, dated when it was chosen, leaving categories alone', async () => {
          const fetchMock = await staleDeviceWithPendingOptout(
            found({
              ccpa_optout: false,
              updated_at: RECORD_AT,
              consent_preferences: {
                isCustomised: true,
                cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
              },
            }),
          );

          const deviceStoragePendingSince = deviceStorage().loadCcpaOptoutPendingSince();
          expect(deviceStoragePendingSince).not.toBeNull();
          await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

          const posts = ucPosts(fetchMock);
          expect(posts).toHaveLength(1);
          const body = postBody(posts[0]);
          // No category rides the flush: the categories another device chose stay as they are.
          expect(body.consent_preferences).toEqual({ cookieOptions: {} });
          expect(body.ccpa_optout).toBe(true);
          // Dated when the pending choice was made, its own register's time (TRUST-3311).
          expect(body.decision_ts).toBe(deviceStoragePendingSince);
          expect(isCategoryEnabled('dg-category-marketing')).toBe(false);
          expect(getCcpaOptout()).toBe(true);
          expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
          expect(deviceStorage().loadBoundUserHash()).toBe(USER_HASH);
        });

        it('a failed flush rejects and leaves the flag pending', async () => {
          const fetchMock = await staleDeviceWithPendingOptout(
            found({ ccpa_optout: false, updated_at: RECORD_AT }),
            response(500, 'boom'),
          );

          await expect(
            setUserIdentifier(UID, { apiKey: API_KEY, getSignature }),
          ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

          expect(ucPosts(fetchMock)).toHaveLength(1);
          expect(getCcpaOptout()).toBe(true);
          expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);
        });

        it('a re-sync with no pending flag writes nothing', async () => {
          const fetchMock = await initThenStub(
            configWithGate(true),
            response(200, ''),
            found({ ccpa_optout: false, updated_at: RECORD_AT }),
          );
          await savePreferences(explicitChoice(true));
          deviceStorage().saveDecisionTs(LOCAL_TS);
          bindDeviceTo(USER_HASH);

          await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

          expect(ucPosts(fetchMock)).toHaveLength(0);
        });
      });

      it('a successful write-through clears the marker, so a later re-sync adopts the record again', async () => {
        const fetchMock = await initThenStub(configWithGate(true));
        await savePreferences(explicitChoice(true));
        bindDeviceTo(USER_HASH);

        await setCcpaOptout(true, { identifier: UID, apiKey: API_KEY, getSignature });

        expect(ucPosts(fetchMock)).toHaveLength(2);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce(found({ ccpa_optout: false, updated_at: '2099-01-01T00:00:00Z' }));
        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });
        expect(getCcpaOptout()).toBe(false);
      });

      it('is never pending on an unbound device or with the gate off', async () => {
        await initThenStub(configWithGate(true));
        await setCcpaOptout(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);

        reset();
        await initThenStub(configWithGate(false));
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('a LOGIN adopt replaces the pending flag with the record value and clears the marker', async () => {
        await initThenStub(configWithGate(true), found({ ccpa_optout: false }));
        bindDeviceTo(OTHER_HASH);
        await setCcpaOptout(true);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(true);

        await setUserIdentifier(UID, { apiKey: API_KEY, getSignature });

        expect(getCcpaOptout()).toBe(false);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });

      it('logout clears the marker with the flag', async () => {
        await initThenStub(configWithGate(true));
        bindDeviceTo(USER_HASH);
        await setCcpaOptout(true);

        clearUserIdentifier();

        expect(getCcpaOptout()).toBe(false);
        expect(deviceStorage().hasPendingCcpaOptoutSync()).toBe(false);
      });
    });
  });
});
