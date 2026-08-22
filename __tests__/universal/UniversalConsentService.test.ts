import * as fs from 'fs';
import * as path from 'path';

const USER_HASH = '1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4';
const mockComputeUserHash = jest.fn<Promise<string>, [string, string, string]>();

jest.mock('../../src/universal/userHash', () => ({
  computeUserHash: (customerId: string, projectId: string, identifier: string) =>
    mockComputeUserHash(customerId, projectId, identifier),
}));

import { UniversalConsentService } from '../../src/universal/UniversalConsentService';
import { ConfigService } from '../../src/config/ConfigService';
import { NetworkService } from '../../src/network/NetworkService';
import type { ConsentConfig } from '../../src/types';
import type { UniversalConsentSignature } from '../../src/universal/types';

const universalConfigJson = fs.readFileSync(
  path.join(__dirname, '../fixtures/test-config-universal.json'),
  'utf-8',
);

function mockFetch(status: number, data: string) {
  const mock = jest.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(data),
    headers: { forEach: () => undefined },
  });
  global.fetch = mock;
  return mock;
}

const SIGNATURE: UniversalConsentSignature = {
  signature: 'deadbeef',
  keyId: 'key-1',
};

const HEX_32 = /^[0-9a-f]{32}$/;

describe('UniversalConsentService', () => {
  let config: ConsentConfig;
  let service: UniversalConsentService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockComputeUserHash.mockResolvedValue(USER_HASH);
    config = ConfigService.parseConfig(universalConfigJson);
    service = new UniversalConsentService(new NetworkService());
  });

  describe('get', () => {
    it('requests the CloudFront behavior with no /api/v1/ prefix', async () => {
      // GET/POST /universal_consent is a CloudFront behavior, not a Rails route.
      const fetchMock = mockFetch(200, JSON.stringify({ status: 'not_found' }));

      await service.get(config, 'user@example.com', 'api-key-123');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('https://api.consentjs.datagrailstaging.com/universal_consent?');
      expect(url).not.toContain('/api/v1/');
      expect(url).toContain('customer_id=ac46d8ad-a67a-431f-a5d5-9e3eb922dae7');
      expect(url).toContain(`user_hash=${USER_HASH}`);
    });

    it('sends the API key but no signature headers — reads are unsigned', async () => {
      const fetchMock = mockFetch(200, JSON.stringify({ status: 'not_found' }));

      await service.get(config, 'user@example.com', 'api-key-123');

      const init = fetchMock.mock.calls[0][1] as {
        method: string;
        headers: Record<string, string>;
      };
      expect(init.method).toBe('GET');
      expect(init.headers['X-DG-Api-Key']).toBe('api-key-123');
      expect(init.headers).not.toHaveProperty('X-DG-Signature');
      expect(init.headers).not.toHaveProperty('X-DG-Timestamp');
      expect(init.headers).not.toHaveProperty('X-DG-Key-Id');
      expect(init.headers).not.toHaveProperty('X-DG-Nonce');
    });

    it('hashes with the config customer id and project id', async () => {
      mockFetch(200, JSON.stringify({ status: 'not_found' }));

      await service.get(config, 'user@example.com', 'api-key-123');

      expect(mockComputeUserHash).toHaveBeenCalledWith(
        'ac46d8ad-a67a-431f-a5d5-9e3eb922dae7',
        'proj_abc123',
        'user@example.com',
      );
    });

    it('maps a found record from snake_case to camelCase', async () => {
      mockFetch(
        200,
        JSON.stringify({
          status: 'found',
          consent_preferences: {
            isCustomised: true,
            cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
          },
          consent_mode: 'optout',
          ccpa_optout: true,
          platform: 'web',
          policy_name: 'CPRA',
          config_version: 'v-remote',
          updated_at: '2026-01-01T00:00:00Z',
          gpc: true,
          tcf_string: 'tcf-abc',
          gpp_string: 'gpp-abc',
        }),
      );

      const record = await service.get(config, 'user@example.com', 'api-key-123');

      expect(record).toEqual({
        status: 'found',
        consentPreferences: {
          isCustomised: true,
          cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
        },
        consentMode: 'optout',
        ccpaOptout: true,
        platform: 'web',
        policyName: 'CPRA',
        configVersion: 'v-remote',
        updatedAt: '2026-01-01T00:00:00Z',
        gpc: true,
        tcfString: 'tcf-abc',
        gppString: 'gpp-abc',
      });
    });

    it('defaults absent optional fields rather than leaving them undefined', async () => {
      mockFetch(200, JSON.stringify({ status: 'found' }));

      const record = await service.get(config, 'user@example.com', 'api-key-123');

      expect(record).toEqual({
        status: 'found',
        consentPreferences: null,
        consentMode: null,
        ccpaOptout: false,
        platform: null,
        policyName: null,
        configVersion: null,
        updatedAt: null,
        gpc: false,
        tcfString: null,
        gppString: null,
      });
    });

    it('returns null for a miss, which the server reports at HTTP 200 and not 404', async () => {
      mockFetch(200, JSON.stringify({ status: 'not_found' }));

      await expect(service.get(config, 'user@example.com', 'api-key-123')).resolves.toBeNull();
    });

    it('returns null for any status that is not an explicit "found"', async () => {
      // The global kill switch responds the same way as a miss. Anything but "found" is a miss.
      mockFetch(200, JSON.stringify({ status: 'disabled' }));

      await expect(service.get(config, 'user@example.com', 'api-key-123')).resolves.toBeNull();
    });

    it('throws NETWORK_ERROR on a non-2xx rather than parsing the error body as a record', async () => {
      // NetworkService resolves on any status — it only rejects on transport failure — so the
      // service has to check the status itself or a 500's body would be treated as consent data.
      mockFetch(500, JSON.stringify({ status: 'found', consent_preferences: null }));

      await expect(service.get(config, 'user@example.com', 'api-key-123')).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });
    });

    it('throws PARSE_ERROR on a non-JSON body', async () => {
      mockFetch(200, '<html>gateway</html>');

      await expect(service.get(config, 'user@example.com', 'api-key-123')).rejects.toMatchObject({
        code: 'PARSE_ERROR',
      });
    });

    it('throws VALIDATION_ERROR when consentProjectId is missing from the config', async () => {
      const fetchMock = mockFetch(200, JSON.stringify({ status: 'not_found' }));
      delete config.consentProjectId;

      await expect(service.get(config, 'user@example.com', 'api-key-123')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    const prefs = {
      isCustomised: true,
      cookieOptions: { 'dg-category-essential': true, 'dg-category-marketing': false },
    };

    it('POSTs the map-shaped preferences with the config metadata', async () => {
      const fetchMock = mockFetch(200, '');

      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        false,
        async () => SIGNATURE,
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.consentjs.datagrailstaging.com/universal_consent');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        customer_id: 'ac46d8ad-a67a-431f-a5d5-9e3eb922dae7',
        user_hash: USER_HASH,
        consent_preferences: prefs,
        consent_mode: 'optout',
        ccpa_optout: false,
        platform: 'react-native',
        policy_name: 'CPRA',
        config_version: 'cc959465-747d-4c81-8bc1-5dcd34dc3756',
      });
    });

    it('attaches the callback signature/keyId plus the SDK-owned timestamp and 32-hex nonce', async () => {
      const fetchMock = mockFetch(200, '');
      const getSignature = jest.fn().mockResolvedValue(SIGNATURE);

      const before = Math.floor(Date.now() / 1000);
      await service.save(config, 'user@example.com', prefs, 'api-key-123', false, getSignature);
      const after = Math.floor(Date.now() / 1000);

      const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers['X-DG-Api-Key']).toBe('api-key-123');
      expect(init.headers['X-DG-Signature']).toBe('deadbeef');
      expect(init.headers['X-DG-Key-Id']).toBe('key-1');
      // The nonce is 32 lowercase hex from the CSPRNG — NOT a dashed UUID.
      expect(init.headers['X-DG-Nonce']).toMatch(HEX_32);

      // Timestamp is the SDK's own unix seconds (stringified), within the call window — not a
      // value the callback chose.
      const sentTs = Number(init.headers['X-DG-Timestamp']);
      expect(init.headers['X-DG-Timestamp']).toBe(String(sentTs));
      expect(sentTs).toBeGreaterThanOrEqual(before);
      expect(sentTs).toBeLessThanOrEqual(after);

      // The header nonce/timestamp are exactly what was folded into the signed string.
      const payload = getSignature.mock.calls[0][0];
      expect(init.headers['X-DG-Nonce']).toBe(payload.nonce);
      expect(init.headers['X-DG-Timestamp']).toBe(String(payload.timestamp));
    });

    it('uses a fresh nonce per write so a replay cannot reuse one', async () => {
      const fetchMock = mockFetch(200, '');

      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        false,
        async () => SIGNATURE,
      );
      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        false,
        async () => SIGNATURE,
      );

      const first = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
      const second = (fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers;
      expect(first['X-DG-Nonce']).not.toBe(second['X-DG-Nonce']);
    });

    it('hands the provider a payload whose stringToSign is exactly {cid}:{uh}:{ts}:{nonce}', async () => {
      mockFetch(200, '');
      const getSignature = jest.fn().mockResolvedValue(SIGNATURE);

      await service.save(config, 'user@example.com', prefs, 'api-key-123', false, getSignature);

      expect(getSignature).toHaveBeenCalledTimes(1);
      const payload = getSignature.mock.calls[0][0];
      expect(payload.customerId).toBe('ac46d8ad-a67a-431f-a5d5-9e3eb922dae7');
      expect(payload.userHash).toBe(USER_HASH);
      expect(payload.nonce).toMatch(HEX_32);
      expect(typeof payload.timestamp).toBe('number');
      // The canonical string the edge will recompute — built by the SDK, not the callback.
      expect(payload.stringToSign).toBe(
        `ac46d8ad-a67a-431f-a5d5-9e3eb922dae7:${USER_HASH}:${payload.timestamp}:${payload.nonce}`,
      );
    });

    it('performs an API-key-only write when no signature provider is given', async () => {
      const fetchMock = mockFetch(200, '');

      await service.save(config, 'user@example.com', prefs, 'api-key-123', false);

      const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers['X-DG-Api-Key']).toBe('api-key-123');
      expect(init.headers).not.toHaveProperty('X-DG-Signature');
      expect(init.headers).not.toHaveProperty('X-DG-Timestamp');
      expect(init.headers).not.toHaveProperty('X-DG-Key-Id');
      expect(init.headers).not.toHaveProperty('X-DG-Nonce');
    });

    it('suppresses ccpa_optout when syncOptout is disabled', async () => {
      // syncOptout is a feature gate, not the opt-out value. With the gate off, a true opt-out
      // must not be written.
      const fetchMock = mockFetch(200, '');
      expect(config.universalConsent?.syncOptout).toBe(false);

      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        true,
        async () => SIGNATURE,
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
      expect(body.ccpa_optout).toBe(false);
    });

    it('writes ccpa_optout when syncOptout is enabled and the user opted out', async () => {
      const fetchMock = mockFetch(200, '');
      config.universalConsent = { enabled: true, syncOptout: true };

      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        true,
        async () => SIGNATURE,
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
      expect(body.ccpa_optout).toBe(true);
    });

    it('writes false when syncOptout is enabled but the user did not opt out', async () => {
      const fetchMock = mockFetch(200, '');
      config.universalConsent = { enabled: true, syncOptout: true };

      await service.save(
        config,
        'user@example.com',
        prefs,
        'api-key-123',
        false,
        async () => SIGNATURE,
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
      expect(body.ccpa_optout).toBe(false);
    });

    it('throws NETWORK_ERROR on a non-2xx', async () => {
      mockFetch(403, JSON.stringify({ error: 'invalid signature' }));

      await expect(
        service.save(
          config,
          'user@example.com',
          prefs,
          'api-key-123',
          false,
          async () => SIGNATURE,
        ),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('does not write when the signature provider fails', async () => {
      const fetchMock = mockFetch(200, '');

      await expect(
        service.save(config, 'user@example.com', prefs, 'api-key-123', false, async () => {
          throw new Error('backend down');
        }),
      ).rejects.toThrow('backend down');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not request a signature when consentProjectId is missing', async () => {
      const getSignature = jest.fn().mockResolvedValue(SIGNATURE);
      mockFetch(200, '');
      delete config.consentProjectId;

      await expect(
        service.save(config, 'user@example.com', prefs, 'api-key-123', false, getSignature),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(getSignature).not.toHaveBeenCalled();
    });
  });
});
