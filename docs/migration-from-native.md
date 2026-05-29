# Migration from Native SDKs

This guide helps customers migrate from the native iOS/Android DataGrail consent SDKs to `@datagrail/react-native-consent`.

## Overview

The React Native SDK provides equivalent functionality to both native SDKs in a single cross-platform package. The core concepts are the same — config-driven consent with persistent local storage — but the API surface and patterns differ.

## Concept Mapping

| Native SDK Concept | React Native Equivalent |
|-------------------|------------------------|
| `DataGrailConsent.configure(...)` | `initialize({ configUrl })` |
| Delegate/callback pattern | `onConsentChanged(listener)` |
| `DataGrailConsent.shared` singleton | Module-level functions (no instance needed) |
| `ConsentManager.getConsentStatus(category:)` | `isCategoryEnabled(category)` |
| UI presented via native view controllers | `<Banner />` and `<PreferenceCenter />` React components |
| NSUserDefaults / SharedPreferences | MMKV (faster, synchronous) |

## Storage Compatibility

The React Native SDK uses MMKV for storage with the same key structure as the native SDKs. **Consent preferences from the native SDK are not automatically migrated** — the MMKV storage is independent.

When migrating:
- Users will see the consent banner once after the migration (since MMKV starts empty)
- After they interact with it, their preferences are stored in MMKV going forward
- No data loss occurs — the backend already has their historical consent records

If you need to preserve local consent state during migration, you can read from the native storage and call `savePreferences()` with the existing values during your app's migration logic.

## API Equivalence Table

### iOS (Swift) to React Native

| iOS SDK | React Native SDK | Notes |
|---------|-----------------|-------|
| `DataGrailConsent.configure(url:)` | `initialize({ configUrl })` | Now returns a Promise |
| `DataGrailConsent.shared.needsConsent()` | `needsConsent()` | Same behavior |
| `DataGrailConsent.shared.showBanner()` | Render `<Banner />` component | Declarative vs imperative |
| `DataGrailConsent.shared.isCategoryEnabled(_:)` | `isCategoryEnabled(category)` | Same — synchronous |
| `DataGrailConsent.shared.acceptAll()` | `acceptAll()` | Now returns Promise |
| `DataGrailConsent.shared.rejectAll()` | `rejectAll()` | Now returns Promise |
| `DataGrailConsent.shared.savePreferences(_:)` | `savePreferences(prefs)` | Now returns Promise |
| `DataGrailConsent.shared.getPreferences()` | `getPreferences()` | Same return shape |
| `DataGrailConsent.shared.delegate = self` | `onConsentChanged(listener)` | Returns unsubscribe fn |
| `DataGrailConsent.shared.reset()` | `reset()` | Same behavior |
| `ATTrackingManager.requestTrackingAuthorization` | `requestTrackingAuthorization()` | Bundled, auto-maps to consent |

### Android (Kotlin) to React Native

| Android SDK | React Native SDK | Notes |
|------------|-----------------|-------|
| `DataGrailConsent.configure(context, url)` | `initialize({ configUrl })` | No context needed |
| `DataGrailConsent.getInstance().needsConsent()` | `needsConsent()` | Same behavior |
| `DataGrailConsent.getInstance().showBanner(activity)` | Render `<Banner />` component | Declarative |
| `DataGrailConsent.getInstance().isCategoryEnabled(cat)` | `isCategoryEnabled(category)` | Same |
| `DataGrailConsent.getInstance().acceptAll()` | `acceptAll()` | Now returns Promise |
| `DataGrailConsent.getInstance().rejectAll()` | `rejectAll()` | Now returns Promise |
| `DataGrailConsent.getInstance().addListener(listener)` | `onConsentChanged(listener)` | Returns unsubscribe fn |
| `DataGrailConsent.getInstance().reset()` | `reset()` | Same behavior |

## Breaking Differences

### 1. Async initialization

The native SDKs configure synchronously (with background fetch). The RN SDK's `initialize()` is async and must be awaited before other methods work.

**Before (iOS):**
```swift
// Synchronous — other methods work immediately
DataGrailConsent.configure(url: configUrl)
let needs = DataGrailConsent.shared.needsConsent()
```

**After (React Native):**
```typescript
// Must await — throws NOT_INITIALIZED if called too early
await initialize({ configUrl });
const needs = needsConsent();
```

### 2. Declarative UI vs imperative

Native SDKs present banners imperatively. The RN SDK uses React components.

**Before (iOS):**
```swift
DataGrailConsent.shared.showBanner() // Presents a UIViewController
```

**After (React Native):**
```typescript
// Render conditionally in your component tree
{showBanner && <Banner onConsentSaved={handleSaved} />}
```

### 3. Event listeners return unsubscribe functions

**Before (iOS):**
```swift
DataGrailConsent.shared.delegate = self
// Must manually nil out delegate to stop receiving events
```

**After (React Native):**
```typescript
const unsubscribe = onConsentChanged((prefs) => { ... });
// Call unsubscribe() when done (e.g., in useEffect cleanup)
```

### 4. Preferences write is async

`savePreferences`, `acceptAll`, and `rejectAll` now return Promises because they include network sync. The local write is still synchronous (reads are immediately consistent), but the function itself is async.

```typescript
// The preference is readable immediately after calling
await acceptAll();
// But you should await to catch network errors (or let the offline queue handle them)
```

### 5. No context/activity parameter

The RN SDK operates at the JavaScript layer — no Android Context or iOS UIViewController is needed for any API call.

## Step-by-Step Migration

### Step 1: Remove native SDKs

**iOS (Podfile):**
```diff
- pod 'DataGrailConsent'
```

**Android (build.gradle):**
```diff
- implementation 'io.datagrail:consent-android:x.y.z'
```

### Step 2: Remove native initialization code

Delete or comment out native SDK configuration in `AppDelegate.swift` / `MainApplication.kt`.

### Step 3: Install the React Native SDK

```bash
npm install @datagrail/react-native-consent
cd ios && pod install
```

### Step 4: Initialize in JavaScript

```typescript
// App.tsx or your app entry point
import { initialize } from '@datagrail/react-native-consent';

// Use the same config URL as your native SDKs
await initialize({
  configUrl: 'https://cdn.datagrail.io/your-customer-id/config.json',
});
```

### Step 5: Replace consent checks

Find all native consent checks and replace with the RN equivalent:

```typescript
import { isCategoryEnabled } from '@datagrail/react-native-consent';

// Replaces: DataGrailConsent.shared.isCategoryEnabled("analytics")
if (isCategoryEnabled('dg-category-analytics')) {
  // enable analytics
}
```

### Step 6: Replace banner presentation

Remove native banner presentation and use the React component:

```typescript
import { needsConsent } from '@datagrail/react-native-consent';
import { Banner } from '@datagrail/react-native-consent';

function App() {
  const [showBanner, setShowBanner] = useState(needsConsent());

  return (
    <>
      {showBanner && (
        <Banner
          onConsentSaved={() => setShowBanner(false)}
          onDismiss={() => setShowBanner(false)}
        />
      )}
      <MainContent />
    </>
  );
}
```

### Step 7: Update event listeners

```typescript
import { useEffect } from 'react';
import { onConsentChanged } from '@datagrail/react-native-consent';

useEffect(() => {
  const unsubscribe = onConsentChanged((preferences) => {
    // Handle consent change
  });
  return unsubscribe;
}, []);
```

### Step 8: Configure ATT (iOS)

If you were using ATT with the native SDK:

```typescript
import { requestTrackingAuthorization } from '@datagrail/react-native-consent';

// The RN SDK automatically maps ATT status to consent preferences
const status = await requestTrackingAuthorization();
```

The `NSUserTrackingUsageDescription` Info.plist key remains the same — keep it from your native setup.

### Step 9: Test the migration

1. **Fresh install test**: Uninstall app, reinstall, verify banner appears
2. **Consent persistence**: Make a choice, kill app, relaunch — verify `needsConsent()` is `false`
3. **Category checks**: Verify `isCategoryEnabled()` matches expected state
4. **ATT flow**: On iOS, verify the tracking dialog appears and consent is persisted
5. **Offline behavior**: Enable airplane mode, make consent choices, verify they sync when online

## FAQ

### Will users need to re-consent after migration?

Yes — since the RN SDK uses its own MMKV storage, the first launch after migration will show the consent banner. This is generally acceptable as it's a transparent experience for users.

### Can I run both SDKs during a transition period?

This is not recommended. Running two consent SDKs simultaneously can cause conflicting consent states and duplicate backend calls. Migrate fully in a single release.

### Does the backend need any changes?

No. The RN SDK communicates with the same DataGrail backend endpoints as the native SDKs. The consent payload format is identical.

### What about React Native bridges I wrote for the native SDKs?

Delete them. The RN SDK provides all functionality natively in JavaScript — no bridge code is needed (except for ATT and GAID which include small native modules bundled with the package).
