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
- **Universal Consent** — One consent choice follows the user across your web site and apps
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

| Method                 | Parameters                        | Return Type                                    | Description                                                  |
| ---------------------- | --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `initialize`           | `config: DataGrailConfig`         | `Promise<void>`                                | Initialize the SDK. Must be called before all other methods. |
| `needsConsent`         | —                                 | `boolean`                                      | Whether the consent banner should be displayed.              |
| `showBanner`           | —                                 | `void`                                         | Trigger banner display (delegates to UI layer).              |
| `isCategoryEnabled`    | `category: string`                | `boolean`                                      | Synchronously check if a consent category is enabled.        |
| `getPreferences`       | —                                 | `ConsentPreferences \| null`                   | Get current saved consent preferences.                       |
| `getCategories`        | —                                 | `ConsentPreferences \| null`                   | Get consent categories (saved or defaults from config).      |
| `getConfig`            | —                                 | `ConsentConfig \| null`                        | Get the parsed remote configuration.                         |
| `savePreferences`      | `prefs: ConsentPreferences`       | `Promise<void>`                                | Save consent preferences and sync to backend.                |
| `acceptAll`            | —                                 | `Promise<void>`                                | Accept all consent categories.                               |
| `rejectAll`            | —                                 | `Promise<void>`                                | Reject all non-essential categories.                         |
| `onConsentChanged`     | `listener: ConsentChangeListener` | `Unsubscribe`                                  | Subscribe to consent changes. Returns unsubscribe function.  |
| `reset`                | —                                 | `void`                                         | Clear all stored consent state and reset SDK.                |
| `hasUserConsent`       | —                                 | `boolean`                                      | Whether the user has previously made a consent choice.       |
| `retryPendingRequests` | —                                 | `Promise<{ success: number; failed: number }>` | Manually retry queued network requests.                      |
| `trackBannerShown`     | —                                 | `Promise<void>`                                | Send analytics event that banner was displayed.              |

### Universal Consent Methods

Cross-device consent. Available when `universalConsent.enabled` is set on your DataGrail config; otherwise these throw a `ConsentError`.

| Method                          | Parameters                                                               | Return Type                               | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| `isUniversalConsentEnabled`     | —                                                                        | `boolean`                                 | Whether cross-device consent is enabled for the loaded config.           |
| `fetchUniversalConsent`         | `identifier: string, apiKey: string, trackingSignal?: ATTStatus`         | `Promise<UniversalConsentRecord \| null>` | Read a stored record **without** changing local state. `null` on a miss. |
| `rehydrateFromUniversalConsent` | `identifier: string, apiKey: string, trackingSignal?: ATTStatus`         | `Promise<boolean>`                        | Read a stored record **and apply it** to local state. `false` on a miss. |
| `setUserIdentifier`             | `identifier: string, options: { apiKey, getSignature, trackingSignal? }` | `Promise<void>`                           | Register a user identifier and sync their consent. Reads, then writes.   |

### ATT Methods (iOS)

| Method                         | Parameters | Return Type          | Description                                          |
| ------------------------------ | ---------- | -------------------- | ---------------------------------------------------- |
| `requestTrackingAuthorization` | —          | `Promise<ATTStatus>` | Prompt iOS ATT dialog and persist resulting consent. |
| `getTrackingStatus`            | —          | `ATTStatus`          | Get current ATT status synchronously.                |

### WebView Methods

| Method                        | Parameters | Return Type             | Description                                               |
| ----------------------------- | ---------- | ----------------------- | --------------------------------------------------------- |
| `getConsentPayloadForWebView` | —          | `WebViewConsentPayload` | Get structured consent payload for WebView injection.     |
| `getConsentInjectionScript`   | —          | `string`                | Get injectable JavaScript that sets `window.__dgConsent`. |

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

// --- Universal Consent ---

interface UniversalConsentSignature {
  signature: string; // hex HMAC-SHA256, computed by your backend
  keyId: string; // identifies which secret was used (supports rotation)
  timestamp: number; // unix seconds that were signed over
}

type SignatureProvider = (
  customerId: string,
  userHash: string,
) => Promise<UniversalConsentSignature>;

// Note the shape difference: Universal Consent uses a MAP of category keys,
// while the local ConsentPreferences above uses an array.
interface UniversalConsentPreferences {
  isCustomised: boolean;
  cookieOptions: Record<string, boolean>;
}

interface UniversalConsentRecord {
  status: string;
  consentPreferences: UniversalConsentPreferences | null;
  consentMode: string | null;
  ccpaOptout: boolean;
  platform: string | null;
  policyName: string | null;
  configVersion: string | null;
  updatedAt: string | null;
  gpc: boolean;
  tcfString: string | null;
  gppString: string | null;
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

| Prop             | Type                                        | Description                                      |
| ---------------- | ------------------------------------------- | ------------------------------------------------ |
| `onConsentSaved` | `(preferences: ConsentPreferences) => void` | Called after preferences are saved via banner UI |
| `onDismiss`      | `() => void`                                | Called when banner is dismissed without saving   |
| `locale`         | `string`                                    | Override locale (default: device locale)         |
| `displayStyle`   | `'modal' \| 'fullScreen'`                   | Override display style                           |

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

| Prop                  | Type                                        | Description                        |
| --------------------- | ------------------------------------------- | ---------------------------------- |
| `onSave`              | `(preferences: ConsentPreferences) => void` | Called after preferences are saved |
| `onCancel`            | `() => void`                                | Called when user cancels           |
| `locale`              | `string`                                    | Override locale                    |
| `showTrackingDetails` | `boolean`                                   | Show tracking details expansion    |

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

## Universal Consent

Universal Consent lets one person's choice follow them across your web site and your mobile apps. Someone who opts out of marketing on your web site should not be re-prompted — or re-tracked — when they open the app.

Enable it on your DataGrail config, then wire it up once you know who the user is.

### 1. Provide a signature endpoint

Writes are HMAC-signed. The SDK **never** holds your shared secret — it asks your backend to sign, and your backend returns the signature. Add an authenticated endpoint that computes `HMAC-SHA256(secret, "{customerId}:{userHash}:{timestamp}")`:

```typescript
import type { SignatureProvider } from '@datagrail/react-native-consent';

const getSignature: SignatureProvider = async (customerId, userHash) => {
  const response = await fetch('https://your-backend.example.com/dg-consent-signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ customerId, userHash }),
  });
  // Your backend returns { signature, keyId, timestamp }
  return response.json();
};
```

Sign only for the currently authenticated user. An endpoint that signs any `userHash` it is handed lets a caller write consent for someone else.

### 2. Rehydrate before you show the banner

Call this after `initialize()` and **before** `needsConsent()`:

```typescript
import {
  initialize,
  rehydrateFromUniversalConsent,
  needsConsent,
} from '@datagrail/react-native-consent';

await initialize({ configUrl: 'https://your-config-url.com/config.json' });

if (user.isLoggedIn) {
  await rehydrateFromUniversalConsent(user.email, DG_API_KEY);
}

if (needsConsent()) {
  // Only prompts users who have not answered anywhere yet
}
```

A returned `false` means no record was stored for that user. Show the banner — **no record is not an opt-out**, it is the absence of any signal.

### 3. Sync after the user answers

When someone logs in or makes a choice, register their identifier. This reads their existing record first and then writes, so a fresh install cannot clobber a richer record the same person built up elsewhere:

```typescript
import { setUserIdentifier } from '@datagrail/react-native-consent';

await setUserIdentifier(user.email, { apiKey: DG_API_KEY, getSignature });
```

To inspect a record without changing local state, use `fetchUniversalConsent` instead.

### How signals are applied

A stored record is authoritative in **both** directions — it overrides local state whether it is more or less permissive. On top of that, opt-out signals suppress non-essential categories locally:

| Signal                                | Source                                              | Effect                              |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| Stored GPC                            | Recorded on the web and carried on the record       | Suppresses non-essential categories |
| Ad-tracking (`denied` / `restricted`) | This device (ATT on iOS, advertising ID on Android) | Suppresses non-essential categories |

Suppression is one-directional: a signal can only turn categories **off**, never on. Permission to track is not consent to a marketing category, and the more privacy-protective signal always wins. Both are applied for you — you do not need to check them yourself.

> **Note:** Pass `trackingSignal` explicitly if you already have the device status in hand; otherwise the SDK reads it.

### Identifier requirements

The identifier is normalized (Unicode NFC → trim → lowercase) and hashed with SHA-256 before it leaves the device — the raw value is never transmitted. Use the same identifier everywhere the person appears (typically their email), or their consent will not match across platforms. An identifier that is empty after normalization is rejected with a `VALIDATION_ERROR`.

Hashing runs in a native module, so Universal Consent requires a development build. It does not work in Expo Go or on React Native Web.

## Expo Support

The SDK includes an Expo config plugin that automatically configures the ATT usage description in your iOS Info.plist.

Add to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "@datagrail/react-native-consent/expo-plugin",
        {
          "trackingDescription": "We use tracking to personalize your experience."
        }
      ]
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

### "DataGrailConsentCrypto native module not found"

Universal Consent hashes the user identifier in a native module, so it needs a development build — it cannot run in Expo Go or on React Native Web.

- Run `cd ios && pod install` after installing or upgrading the package.
- On Expo, run `npx expo prebuild` and use a development build rather than Expo Go.
- Rebuild the app after installing. A JS-only reload will not pick up a new native module.

### Universal Consent methods throw a ConsentError immediately

- `universalConsent.enabled` must be set on your DataGrail config. Check `isUniversalConsentEnabled()`.
- `consentProjectId` must also be present on the config, or reads and writes fail with `VALIDATION_ERROR`.
- An identifier that is empty after normalization (including whitespace-only) is rejected.

### Consent is not following a user across devices

- Confirm the identifier is byte-identical everywhere — the SDK normalizes and hashes it, so `User@Example.com ` and `user@example.com` match, but a username on one platform and an email on another will not.
- Confirm the same `consentProjectId` is configured on every platform. The project ID is part of the hash.
- `rehydrateFromUniversalConsent` returning `false` means no record was stored, not that the read failed. Use `fetchUniversalConsent` to inspect what the server has.

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
