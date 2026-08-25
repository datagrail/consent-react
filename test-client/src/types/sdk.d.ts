/**
 * Type declarations for the parent SDK.
 * We re-export all types from the SDK source so TypeScript resolves them
 * without needing to type-check the entire SDK source tree.
 */
declare module '@datagrail.io/react-native-consent' {
  export interface ConsentPreferences {
    isCustomised: boolean;
    cookieOptions: CategoryConsent[];
  }

  export interface CategoryConsent {
    gtmKey: string;
    isEnabled: boolean;
  }

  export type ConsentChangeListener = (preferences: ConsentPreferences) => void;
  export type Unsubscribe = () => void;

  export type ConsentErrorCode =
    | 'NOT_INITIALIZED'
    | 'INVALID_CONFIGURATION'
    | 'NETWORK_ERROR'
    | 'PARSE_ERROR'
    | 'STORAGE_ERROR'
    | 'TIMEOUT';

  export class ConsentError extends Error {
    readonly code: ConsentErrorCode;
    constructor(code: ConsentErrorCode, message: string);
  }

  export type ATTStatus = 'notDetermined' | 'restricted' | 'denied' | 'authorized';

  export interface WebViewConsentPayload {
    consentId: string;
    preferences: ConsentPreferences;
    configVersion: string;
    timestamp: string;
  }

  export interface DataGrailConfig {
    configUrl: string;
  }

  export interface ConsentConfig {
    version: string;
    consentContainerVersionId: string;
    dgCustomerId: string;
    publishDate: number;
    dch: string;
    dc: string | null;
    privacyDomain: string;
    plugins: {
      scriptControl: boolean;
      allCookieSubdomains: boolean;
      cookieBlocking: boolean;
      localStorageBlocking: boolean;
      syncOTConsent: boolean;
    };
    testMode: boolean;
    ignoreDoNotTrack: boolean;
    trackingDetailsUrl: string;
    consentMode: 'optin' | 'optout' | 'informational';
    showBanner: boolean;
    consentPolicy: {
      name: string;
      default: boolean;
    };
    gppUsNat: boolean;
    initialCategories: {
      respectGpc: boolean;
      respectDnt: boolean;
      respectOptout: boolean;
      initial: string[];
      gpc: string[];
      optout: string[];
    };
    layout: {
      id: string;
      name: string;
      description: string | null;
      status: string;
      defaultLayout: boolean;
      collapsedOnMobile: boolean;
      firstLayerId: string;
      gpcDntLayerId: string | null;
      consentLayers: Record<string, unknown>;
    };
  }

  export interface BannerProps {
    onConsentSaved?: (preferences: ConsentPreferences) => void;
    onDismiss?: () => void;
    locale?: string;
    displayStyle?: 'modal' | 'fullScreen';
  }

  export interface PreferenceCenterProps {
    onSave?: (preferences: ConsentPreferences) => void;
    onCancel?: () => void;
    locale?: string;
    showTrackingDetails?: boolean;
  }

  // Functions
  export function initialize(config: DataGrailConfig): Promise<void>;
  export function showBanner(): void;
  export function needsConsent(): boolean;
  export function isCategoryEnabled(category: string): boolean;
  export function getPreferences(): ConsentPreferences | null;
  export function getCategories(): ConsentPreferences | null;
  export function getConfig(): ConsentConfig | null;
  export function savePreferences(prefs: ConsentPreferences): Promise<void>;
  export function acceptAll(): Promise<void>;
  export function rejectAll(): Promise<void>;
  export function onConsentChanged(listener: ConsentChangeListener): Unsubscribe;
  export function reset(): void;
  export function hasUserConsent(): boolean;
  export function retryPendingRequests(): Promise<{ success: number; failed: number }>;
  export function trackBannerShown(): Promise<void>;
  export function requestTrackingAuthorization(): Promise<ATTStatus>;
  export function getTrackingStatus(): ATTStatus;
  export function getConsentPayloadForWebView(): WebViewConsentPayload;
  export function getConsentInjectionScript(): string;

  // Components
  export function Banner(props: BannerProps): React.JSX.Element;
  export function PreferenceCenter(props: PreferenceCenterProps): React.JSX.Element;
}
