import type { WebViewConsentPayload } from '../types';
import { ConsentError } from '../types';
import { getPreferences, getConfig } from '../ConsentManager';

/**
 * Generate consent payload object for injection into WebViews.
 * Reads current consent state from ConsentManager and returns a structured payload.
 *
 * @throws ConsentError with code 'NOT_INITIALIZED' if SDK not initialized
 */
export function getConsentPayloadForWebView(): WebViewConsentPayload {
  const preferences = getPreferences();
  const config = getConfig();

  if (!preferences || !config) {
    throw new ConsentError(
      'NOT_INITIALIZED',
      'Cannot generate WebView consent payload: SDK is not initialized or has no consent state.',
    );
  }

  return {
    consentId: config.consentContainerVersionId,
    preferences,
    configVersion: config.version,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate a JavaScript string that can be injected into a WebView
 * via `injectedJavaScriptBeforeContentLoaded`.
 *
 * Sets `window.__dgConsent` with current consent state, sets
 * `window.__dgConsentReady = true`, and dispatches a 'dgConsentReady'
 * CustomEvent on document.
 *
 * @throws ConsentError with code 'NOT_INITIALIZED' if SDK not initialized
 */
export function getConsentInjectionScript(): string {
  const payload = getConsentPayloadForWebView();
  const payloadJson = JSON.stringify(payload);

  return `(function(){window.__dgConsent=${payloadJson};window.__dgConsentReady=true;document.dispatchEvent(new CustomEvent('dgConsentReady'));})();`;
}
