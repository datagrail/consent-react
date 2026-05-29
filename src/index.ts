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
  WebViewConsentPayload,
  BannerProps,
  PreferenceCenterProps,
} from './types';

export { ConsentError } from './types';

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
} from './ConsentManager';

export { requestTrackingAuthorization, getTrackingStatus } from './platform/att';

export { getConsentPayloadForWebView, getConsentInjectionScript } from './webview/WebViewConsent';

export { Banner } from './ui/Banner';
export { PreferenceCenter } from './ui/PreferenceCenter';
