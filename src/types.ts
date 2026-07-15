/**
 * Configuration passed to initialize().
 */
export interface DataGrailConfig {
  /**
   * Full HTTPS URL to the consent configuration endpoint.
   * e.g. "https://cdn.cookielaw.datagrail.io/<customer-id>/config.json"
   */
  configUrl: string;
}

/**
 * Root configuration object returned by the config endpoint.
 * Matches the native iOS/Android SDK config schema exactly.
 */
export interface ConsentConfig {
  version: string;
  consentContainerVersionId: string;
  dgCustomerId: string;
  /** Publish timestamp (milliseconds) — JSON field name is "p" */
  publishDate: number;
  dch: string;
  dc: string | null;
  privacyDomain: string;
  plugins: Plugins;
  testMode: boolean;
  ignoreDoNotTrack: boolean;
  trackingDetailsUrl: string;
  consentMode: ConsentMode;
  showBanner: boolean;
  consentPolicy: ConsentPolicy;
  gppUsNat: boolean;
  initialCategories: InitialCategories;
  layout: Layout;
}

export type ConsentMode = 'optin' | 'optout' | 'informational';

export interface Plugins {
  scriptControl: boolean;
  allCookieSubdomains: boolean;
  cookieBlocking: boolean;
  localStorageBlocking: boolean;
  syncOTConsent: boolean;
}

export interface ConsentPolicy {
  name: string;
  default: boolean;
}

export interface InitialCategories {
  respectGpc: boolean;
  respectDnt: boolean;
  respectOptout: boolean;
  /** Categories enabled by default */
  initial: string[];
  /** Categories enabled when GPC signal detected */
  gpc: string[];
  /** Categories enabled when opt-out signal detected */
  optout: string[];
}

export interface Layout {
  id: string;
  name: string;
  description: string | null;
  status: string;
  defaultLayout: boolean;
  collapsedOnMobile: boolean;
  firstLayerId: string;
  gpcDntLayerId: string | null;
  consentLayers: Record<string, ConsentLayer>;
}

export interface ConsentLayer {
  id: string;
  name: string;
  position: BannerPosition;
  showCloseButton: boolean;
  bannerApiId: string;
  elements: ConsentLayerElement[];
}

export type BannerPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface ConsentLayerElement {
  id: string;
  order: number;
  type: ElementType;
  // Text element
  style?: string | null;
  // Button element
  buttonAction?: ButtonAction | null;
  targetConsentLayer?: string | null;
  categories?: string[];
  // Link element
  links?: LinkItem[];
  // Category element
  consentLayerCategories?: ConsentLayerCategory[];
  showTrackingDetailsLink?: boolean;
  consentLayerCategoriesConfigId?: string;
  trackingDetailsLinkTranslations?: Record<string, TrackingDetailsLinkTranslation>;
  // Browser signal notice
  showIcon?: boolean;
  consentLayerBrowserSignalNoticeConfigId?: string;
  browserSignalNoticeTranslations?: Record<string, BrowserSignalNoticeTranslation>;
  // Tracking details element
  showTrackingServices?: boolean;
  showCookies?: boolean;
  showIcons?: boolean;
  groupByVendor?: boolean;
  // Common
  translations?: Record<string, ElementTranslation>;
}

export type ElementType =
  | 'ConsentLayerTextElement'
  | 'ConsentLayerButtonElement'
  | 'ConsentLayerLinkElement'
  | 'ConsentLayerCategoryElement'
  | 'ConsentLayerBrowserSignalNoticeElement'
  | 'ConsentLayerTrackingDetailsElement';

export type ButtonAction =
  | 'accept_all'
  | 'reject_all'
  | 'save_preferences'
  | 'open_layer'
  | 'custom'
  | 'noop';

export interface ElementTranslation {
  id?: string;
  locale?: string;
  value?: string;
  text?: string;
  url?: string;
}

export interface LinkItem {
  id: string;
  order: number;
  translations: Record<string, ElementTranslation>;
}

export interface TrackingDetailsLinkTranslation {
  id?: string;
  locale?: string;
  value?: string;
}

export interface BrowserSignalNoticeTranslation {
  id?: string;
  locale?: string;
  value?: string;
}

export interface ConsentLayerCategory {
  id: string;
  consentCategoryId: string;
  order: number;
  hidden: boolean;
  primitive: string;
  alwaysOn: boolean;
  gtmKey: string;
  uuids: string[];
  cookiePatterns: string[];
  translations: Record<string, CategoryTranslation>;
  showTrackingDetailsLink: boolean;
}

export interface CategoryTranslation {
  id?: string;
  locale?: string;
  name?: string;
  description?: string;
  essentialLabel?: string;
  trackingDetailsLink?: string;
}

// --- Consent State Types ---

export interface ConsentPreferences {
  isCustomised: boolean;
  cookieOptions: CategoryConsent[];
}

export interface CategoryConsent {
  gtmKey: string;
  isEnabled: boolean;
}

// --- Event Types ---

export type ConsentChangeListener = (preferences: ConsentPreferences) => void;
export type Unsubscribe = () => void;

// --- Error Types ---

export type ConsentErrorCode =
  | 'NOT_INITIALIZED'
  | 'INVALID_CONFIGURATION'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'STORAGE_ERROR'
  | 'TIMEOUT';

export class ConsentError extends Error {
  readonly code: ConsentErrorCode;

  constructor(code: ConsentErrorCode, message: string) {
    super(message);
    this.name = 'ConsentError';
    this.code = code;
  }
}

// --- ATT Types (iOS only) ---

export type ATTStatus =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'authorized';

// --- WebView Types ---

export interface WebViewConsentPayload {
  consentId: string;
  preferences: ConsentPreferences;
  configVersion: string;
  timestamp: string;
}

// --- Banner UI Props ---

export interface BannerProps {
  /** Called after preferences are saved via the banner UI */
  onConsentSaved?: (preferences: ConsentPreferences) => void;
  /** Called when banner is dismissed without saving */
  onDismiss?: () => void;
  /** Override locale (default: 'en' — device locale detection is not implemented) */
  locale?: string;
  /** Override display style */
  displayStyle?: 'modal' | 'fullScreen';
}

export interface PreferenceCenterProps {
  /** Called after preferences are saved */
  onSave?: (preferences: ConsentPreferences) => void;
  /** Called when user cancels */
  onCancel?: () => void;
  /** Override locale (default: 'en' — device locale detection is not implemented) */
  locale?: string;
  /** Show tracking details expansion */
  showTrackingDetails?: boolean;
}
