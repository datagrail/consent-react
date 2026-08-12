export type {
  DataGrailConfig,
  ConsentConfig,
  ConsentMode,
  Plugins,
  ConsentPolicy,
  InitialCategories,
  Layout,
  ConsentLayer,
  BannerPosition,
  ConsentLayerElement,
  ElementType,
  ButtonAction,
  ElementTranslation,
  LinkItem,
  TrackingDetailsLinkTranslation,
  BrowserSignalNoticeTranslation,
  ConsentLayerCategory,
  CategoryTranslation,
  ConsentPreferences,
  CategoryConsent,
  ConsentChangeListener,
  Unsubscribe,
  ConsentErrorCode,
  ATTStatus,
  UniversalConsentConfig,
  WebViewConsentPayload,
  BannerProps,
  PreferenceCenterProps,
} from './types';

export { ConsentError } from './types';

export type {
  SignatureProvider,
  UniversalConsentSignature,
  UniversalConsentPreferences,
  UniversalConsentRecord,
} from './universal/types';

export {
  initialize,
  showBanner,
  needsConsent,
  isCategoryEnabled,
  getPreferences,
  getCategories,
  getConfig,
  savePreferences,
  acceptAll,
  rejectAll,
  onConsentChanged,
  reset,
  hasUserConsent,
  retryPendingRequests,
  trackBannerShown,
  isUniversalConsentEnabled,
  fetchUniversalConsent,
  rehydrateFromUniversalConsent,
  setUserIdentifier,
} from './ConsentManager';

export { requestTrackingAuthorization, getTrackingStatus } from './platform/att';

export { getConsentPayloadForWebView, getConsentInjectionScript } from './webview/WebViewConsent';

export { Banner } from './ui/Banner';
export { PreferenceCenter } from './ui/PreferenceCenter';
