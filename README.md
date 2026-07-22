# @datagrail/react-native-consent

[![npm version](https://img.shields.io/npm/v/@datagrail/react-native-consent.svg)](https://www.npmjs.com/package/@datagrail/react-native-consent)
[![CI](https://github.com/datagrail/react-native-consent/actions/workflows/ci.yml/badge.svg)](https://github.com/datagrail/react-native-consent/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

Privacy consent management SDK for React Native 0.76+ (New Architecture). Config-driven consent banners, synchronous preference reads via MMKV, offline resilience, ATT integration, and WebView consent injection — all from a single cross-platform package.

## Features

- **Config-driven UI** — Banner and PreferenceCenter render from your DataGrail configuration
- **Synchronous reads** — `isCategoryEnabled()` returns instantly via MMKV storage
- **Offline resilience** — Failed network requests are queued and retried with exponential backoff
- **ATT integration** — iOS App Tracking Transparency with automatic consent category mapping
- **WebView support** — Inject consent state into WebViews for consistent cross-context privacy
- **Expo compatible** — Config plugin auto-configures ATT usage description
- **Dark mode** — Built-in theme system with light/dark mode support
- **Type-safe** — Strict TypeScript throughout, no `any` types

## Installation

```bash
npm install @datagrail/react-native-consent
```

For iOS, install CocoaPods dependencies:

```bash
cd ios && pod install
```

> **Note:** This SDK requires React Native 0.76.0+ with the New Architecture enabled. It bundles `react-native-mmkv` as a dependency.

## Quick Start

```typescript
import {
  initialize,
  needsConsent,
  isCategoryEnabled,
  onConsentChanged,
} from '@datagrail/react-native-consent';
import { Banner } from '@datagrail/react-native-consent';

// Initialize at app startup
await initialize({
  configUrl: 'https://cdn.datagrail.io/your-customer-id/config.json',
});

// Check if consent banner should be shown
if (needsConsent()) {
  // Render <Banner /> component in your UI
}

// Check consent synchronously anywhere in your app
if (isCategoryEnabled('dg-category-analytics')) {
  // Safe to enable analytics
}

// Listen for consent changes
const unsubscribe = onConsentChanged((preferences) => {
  console.log('Consent updated:', preferences);
});
```

## API Reference

### Core Methods

| Method | Parameters | Return Type | Description |
|--------|-----------|-------------|-------------|
| `initialize` | `config: DataGrailConfig` | `Promise<void>` | Initialize the SDK. Must be called before all other methods. |
| `needsConsent` | — | `boolean` | Whether the consent banner should be displayed. |
| `showBanner` | — | `void` | Trigger banner display (delegates to UI layer). |
| `isCategoryEnabled` | `category: string` | `boolean` | Synchronously check if a consent category is enabled. |
| `getPreferences` | — | `ConsentPreferences \| null` | Get current saved consent preferences. |
| `getCategories` | — | `ConsentPreferences \| null` | Get consent categories (saved or defaults from config). |
| `getConfig` | — | `ConsentConfig \| null` | Get the parsed remote configuration. |
| `savePreferences` | `prefs: ConsentPreferences` | `Promise<void>` | Save consent preferences and sync to backend. |
| `acceptAll` | — | `Promise<void>` | Accept all consent categories. |
| `rejectAll` | — | `Promise<void>` | Reject all non-essential categories. |
| `onConsentChanged` | `listener: ConsentChangeListener` | `Unsubscribe` | Subscribe to consent changes. Returns unsubscribe function. |
| `reset` | — | `void` | Clear all stored consent state and reset SDK. |
| `hasUserConsent` | — | `boolean` | Whether the user has previously made a consent choice. |
| `retryPendingRequests` | — | `Promise<{ success: number; failed: number }>` | Manually retry queued network requests. |
| `trackBannerShown` | — | `Promise<void>` | Send analytics event that banner was displayed. |

### ATT Methods (iOS)

| Method | Parameters | Return Type | Description |
|--------|-----------|-------------|-------------|
| `requestTrackingAuthorization` | — | `Promise<ATTStatus>` | Prompt iOS ATT dialog and persist resulting consent. |
| `getTrackingStatus` | — | `ATTStatus` | Get current ATT status synchronously. |

### WebView Methods

| Method | Parameters | Return Type | Description |
|--------|-----------|-------------|-------------|
| `getConsentPayloadForWebView` | — | `WebViewConsentPayload` | Get structured consent payload for WebView injection. |
| `getConsentInjectionScript` | — | `string` | Get injectable JavaScript that sets `window.__dgConsent`. |

### Types

```typescript
interface DataGrailConfig {
  configUrl: string; // HTTPS URL to config endpoint
}

interface ConsentPreferences {
  isCustomised: boolean;
  cookieOptions: CategoryConsent[];
}

interface CategoryConsent {
  gtmKey: string;
  isEnabled: boolean;
}

type ConsentChangeListener = (preferences: ConsentPreferences) => void;
type Unsubscribe = () => void;

type ATTStatus = 'notDetermined' | 'restricted' | 'denied' | 'authorized';

interface WebViewConsentPayload {
  consentId: string;
  preferences: ConsentPreferences;
  configVersion: string;
  timestamp: string;
}
```

## Components

### Banner

Config-driven consent banner that renders based on your DataGrail layout configuration.

```typescript
import { Banner } from '@datagrail/react-native-consent';

<Banner
  onConsentSaved={(preferences) => console.log('Saved:', preferences)}
  onDismiss={() => console.log('Banner dismissed')}
  locale="en"
  displayStyle="modal"
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `onConsentSaved` | `(preferences: ConsentPreferences) => void` | Called after preferences are saved via banner UI |
| `onDismiss` | `() => void` | Called when banner is dismissed without saving |
| `locale` | `string` | Override locale (default: device locale) |
| `displayStyle` | `'modal' \| 'fullScreen'` | Override display style |

### PreferenceCenter

Category toggle UI for granular consent management.

```typescript
import { PreferenceCenter } from '@datagrail/react-native-consent';

<PreferenceCenter
  onSave={(preferences) => console.log('Saved:', preferences)}
  onCancel={() => navigation.goBack()}
  showTrackingDetails={true}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `onSave` | `(preferences: ConsentPreferences) => void` | Called after preferences are saved |
| `onCancel` | `() => void` | Called when user cancels |
| `locale` | `string` | Override locale |
| `showTrackingDetails` | `boolean` | Show tracking details expansion |

## ATT Integration

For iOS App Tracking Transparency support:

### 1. Add Info.plist key

Add `NSUserTrackingUsageDescription` to your `ios/<app>/Info.plist`:

```xml
<key>NSUserTrackingUsageDescription</key>
<string>We use tracking to personalize your experience and measure ad effectiveness.</string>
```

### 2. Request authorization

```typescript
import { requestTrackingAuthorization, getTrackingStatus } from '@datagrail/react-native-consent';

// Prompt the user (shows native iOS dialog)
const status = await requestTrackingAuthorization();
// status: 'notDetermined' | 'restricted' | 'denied' | 'authorized'

// The SDK automatically maps the ATT result to consent preferences:
// - 'authorized' → marketing category enabled
// - 'denied' → marketing category disabled

// Check current status without prompting
const currentStatus = getTrackingStatus();
```

> **Note:** `requestTrackingAuthorization` automatically persists the ATT result as a consent preference update for the `dg-category-marketing` category.

## WebView Support

Inject consent state into WebViews so your web content respects the same consent choices:

```typescript
import { getConsentInjectionScript } from '@datagrail/react-native-consent';
import { WebView } from 'react-native-webview';

function MyWebView() {
  const injectionScript = getConsentInjectionScript();

  return (
    <WebView
      source={{ uri: 'https://your-site.com' }}
      injectedJavaScriptBeforeContentLoaded={injectionScript}
    />
  );
}
```

The injection script sets:
- `window.__dgConsent` — full consent payload object
- `window.__dgConsentReady` — boolean flag
- Dispatches a `dgConsentReady` CustomEvent on `document`

Your web code can listen for consent:

```javascript
document.addEventListener('dgConsentReady', () => {
  const consent = window.__dgConsent;
  // Use consent.preferences.cookieOptions to gate scripts
});
```

## Expo Support

The SDK includes an Expo config plugin that automatically configures the ATT usage description in your iOS Info.plist.

Add to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      ["@datagrail/react-native-consent/expo-plugin", {
        "trackingDescription": "We use tracking to personalize your experience."
      }]
    ]
  }
}
```

If no `trackingDescription` is provided, a default message is used. Run `npx expo prebuild` to apply the plugin.

## Offline Support

The SDK is designed for unreliable network conditions:

- **Config caching** — Remote configuration is cached in MMKV. If a network fetch fails, the SDK falls back to the cached config.
- **Offline queue** — When `savePreferences`, `acceptAll`, or `rejectAll` cannot reach the backend, the request is queued in persistent storage.
- **Exponential backoff** — Queued requests are retried with exponential backoff when connectivity returns.
- **Manual retry** — Call `retryPendingRequests()` to explicitly drain the offline queue (e.g., when your app detects connectivity restored).
- **Non-blocking** — Consent reads (`isCategoryEnabled`, `getPreferences`) always work synchronously from local MMKV storage, regardless of network state.

## Configuration

The SDK is driven by a remote JSON configuration hosted at your `configUrl`. This config controls:

- **Consent mode** — `optin`, `optout`, or `informational`
- **Categories** — Which consent categories exist and their defaults
- **Layout** — Banner structure, buttons, text, positioning
- **Policy** — Consent policy rules and initial category states
- **GPC/DNT** — Whether to respect Global Privacy Control and Do Not Track signals

The config is fetched on `initialize()` and cached locally. Subsequent launches use the cache while fetching a fresh copy in the background. A version change in the config triggers reconsent (`needsConsent()` returns `true`).

### Config URL format

```
https://cdn.datagrail.io/<customer-id>/config.json
```

Contact your DataGrail account team to obtain your config URL.

## Troubleshooting

### "SDK not initialized" error

Ensure `initialize()` has completed (awaited) before calling any other SDK method. Common pattern:

```typescript
// App.tsx
useEffect(() => {
  initialize({ configUrl: '...' }).catch(console.error);
}, []);
```

### MMKV build errors on iOS

Run `cd ios && pod install` after installing the package. If you see architecture issues, ensure your Podfile sets the correct deployment target (iOS 13.4+).

### Banner not showing

Check that:
1. `needsConsent()` returns `true`
2. Your config has `showBanner: true`
3. The `<Banner />` component is rendered in your component tree

### ATT dialog not appearing

- The ATT dialog only shows once per app install. After the user responds, `requestTrackingAuthorization()` returns the cached status without showing a dialog.
- Ensure `NSUserTrackingUsageDescription` is in your Info.plist.
- ATT is only available on iOS 14+.

### TypeScript type errors

This package ships with full TypeScript declarations. Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

### Network requests failing silently

By design, network failures for consent sync are non-blocking. Requests are queued and retried. To debug, check `retryPendingRequests()` return value for `{ success, failed }` counts.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

### End-to-end tests

The test client uses Maestro for Android and iOS end-to-end testing. See the
[Maestro E2E guide](./test-client/e2e/README.md) for platform commands,
individual flow execution, milestone screenshots, debug output, and JUnit
report locations.

## License

[Apache 2.0](./LICENSE)
