import type { ConsentConfig } from '../types';

/**
 * Raw JSON shape from the config endpoint — uses snake_case.
 * ConfigService parses this into the camelCase ConsentConfig.
 */
export interface RawConsentConfig {
  version: string;
  consentContainerVersionId: string;
  dgCustomerId: string;
  p: number;
  dch: string;
  dc: string | null;
  privacyDomain: string;
  plugins: {
    scriptControl: boolean;
    allCookieSubdomains: boolean;
    cookieBlocking: boolean;
    localStorageBlocking: boolean;
    syncOTConsent?: boolean;
  };
  testMode: boolean;
  ignoreDoNotTrack: boolean;
  trackingDetailsUrl: string;
  consentMode: string;
  showBanner: boolean;
  consentPolicy: { name: string; default: boolean };
  gppUsNat: boolean;
  initialCategories: {
    respect_gpc: boolean;
    respect_dnt: boolean;
    respect_optout: boolean;
    initial: string[];
    gpc: string[];
    optout: string[];
  };
  layout: RawLayout;
}

export interface RawLayout {
  id: string;
  name: string;
  description: string | null;
  status: string;
  default_layout: boolean;
  collapsed_on_mobile: boolean;
  first_layer_id: string;
  gpc_dnt_layer_id?: string | null;
  consent_layers: Record<string, RawConsentLayer>;
}

export interface RawConsentLayer {
  id: string;
  name: string;
  position: string;
  show_close_button: boolean;
  banner_api_id: string;
  elements: RawConsentLayerElement[];
}

export interface RawConsentLayerElement {
  id: string;
  order: number;
  type: string;
  style?: string | null;
  button_action?: string | null;
  target_consent_layer?: string | null;
  categories?: string[];
  links?: Array<{
    id: string;
    order: number;
    translations: Record<string, Record<string, string | undefined>>;
  }>;
  consent_layer_categories?: Array<{
    id: string;
    consent_category_id: string;
    order: number;
    hidden: boolean;
    primitive: string;
    always_on: boolean;
    gtm_key: string;
    uuids: string[];
    cookie_patterns: string[];
    translations: Record<string, Record<string, string | null | undefined>>;
    show_tracking_details_link: boolean;
  }>;
  show_tracking_details_link?: boolean;
  consent_layer_categories_config_id?: string;
  tracking_details_link_translations?:
    | Record<string, { id?: string; locale?: string; value?: string }>
    | Array<{ id?: string; locale?: string; value?: string }>;
  show_icon?: boolean;
  consent_layer_browser_signal_notice_config_id?: string;
  browser_signal_notice_translations?: Record<
    string,
    { id?: string; locale?: string; value?: string }
  >;
  show_tracking_services?: boolean;
  show_cookies?: boolean;
  show_icons?: boolean;
  group_by_vendor?: boolean;
  translations?: Record<string, Record<string, string | undefined>>;
}

export interface ConfigServiceOptions {
  /** Config fetch timeout in ms (default: 30000) */
  timeout?: number;
  /** Cache TTL in ms (default: 300000 = 5 min) */
  cacheTtl?: number;
}

export type ParsedConfig = ConsentConfig;
