import { ConfigService } from '../../src/config/ConfigService';
import { StorageService } from '../../src/storage/StorageService';
import { NetworkService } from '../../src/network/NetworkService';
import { ConsentError } from '../../src/types';
import { __resetAllStores } from 'react-native-mmkv';
import * as fs from 'fs';
import * as path from 'path';

const testConfigJson = fs.readFileSync(
  path.join(__dirname, '../fixtures/test-config.json'),
  'utf-8',
);

describe('ConfigService', () => {
  let storage: StorageService;
  let network: NetworkService;
  let configService: ConfigService;

  beforeEach(() => {
    __resetAllStores();
    storage = new StorageService('config-test');
    network = new NetworkService();
    configService = new ConfigService(network, storage, { cacheTtl: 300_000 });
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('parseConfig', () => {
    it('should parse the test fixture JSON correctly', () => {
      const config = ConfigService.parseConfig(testConfigJson);

      expect(config.version).toBe('cc959465-747d-4c81-8bc1-5dcd34dc3756');
      expect(config.consentContainerVersionId).toBe('0dd5bdf3-b55e-4d97-8a06-e14b17660b94');
      expect(config.dgCustomerId).toBe('ac46d8ad-a67a-431f-a5d5-9e3eb922dae7');
      expect(config.publishDate).toBe(1765415800250);
      expect(config.dch).toBe('categorize');
      expect(config.dc).toBe('dg-category-marketing');
      expect(config.privacyDomain).toBe('api.consentjs.datagrailstaging.com');
      expect(config.consentMode).toBe('optout');
      expect(config.showBanner).toBe(false);
      expect(config.gppUsNat).toBe(true);
    });

    it('should parse plugins correctly', () => {
      const config = ConfigService.parseConfig(testConfigJson);

      expect(config.plugins).toEqual({
        scriptControl: true,
        allCookieSubdomains: true,
        cookieBlocking: true,
        localStorageBlocking: true,
        syncOTConsent: false,
      });
    });

    it('should parse initialCategories with snake_case to camelCase', () => {
      const config = ConfigService.parseConfig(testConfigJson);

      expect(config.initialCategories.respectGpc).toBe(true);
      expect(config.initialCategories.respectDnt).toBe(true);
      expect(config.initialCategories.respectOptout).toBe(false);
      expect(config.initialCategories.initial).toEqual([
        'dg-category-essential',
        'dg-category-performance',
        'dg-category-functional',
        'dg-category-marketing',
      ]);
      expect(config.initialCategories.gpc).toEqual(['dg-category-essential']);
    });

    it('should parse layout snake_case fields', () => {
      const config = ConfigService.parseConfig(testConfigJson);

      expect(config.layout.defaultLayout).toBe(false);
      expect(config.layout.collapsedOnMobile).toBe(true);
      expect(config.layout.firstLayerId).toBe('26259ccb-e5e0-4305-b696-fa2b7413c239');
      expect(config.layout.gpcDntLayerId).toBeNull();
    });

    it('should parse consent layers with snake_case fields', () => {
      const config = ConfigService.parseConfig(testConfigJson);
      const layers = config.layout.consentLayers;

      expect(Object.keys(layers).length).toBe(5);

      const categoriesLayer = layers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      expect(categoriesLayer).toBeDefined();
      expect(categoriesLayer.showCloseButton).toBe(true);
      expect(categoriesLayer.bannerApiId).toBe('categories-layer');
    });

    it('should parse consent layer elements with snake_case fields', () => {
      const config = ConfigService.parseConfig(testConfigJson);
      const layer = config.layout.consentLayers['00a6e2c3-f1d5-4d3f-bd91-7d45cc0b75c5'];
      const buttonElement = layer.elements[0];

      expect(buttonElement.buttonAction).toBe('open_layer');
      expect(buttonElement.targetConsentLayer).toBe('26259ccb-e5e0-4305-b696-fa2b7413c239');
    });

    it('should parse consent layer categories with snake_case fields', () => {
      const config = ConfigService.parseConfig(testConfigJson);
      const layer = config.layout.consentLayers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      const categoryElement = layer.elements.find((e) => e.type === 'ConsentLayerCategoryElement');

      expect(categoryElement).toBeDefined();
      expect(categoryElement!.consentLayerCategories).toBeDefined();
      expect(categoryElement!.consentLayerCategories!.length).toBe(5);

      const essential = categoryElement!.consentLayerCategories![0];
      expect(essential.consentCategoryId).toBe('936160e0-06fd-4de7-8b13-1ac51c6f0125');
      expect(essential.alwaysOn).toBe(true);
      expect(essential.gtmKey).toBe('dg-category-essential');
      expect(essential.cookiePatterns).toContain('datagrail_consent_locale_code');
      expect(essential.showTrackingDetailsLink).toBe(false);
    });

    it('should convert essential_label to essentialLabel on category translations', () => {
      const config = ConfigService.parseConfig(testConfigJson);
      const layer = config.layout.consentLayers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      const categoryElement = layer.elements.find((e) => e.type === 'ConsentLayerCategoryElement');

      const essential = categoryElement!.consentLayerCategories![0];
      expect(essential.translations['en'].essentialLabel).toBe('Always On');
      expect(essential.translations['bg'].essentialLabel).toBe('Винаги включен');
      expect(essential.translations['hr'].essentialLabel).toBe('Uvijek uključen');
      expect(essential.translations['bg'].name).toBe('От съществено значение');
    });

    it('should handle tracking_details_link_translations as array', () => {
      const config = ConfigService.parseConfig(testConfigJson);
      const layer = config.layout.consentLayers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      const categoryElement = layer.elements.find((e) => e.type === 'ConsentLayerCategoryElement');

      // The fixture has it as an array with locale field
      expect(categoryElement!.trackingDetailsLinkTranslations).toBeDefined();
      expect(categoryElement!.trackingDetailsLinkTranslations!['en']).toEqual({
        locale: 'en',
        value: 'View Tracking Details',
        id: '34980027320934133',
      });
    });

    it('should handle tracking_details_link_translations as dict', () => {
      const rawWithDict = JSON.parse(testConfigJson);
      // Convert the array to a dict format
      const layer = rawWithDict.layout.consent_layers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      const catElement = layer.elements.find(
        (e: { type: string }) => e.type === 'ConsentLayerCategoryElement',
      );
      catElement.tracking_details_link_translations = {
        en: { id: 'dict-id', locale: 'en', value: 'Dict Value' },
      };

      const config = ConfigService.parseConfig(JSON.stringify(rawWithDict));
      const parsedLayer = config.layout.consentLayers['26259ccb-e5e0-4305-b696-fa2b7413c239'];
      const parsedElement = parsedLayer.elements.find(
        (e) => e.type === 'ConsentLayerCategoryElement',
      );

      expect(parsedElement!.trackingDetailsLinkTranslations!['en']).toEqual({
        id: 'dict-id',
        locale: 'en',
        value: 'Dict Value',
      });
    });

    it('should throw PARSE_ERROR on invalid JSON', () => {
      expect(() => ConfigService.parseConfig('not-json{')).toThrow(ConsentError);
      expect(() => ConfigService.parseConfig('not-json{')).toThrow('Failed to parse config JSON');
    });

    describe('universal consent fields', () => {
      it('should omit both fields for a config published before universal consent existed', () => {
        // Omitted rather than set to `undefined` — the fixture has neither field, and assigning
        // `undefined` explicitly breaks exactOptionalPropertyTypes consumers.
        const config = ConfigService.parseConfig(testConfigJson);

        expect(config).not.toHaveProperty('consentProjectId');
        expect(config).not.toHaveProperty('universalConsent');
      });

      it('should parse consentProjectId and universalConsent when present', () => {
        const raw = JSON.parse(testConfigJson);
        raw.consentProjectId = 'proj_abc123';
        raw.universalConsent = { enabled: true, sync_optout: true };

        const config = ConfigService.parseConfig(JSON.stringify(raw));

        expect(config.consentProjectId).toBe('proj_abc123');
        expect(config.universalConsent).toEqual({ enabled: true, syncOptout: true });
      });

      it('should default both universalConsent flags to false when absent', () => {
        const raw = JSON.parse(testConfigJson);
        raw.universalConsent = {};

        const config = ConfigService.parseConfig(JSON.stringify(raw));

        expect(config.universalConsent).toEqual({ enabled: false, syncOptout: false });
      });

      it('should omit universalConsent when the wire value is null', () => {
        const raw = JSON.parse(testConfigJson);
        raw.consentProjectId = null;
        raw.universalConsent = null;

        const config = ConfigService.parseConfig(JSON.stringify(raw));

        expect(config).not.toHaveProperty('consentProjectId');
        expect(config).not.toHaveProperty('universalConsent');
      });
    });
  });

  describe('fetchConfig', () => {
    const configUrl = 'https://cdn.example.com/config.json';

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

    it('should fetch and parse config on first call', async () => {
      mockFetchSuccess();

      const config = await configService.fetchConfig(configUrl);

      expect(config.version).toBe('cc959465-747d-4c81-8bc1-5dcd34dc3756');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should cache config after successful fetch', async () => {
      mockFetchSuccess();

      await configService.fetchConfig(configUrl);
      const cached = storage.loadConfigCache();

      expect(cached).not.toBeNull();
      expect(cached!.config.version).toBe('cc959465-747d-4c81-8bc1-5dcd34dc3756');
    });

    it('should return cached config within TTL without fetching', async () => {
      // Pre-populate cache
      const config = ConfigService.parseConfig(testConfigJson);
      storage.saveConfigCache(config, Date.now());

      mockFetchSuccess();

      const result = await configService.fetchConfig(configUrl);

      expect(result.version).toBe(config.version);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return stale cache and revalidate in background when expired', async () => {
      // Pre-populate cache with old timestamp
      const config = ConfigService.parseConfig(testConfigJson);
      storage.saveConfigCache(config, Date.now() - 400_000); // older than 5min TTL

      mockFetchSuccess();

      const result = await configService.fetchConfig(configUrl);

      // Should return stale cache immediately
      expect(result.version).toBe(config.version);

      // Background revalidation should have been triggered
      // Wait for microtask
      await new Promise((resolve) => setImmediate(resolve));
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on non-2xx response when no cache exists', async () => {
      const mockHeaders = new Map<string, string>();
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        text: () => Promise.resolve('Not Found'),
        headers: {
          forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)),
        },
      });

      await expect(configService.fetchConfig(configUrl)).rejects.toThrow(ConsentError);
    });
  });
});
