import type {
  CategoryTranslation,
  ConsentConfig,
  ConsentLayer,
  ConsentLayerCategory,
  ConsentLayerElement,
  InitialCategories,
  Layout,
  LinkItem,
  TrackingDetailsLinkTranslation,
  BrowserSignalNoticeTranslation,
  BannerPosition,
  ElementType,
  ButtonAction,
} from '../types';
import { ConsentError } from '../types';
import type { NetworkService } from '../network/NetworkService';
import { retryWithBackoff } from '../network/RetryPolicy';
import type { StorageService } from '../storage/StorageService';
import type {
  ConfigServiceOptions,
  RawConsentConfig,
  RawConsentLayer,
  RawConsentLayerElement,
  RawLayout,
} from './types';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches remote config, parses snake_case JSON to camelCase types,
 * caches in MMKV with TTL. Supports stale-while-revalidate.
 */
export class ConfigService {
  private readonly cacheTtl: number;

  constructor(
    private readonly network: NetworkService,
    private readonly storage: StorageService,
    private readonly options: ConfigServiceOptions = {},
  ) {
    this.cacheTtl = options.cacheTtl ?? DEFAULT_CACHE_TTL_MS;
  }

  async fetchConfig(configUrl: string): Promise<ConsentConfig> {
    const now = Date.now();
    const cached = this.storage.loadConfigCache();

    // Cache hit within TTL — return immediately
    if (cached && now - cached.timestamp < this.cacheTtl) {
      return cached.config;
    }

    // Stale cache exists — return stale and revalidate in background
    if (cached) {
      this.revalidateInBackground(configUrl);
      return cached.config;
    }

    // No cache — must fetch synchronously
    return this.fetchAndCache(configUrl);
  }

  private async fetchAndCache(configUrl: string): Promise<ConsentConfig> {
    const response = await retryWithBackoff(() =>
      this.network.request({
        url: configUrl,
        method: 'GET',
        timeoutMs: this.options.timeout ?? 30_000,
      }),
    );

    if (response.status < 200 || response.status >= 300) {
      throw new ConsentError('NETWORK_ERROR', `Config fetch failed with status ${response.status}`);
    }

    const config = ConfigService.parseConfig(response.data);
    this.storage.saveConfigCache(config, Date.now());
    return config;
  }

  private revalidateInBackground(configUrl: string): void {
    // Fire and forget — errors are silently swallowed
    this.fetchAndCache(configUrl).catch(() => {
      // Intentionally swallowed — stale cache is already being served
    });
  }

  /**
   * Parse raw snake_case JSON string into typed ConsentConfig.
   * Exported for testing.
   */
  static parseConfig(raw: string): ConsentConfig {
    let parsed: RawConsentConfig;
    try {
      parsed = JSON.parse(raw) as RawConsentConfig;
    } catch {
      throw new ConsentError('PARSE_ERROR', 'Failed to parse config JSON');
    }

    const config: ConsentConfig = {
      version: parsed.version,
      consentContainerVersionId: parsed.consentContainerVersionId,
      dgCustomerId: parsed.dgCustomerId,
      publishDate: parsed.p,
      dch: parsed.dch,
      dc: parsed.dc,
      privacyDomain: parsed.privacyDomain,
      plugins: {
        scriptControl: parsed.plugins.scriptControl,
        allCookieSubdomains: parsed.plugins.allCookieSubdomains,
        cookieBlocking: parsed.plugins.cookieBlocking,
        localStorageBlocking: parsed.plugins.localStorageBlocking,
        syncOTConsent: parsed.plugins.syncOTConsent ?? false,
      },
      testMode: parsed.testMode,
      ignoreDoNotTrack: parsed.ignoreDoNotTrack,
      trackingDetailsUrl: parsed.trackingDetailsUrl,
      consentMode: parsed.consentMode as ConsentConfig['consentMode'],
      showBanner: parsed.showBanner,
      consentPolicy: parsed.consentPolicy,
      gppUsNat: parsed.gppUsNat,
      initialCategories: parseInitialCategories(parsed.initialCategories),
      layout: parseLayout(parsed.layout),
    };

    // Only set when present. These are absent on configs published before Universal Consent
    // existed, and assigning `undefined` explicitly would break exactOptionalPropertyTypes-style
    // consumers while telling us nothing the omission doesn't.
    if (parsed.consentProjectId) {
      config.consentProjectId = parsed.consentProjectId;
    }
    if (parsed.universalConsent) {
      config.universalConsent = {
        enabled: parsed.universalConsent.enabled ?? false,
        syncOptout: parsed.universalConsent.sync_optout ?? false,
      };
    }

    return config;
  }
}

function parseInitialCategories(raw: RawConsentConfig['initialCategories']): InitialCategories {
  return {
    respectGpc: raw.respect_gpc,
    respectDnt: raw.respect_dnt,
    respectOptout: raw.respect_optout,
    initial: raw.initial,
    gpc: raw.gpc,
    optout: raw.optout,
  };
}

function parseLayout(raw: RawLayout): Layout {
  const consentLayers: Record<string, ConsentLayer> = {};

  for (const [key, rawLayer] of Object.entries(raw.consent_layers)) {
    consentLayers[key] = parseConsentLayer(rawLayer);
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    defaultLayout: raw.default_layout,
    collapsedOnMobile: raw.collapsed_on_mobile,
    firstLayerId: raw.first_layer_id,
    gpcDntLayerId: raw.gpc_dnt_layer_id ?? null,
    consentLayers,
  };
}

function parseConsentLayer(raw: RawConsentLayer): ConsentLayer {
  return {
    id: raw.id,
    name: raw.name,
    position: raw.position as BannerPosition,
    showCloseButton: raw.show_close_button,
    bannerApiId: raw.banner_api_id,
    elements: raw.elements.map(parseConsentLayerElement),
  };
}

function parseConsentLayerElement(raw: RawConsentLayerElement): ConsentLayerElement {
  const element: ConsentLayerElement = {
    id: raw.id,
    order: raw.order,
    type: raw.type as ElementType,
  };

  if (raw.style !== undefined) element.style = raw.style;
  if (raw.button_action !== undefined) element.buttonAction = raw.button_action as ButtonAction;
  if (raw.target_consent_layer !== undefined) element.targetConsentLayer = raw.target_consent_layer;
  if (raw.categories !== undefined) element.categories = raw.categories;

  if (raw.links !== undefined) {
    element.links = raw.links.map(
      (link): LinkItem => ({
        id: link.id,
        order: link.order,
        translations: link.translations as Record<
          string,
          { id?: string; locale?: string; text?: string; url?: string }
        >,
      }),
    );
  }

  if (raw.consent_layer_categories !== undefined) {
    element.consentLayerCategories = raw.consent_layer_categories.map(
      (cat): ConsentLayerCategory => ({
        id: cat.id,
        consentCategoryId: cat.consent_category_id,
        order: cat.order,
        hidden: cat.hidden,
        primitive: cat.primitive,
        alwaysOn: cat.always_on,
        gtmKey: cat.gtm_key,
        uuids: cat.uuids,
        cookiePatterns: cat.cookie_patterns,
        translations: parseCategoryTranslations(cat.translations),
        showTrackingDetailsLink: cat.show_tracking_details_link,
      }),
    );
  }

  if (raw.show_tracking_details_link !== undefined) {
    element.showTrackingDetailsLink = raw.show_tracking_details_link;
  }

  if (raw.consent_layer_categories_config_id !== undefined) {
    element.consentLayerCategoriesConfigId = raw.consent_layer_categories_config_id;
  }

  if (raw.tracking_details_link_translations !== undefined) {
    element.trackingDetailsLinkTranslations = parseTrackingDetailsLinkTranslations(
      raw.tracking_details_link_translations,
    );
  }

  if (raw.show_icon !== undefined) element.showIcon = raw.show_icon;
  if (raw.consent_layer_browser_signal_notice_config_id !== undefined) {
    element.consentLayerBrowserSignalNoticeConfigId =
      raw.consent_layer_browser_signal_notice_config_id;
  }

  if (raw.browser_signal_notice_translations !== undefined) {
    element.browserSignalNoticeTranslations = raw.browser_signal_notice_translations as Record<
      string,
      BrowserSignalNoticeTranslation
    >;
  }

  if (raw.show_tracking_services !== undefined)
    element.showTrackingServices = raw.show_tracking_services;
  if (raw.show_cookies !== undefined) element.showCookies = raw.show_cookies;
  if (raw.show_icons !== undefined) element.showIcons = raw.show_icons;
  if (raw.group_by_vendor !== undefined) element.groupByVendor = raw.group_by_vendor;

  if (raw.translations !== undefined) {
    element.translations = raw.translations as Record<
      string,
      { id?: string; locale?: string; value?: string; text?: string; url?: string }
    >;
  }

  return element;
}

/**
 * Convert per-locale category translation objects (snake_case wire keys)
 * to CategoryTranslation (camelCase). `id`, `locale`, `name`, `description`
 * pass through unchanged; `essential_label`/`tracking_details_link` are renamed.
 */
function parseCategoryTranslations(
  raw: Record<string, Record<string, string | null | undefined>>,
): Record<string, CategoryTranslation> {
  const result: Record<string, CategoryTranslation> = {};
  for (const [locale, t] of Object.entries(raw)) {
    result[locale] = {
      id: t.id ?? undefined,
      locale: t.locale ?? undefined,
      name: t.name ?? undefined,
      description: t.description ?? undefined,
      essentialLabel: t.essential_label ?? undefined,
      trackingDetailsLink: t.tracking_details_link ?? undefined,
    };
  }
  return result;
}

/**
 * Handle tracking_details_link_translations which can be either:
 * - An array with `locale` field on each item
 * - A dict keyed by locale
 */
function parseTrackingDetailsLinkTranslations(
  raw: RawConsentLayerElement['tracking_details_link_translations'],
): Record<string, TrackingDetailsLinkTranslation> {
  if (raw === undefined) return {};

  // If it's already a dict keyed by locale
  if (!Array.isArray(raw)) {
    return raw as Record<string, TrackingDetailsLinkTranslation>;
  }

  // If it's an array, convert to dict keyed by locale
  const result: Record<string, TrackingDetailsLinkTranslation> = {};
  for (const item of raw) {
    if (item.locale) {
      result[item.locale] = item;
    }
  }
  return result;
}
