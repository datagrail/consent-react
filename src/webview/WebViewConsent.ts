import type { WebViewConsentPayload } from '../types';

/**
 * Generate consent payload object for injection into WebViews.
 */
export function getConsentPayloadForWebView(): WebViewConsentPayload {
  // TODO: Agent implements — reads current consent state and builds payload
  throw new Error('Not implemented');
}

/**
 * Generate a JavaScript string that can be injected into a WebView
 * via `injectedJavaScriptBeforeContentLoaded`.
 * Sets `window.__dgConsent` with current consent state.
 */
export function getConsentInjectionScript(): string {
  // TODO: Agent implements
  throw new Error('Not implemented');
}
