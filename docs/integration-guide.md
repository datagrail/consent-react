# Integration Guide

Step-by-step guide for integrating `@datagrail.io/react-native-consent` into your React Native application.

## Prerequisites

- React Native 0.76.0+ with New Architecture enabled
- iOS 13.4+ deployment target
- Android API 21+ (minSdk)

## 1. Install the Package

```bash
npm install @datagrail.io/react-native-consent
```

## 2. iOS Setup

### Install CocoaPods

```bash
cd ios && pod install && cd ..
```

### Configure ATT (optional but recommended)

If you plan to use App Tracking Transparency, add the usage description to `ios/<YourApp>/Info.plist`:

```xml
<key>NSUserTrackingUsageDescription</key>
<string>We use tracking to personalize your experience and measure ad effectiveness.</string>
```

This key is required by Apple for any app that calls the ATT framework. Without it, your app will crash at runtime when requesting tracking authorization.

## 3. Android Setup

No additional configuration is needed beyond React Native's auto-linking. The SDK's native modules are linked automatically.

If you use ProGuard/R8, no additional rules are required — the SDK does not use reflection.

## 4. Initialize in App Entry Point

Initialize the SDK as early as possible in your app lifecycle. The `initialize` call fetches your consent configuration and loads cached preferences.

```typescript
// App.tsx
import { useEffect, useState } from 'react';
import { initialize, needsConsent } from '@datagrail.io/react-native-consent';

function App() {
  const [ready, setReady] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(false);

  useEffect(() => {
    async function boot() {
      await initialize({
        configUrl: 'https://cdn.datagrail.io/your-customer-id/config.json',
      });
      setShowConsentBanner(needsConsent());
      setReady(true);
    }
    boot().catch(console.error);
  }, []);

  if (!ready) return null; // or splash screen

  return (
    <>
      {showConsentBanner && <ConsentBannerScreen />}
      <MainApp />
    </>
  );
}
```

> **Important:** All other SDK methods throw `ConsentError` with code `NOT_INITIALIZED` if called before `initialize()` resolves.

## 5. Show the Consent Banner

Use the `Banner` component to display the config-driven consent UI:

```typescript
import { Banner } from '@datagrail.io/react-native-consent';

function ConsentBannerScreen() {
  return (
    <Banner
      onConsentSaved={(preferences) => {
        // User made their choice — dismiss banner
        setShowConsentBanner(false);
      }}
      onDismiss={() => {
        // User dismissed without choosing (if allowed by config)
        setShowConsentBanner(false);
      }}
    />
  );
}
```

The banner layout, text, buttons, and categories are all driven by your DataGrail configuration — no hardcoded UI strings needed in your app.

## 6. Check Consent in Feature Code

Gate features and third-party SDKs on consent status:

```typescript
import { isCategoryEnabled } from '@datagrail.io/react-native-consent';

// Before initializing analytics
if (isCategoryEnabled('dg-category-analytics')) {
  initAnalytics();
}

// Before showing personalized ads
if (isCategoryEnabled('dg-category-marketing')) {
  loadPersonalizedAds();
}

// Essential functionality — always enabled
if (isCategoryEnabled('dg-category-essential')) {
  // This is always true for essential categories
}
```

`isCategoryEnabled()` is synchronous and reads from MMKV — safe to call on every render or in hot paths without performance concerns.

## 7. Listen for Consent Changes

Subscribe to consent updates to react in real time (e.g., tear down analytics if consent is revoked):

```typescript
import { useEffect } from 'react';
import { onConsentChanged } from '@datagrail.io/react-native-consent';

function useConsentListener() {
  useEffect(() => {
    const unsubscribe = onConsentChanged((preferences) => {
      // Re-evaluate which SDKs should be active
      const analyticsEnabled = preferences.cookieOptions.find(
        (opt) => opt.gtmKey === 'dg-category-analytics',
      )?.isEnabled;

      if (!analyticsEnabled) {
        teardownAnalytics();
      }
    });

    return unsubscribe;
  }, []);
}
```

## 8. WebView Integration

If your app uses WebViews that need to respect consent choices:

```typescript
import { getConsentInjectionScript } from '@datagrail.io/react-native-consent';
import { WebView } from 'react-native-webview';

function ConsentAwareWebView({ uri }: { uri: string }) {
  const script = getConsentInjectionScript();

  return (
    <WebView
      source={{ uri }}
      injectedJavaScriptBeforeContentLoaded={script}
    />
  );
}
```

On the web side, your page can read consent from:

```javascript
// Wait for consent to be injected
if (window.__dgConsentReady) {
  applyConsent(window.__dgConsent);
} else {
  document.addEventListener('dgConsentReady', () => {
    applyConsent(window.__dgConsent);
  });
}

function applyConsent(consent) {
  const analyticsAllowed = consent.preferences.cookieOptions.some(
    (opt) => opt.gtmKey === 'dg-category-analytics' && opt.isEnabled,
  );
  // Gate scripts accordingly
}
```

## 9. Expo Setup

If you use Expo (managed or bare workflow with `npx expo prebuild`):

Add the plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "@datagrail.io/react-native-consent/expo-plugin",
        {
          "trackingDescription": "We use tracking to personalize your experience and measure ad effectiveness."
        }
      ]
    ]
  }
}
```

Then run:

```bash
npx expo prebuild --clean
```

This automatically adds `NSUserTrackingUsageDescription` to your Info.plist. No manual iOS configuration needed.

## 10. Testing Your Integration

### Mock the SDK in unit tests

```typescript
// __mocks__/@datagrail.io/react-native-consent.ts
export const initialize = jest.fn().mockResolvedValue(undefined);
export const needsConsent = jest.fn().mockReturnValue(false);
export const isCategoryEnabled = jest.fn().mockReturnValue(true);
export const getPreferences = jest.fn().mockReturnValue({
  isCustomised: true,
  cookieOptions: [
    { gtmKey: 'dg-category-essential', isEnabled: true },
    { gtmKey: 'dg-category-analytics', isEnabled: true },
    { gtmKey: 'dg-category-marketing', isEnabled: false },
  ],
});
export const onConsentChanged = jest.fn().mockReturnValue(() => {});
export const acceptAll = jest.fn().mockResolvedValue(undefined);
export const rejectAll = jest.fn().mockResolvedValue(undefined);
export const savePreferences = jest.fn().mockResolvedValue(undefined);
export const reset = jest.fn();
export const hasUserConsent = jest.fn().mockReturnValue(true);
export const getConfig = jest.fn().mockReturnValue(null);
export const getCategories = jest.fn().mockReturnValue(null);
export const showBanner = jest.fn();
export const retryPendingRequests = jest.fn().mockResolvedValue({ success: 0, failed: 0 });
export const trackBannerShown = jest.fn().mockResolvedValue(undefined);
export const requestTrackingAuthorization = jest.fn().mockResolvedValue('authorized');
export const getTrackingStatus = jest.fn().mockReturnValue('authorized');
export const getConsentPayloadForWebView = jest.fn().mockReturnValue({
  consentId: 'test-id',
  preferences: { isCustomised: true, cookieOptions: [] },
  configVersion: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
});
export const getConsentInjectionScript = jest.fn().mockReturnValue('');
export const Banner = () => null;
export const PreferenceCenter = () => null;
```

### Verify consent flow manually

1. Fresh install — `needsConsent()` should return `true`
2. Accept all — verify `isCategoryEnabled` returns `true` for all categories
3. Kill and relaunch — verify consent persists (`needsConsent()` returns `false`)
4. Change config version on backend — verify `needsConsent()` returns `true` again

## Next Steps

- [Migration from Native SDKs](./migration-from-native.md) — if switching from iOS/Android native SDKs
- [README](../README.md) — full API reference and troubleshooting
