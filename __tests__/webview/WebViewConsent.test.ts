import type { ConsentPreferences, ConsentConfig } from '../../src/types';
import { ConsentError } from '../../src/types';

const mockGetPreferences = jest.fn<ConsentPreferences | null, []>();
const mockGetConfig = jest.fn<ConsentConfig | null, []>();

jest.mock('../../src/ConsentManager', () => ({
  getPreferences: () => mockGetPreferences(),
  getConfig: () => mockGetConfig(),
}));

import { getConsentPayloadForWebView, getConsentInjectionScript } from '../../src/webview/WebViewConsent';

const TEST_CONFIG: ConsentConfig = {
  version: 'abc-123',
  consentContainerVersionId: 'uuid-container-v1',
  dgCustomerId: 'customer-xyz',
  publishDate: 1700000000000,
  dch: 'categorize',
  dc: 'dg-category-marketing',
  privacyDomain: 'api.consent.example.com',
  plugins: {
    scriptControl: true,
    allCookieSubdomains: true,
    cookieBlocking: true,
    localStorageBlocking: true,
    syncOTConsent: false,
  },
  testMode: false,
  ignoreDoNotTrack: false,
  trackingDetailsUrl: 'https://api.consent.example.com/service-metadata.json',
  consentMode: 'optout',
  showBanner: false,
  consentPolicy: { name: 'CPRA', default: false },
  gppUsNat: true,
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

const TEST_PREFERENCES: ConsentPreferences = {
  isCustomised: true,
  cookieOptions: [
    { gtmKey: 'dg-category-essential', isEnabled: true },
    { gtmKey: 'dg-category-marketing', isEnabled: false },
  ],
};

describe('WebViewConsent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getConsentPayloadForWebView', () => {
    it('returns a payload with consent data when initialized', () => {
      mockGetPreferences.mockReturnValue(TEST_PREFERENCES);
      mockGetConfig.mockReturnValue(TEST_CONFIG);

      const payload = getConsentPayloadForWebView();

      expect(payload).toEqual({
        consentId: 'uuid-container-v1',
        preferences: TEST_PREFERENCES,
        configVersion: 'abc-123',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
    });

    it('throws NOT_INITIALIZED when preferences are null', () => {
      mockGetPreferences.mockReturnValue(null);
      mockGetConfig.mockReturnValue(TEST_CONFIG);

      expect(() => getConsentPayloadForWebView()).toThrow(ConsentError);
      try {
        getConsentPayloadForWebView();
        fail('Expected to throw');
      } catch (e) {
        expect((e as ConsentError).code).toBe('NOT_INITIALIZED');
      }
    });

    it('throws NOT_INITIALIZED when config is null', () => {
      mockGetPreferences.mockReturnValue(TEST_PREFERENCES);
      mockGetConfig.mockReturnValue(null);

      expect(() => getConsentPayloadForWebView()).toThrow(ConsentError);
    });

    it('throws NOT_INITIALIZED when both are null', () => {
      mockGetPreferences.mockReturnValue(null);
      mockGetConfig.mockReturnValue(null);

      expect(() => getConsentPayloadForWebView()).toThrow(ConsentError);
    });

    it('includes the error code on the thrown error', () => {
      mockGetPreferences.mockReturnValue(null);
      mockGetConfig.mockReturnValue(null);

      try {
        getConsentPayloadForWebView();
        fail('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ConsentError);
        expect((e as ConsentError).code).toBe('NOT_INITIALIZED');
      }
    });
  });

  describe('getConsentInjectionScript', () => {
    it('returns a self-executing JS string that sets window.__dgConsent', () => {
      mockGetPreferences.mockReturnValue(TEST_PREFERENCES);
      mockGetConfig.mockReturnValue(TEST_CONFIG);

      const script = getConsentInjectionScript();

      expect(script).toContain('window.__dgConsent=');
      expect(script).toContain('window.__dgConsentReady=true');
      expect(script).toContain("document.dispatchEvent(new CustomEvent('dgConsentReady'))");
      expect(script).toMatch(/^\(function\(\)\{.*\}\)\(\);$/);
    });

    it('includes correct JSON payload in the script', () => {
      mockGetPreferences.mockReturnValue(TEST_PREFERENCES);
      mockGetConfig.mockReturnValue(TEST_CONFIG);

      const script = getConsentInjectionScript();

      // Extract the JSON between window.__dgConsent= and ;window.__dgConsentReady
      const match = script.match(/window\.__dgConsent=(.*?);window\.__dgConsentReady/);
      expect(match).not.toBeNull();

      const parsed = JSON.parse(match![1]!);
      expect(parsed).toEqual({
        consentId: 'uuid-container-v1',
        preferences: {
          isCustomised: true,
          cookieOptions: [
            { gtmKey: 'dg-category-essential', isEnabled: true },
            { gtmKey: 'dg-category-marketing', isEnabled: false },
          ],
        },
        configVersion: 'abc-123',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
    });

    it('throws NOT_INITIALIZED when SDK is not initialized', () => {
      mockGetPreferences.mockReturnValue(null);
      mockGetConfig.mockReturnValue(null);

      expect(() => getConsentInjectionScript()).toThrow(ConsentError);
    });

    it('produces valid JavaScript that can be evaluated', () => {
      mockGetPreferences.mockReturnValue(TEST_PREFERENCES);
      mockGetConfig.mockReturnValue(TEST_CONFIG);

      const script = getConsentInjectionScript();

      // The script should be parseable as JS (basic syntax check via Function constructor)
      expect(() => new Function(script)).not.toThrow();
    });
  });
});
