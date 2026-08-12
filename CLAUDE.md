# CLAUDE.md

## Project Overview

DataGrail React Native Consent SDK — `@datagrail/react-native-consent`. Open-source (Apache License, Version 2.0), TypeScript-first privacy consent management for React Native 0.76+ (New Architecture only — TurboModules/Fabric).

Feature parity with `consent-ios` (Swift) and `consent-android` (Kotlin) native SDKs. Synchronous consent reads via MMKV, offline queue, exponential backoff retry, config-driven banner UI.

## Architecture

```
src/
├── index.ts                    # Public API re-exports
├── types.ts                    # All TypeScript interfaces and types
├── ConsentManager.ts           # Core orchestrator — stateful module
├── config/
│   ├── ConfigService.ts        # GET config endpoint, parse, cache in MMKV
│   └── types.ts                # Raw JSON schema types (snake_case → camelCase)
├── storage/
│   ├── StorageService.ts       # MMKV wrapper (synchronous get/set/delete)
│   ├── keys.ts                 # Storage key constants (match native SDKs)
│   └── migrations.ts           # Schema version upgrades
├── network/
│   ├── NetworkService.ts       # Fetch wrapper with timeout + headers
│   ├── RetryPolicy.ts          # Exponential backoff config (5 attempts, 250ms)
│   └── OfflineQueue.ts         # Persist failed requests, drain on reconnect
├── consent/
│   ├── ConsentResolver.ts      # Merge config defaults with user prefs
│   └── EventEmitter.ts         # Typed listener system
├── ui/
│   ├── Banner.tsx              # Config-driven banner component
│   ├── PreferenceCenter.tsx    # Category toggles + save
│   ├── theme.ts                # Theme extraction from config
│   └── components/             # Buttons, toggles, text primitives
├── platform/
│   ├── att.ios.ts              # ATT native module bridge (iOS)
│   ├── att.android.ts          # No-op (Android)
│   ├── att.ts                  # No-op fallback (other/unresolved platforms)
│   ├── attShared.ts            # Shared ATT status → consent mapping
│   ├── trackingSignal.ios.ts   # Read-only ATT status for Universal Consent (iOS)
│   ├── trackingSignal.android.ts # Read-only ad-ID opt-out status (Android)
│   └── trackingSignal.ts       # Fallback — returns notDetermined
├── universal/
│   ├── UniversalConsentService.ts # Cross-device consent read/write
│   ├── userHash.ts             # JS side of the native hashing bridge
│   └── types.ts                # UC wire types + reconcileSignals()
└── webview/
    └── WebViewConsent.ts       # Consent payload for webview injection

ios/
├── DataGrailConsentATT.swift/.m       # ATT bridge
└── DataGrailConsentCrypto.swift/.m    # User-hash computation (CryptoKit)

android/src/main/kotlin/com/datagrail/consent/rn/
├── DataGrailConsentATTModule.kt
├── DataGrailConsentCryptoModule.kt    # User-hash computation (MessageDigest)
└── DataGrailConsentPackage.kt         # Registers both modules
```

## Build & Test Commands

```bash
npm install                   # Install dependencies
npm run typecheck             # TypeScript strict check
npm run lint                  # ESLint
npm run test                  # Jest unit tests
npm run test:integration      # Integration tests (real MMKV, mocked HTTP)
npm run build                 # Build with react-native-builder-bob
```

## Key Patterns

- **Synchronous reads**: `isCategoryEnabled()`, `getPreferences()` read from MMKV synchronously. No bridge crossing for hot-path consent checks.
- **Config format**: Backend serves snake_case JSON. `ConfigService.parseConfig()` converts to camelCase TypeScript types. See `src/config/types.ts` for the raw schema.
- **Offline resilience**: Failed network requests are queued to MMKV via `OfflineQueue`, drained on NetInfo connectivity event.
- **Event system**: `EventEmitter` is typed — `onConsentChanged` fires synchronously after storage write, before network call completes.
- **ATT integration**: iOS-only native module. Platform files use `.ios.ts` / `.android.ts` suffixes for RN platform resolution.
- **Error handling**: All public API methods that can fail throw/reject with `ConsentError` (code + message). Internal modules propagate errors up.
- **Universal Consent hashing is native**: the user hash is computed entirely in `DataGrailConsentCrypto` (Swift/Kotlin), not in JS. Hermes has no SHA-256 and no dependable `String.prototype.normalize`, so a JS implementation would silently produce a _different_ hash on some apps — which splits one user across two consent records with no error. Never move any part of this into JS. See TRUST-2500 for the optional `hashFunction` override that would restore Expo Go / RN Web reach if a consumer ever needs it.
- **`trackingSignal.*.ts` is separate from `att.*.ts` on purpose**: `att.ios.ts` imports `ConsentManager` (it persists the derived preference), and `ConsentManager` needs the signal for Universal Consent reconciliation — importing back would be a cycle. The `trackingSignal` modules have no imports of their own, and degrade to `notDetermined` rather than throwing, since an unreadable signal must not take down a consent read.

## API Contracts

All public API matches native SDKs (see `src/index.ts` for the full export list):

- `initialize(config: DataGrailConfig): Promise<void>`
- `showBanner(): void` — UI trigger no-op; actual display is the `Banner` component's job
- `isCategoryEnabled(category: string): boolean` — synchronous
- `getPreferences(): ConsentPreferences | null` — synchronous
- `getCategories(): ConsentPreferences | null` — saved prefs, or config defaults if unset
- `getConfig(): ConsentConfig | null` — cached raw config
- `savePreferences(prefs: ConsentPreferences): Promise<void>`
- `acceptAll(): Promise<void>`
- `rejectAll(): Promise<void>`
- `needsConsent(): boolean`
- `onConsentChanged(listener): Unsubscribe`
- `reset(): void`
- `hasUserConsent(): boolean`
- `retryPendingRequests(): Promise<{ success: number; failed: number }>` — drains `OfflineQueue`
- `trackBannerShown(): Promise<void>` — hits `save_open`

Universal Consent (cross-device), gated on `universalConsent.enabled` in the config:

- `isUniversalConsentEnabled(): boolean`
- `fetchUniversalConsent(identifier, apiKey, trackingSignal?): Promise<UniversalConsentRecord | null>` — inspect only; local state untouched
- `rehydrateFromUniversalConsent(identifier, apiKey, trackingSignal?): Promise<boolean>` — fetch **and apply**; `false` on a miss
- `setUserIdentifier(identifier, { apiKey, getSignature, trackingSignal? }): Promise<void>` — reads then writes

Also exported: `requestTrackingAuthorization`/`getTrackingStatus` (ATT, `src/platform/att*.ts`),
`getConsentPayloadForWebView`/`getConsentInjectionScript` (`src/webview/WebViewConsent.ts`), and
the `Banner`/`PreferenceCenter` UI components.

### Universal Consent invariants

Shared byte-for-byte with consent-banner (web), consent-ios, consent-android, and the customer's
backend. Do not change any of these without changing all of them:

- **Hash**: `SHA-256("{dgCustomerId}:{consentProjectId}:{normalizedIdentifier}")` → 64-char
  lowercase hex. Normalization is Unicode NFC → trim → locale-pinned lowercase (`Locale.ROOT` /
  `en_US_POSIX` — the default-locale overload maps "I" to "ı" on a Turkish device). Golden vector:
  `ac46d8ad-a67a-431f-a5d5-9e3eb922dae7` + `proj_abc123` + `user@example.com` →
  `1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4`.
- **Empty identifiers are rejected** (`VALIDATION_ERROR`). Hashing a bare `{customerId}:{projectId}:`
  prefix collapses every empty-or-whitespace caller in the tenant onto one consent record.
- **`VALIDATION_ERROR` means the caller's input was bad; `NATIVE_ERROR` means the bridge failed.**
  Only the empty-identifier case and a missing `consentProjectId` are `VALIDATION_ERROR`. An
  unlinked `DataGrailConsentCrypto` (Expo Go, RN Web, missing `pod install`) or any other native
  rejection is `NATIVE_ERROR` — do not collapse the two, or integrators get told their input was
  wrong and not to retry when neither is true.
- **`cookieOptions` is a MAP** `{ key: bool }` on the wire, both read and write — unlike the local
  `ConsentPreferences`, which is an array of `CategoryConsent`.
- **Reads are unsigned.** Only writes carry `X-DG-Signature` / `X-DG-Timestamp` (unix seconds) /
  `X-DG-Key-Id` / `X-DG-Nonce`. `X-DG-Api-Key` goes on every request. The SDK never computes the
  HMAC — `getSignature` calls the customer's backend, and the shared secret never touches the device.
- **A miss is `{"status":"not_found"}` at HTTP 200**, not a 404, and the global kill switch responds
  the same way. Anything but an explicit `"found"` is a miss. "No signal" is **not** "denied".
- **A found record is authoritative in both directions** of disagreement with local state.
- **Signals suppress on top, one-directionally.** A signal may only turn categories OFF, never on.
  Two apply: the record's stored `gpc` (recorded on the web — RN has no GPC of its own, so this
  field is the only path) and the device's live ad-tracking signal. The more protective wins.
- **`ccpa_optout` is never derived from the tracking signal.** Ad-tracking permission is narrower
  than a CCPA do-not-sell choice; RN has no source for it and writes `false`, matching iOS/Android.
  `universalConsent.syncOptout` is a feature gate, not the value.
- **`NetworkService` resolves on any HTTP status** (it only rejects on transport failure), so
  `UniversalConsentService` checks non-2xx itself. Without that, a 500's error body would be parsed
  as a consent record.
- **`rehydrateFromUniversalConsent` must call `setUserConsented(true)`.** RN's `needsConsent()`
  gates on that flag rather than on preferences merely existing (`initialize()` auto-persists
  defaults), which differs from iOS/Android. Without it the banner still shows and the method
  fails at the one job it has.

## Backend Endpoints

All relative to `https://{privacyDomain}/`:

- `GET {configUrl}` — fetch config JSON (save_open tracks impressions)
- `GET /save_open?dg_customer_id=X&consent_id=Y&config_version=Z&timestamp=T` — track banner shown
- `POST /save_preferences` — body: `{ dg_customer_id, consent_id, config_version, is_customised, cookie_options: [{gtm_key, is_enabled}], timestamp }`
- `GET /universal_consent?customer_id=X&user_hash=Y` — read a cross-device record
- `POST /universal_consent` — body: `{ customer_id, user_hash, consent_preferences: { isCustomised, cookieOptions: {key: bool} }, consent_mode, ccpa_optout, platform, policy_name, config_version }`

`/universal_consent` is a **CloudFront behavior, not a Rails route** — it has no `/api/v1/` prefix.

## Conventions

- Strict TypeScript (`strict: true` + additional strictness flags in tsconfig)
- No `any` types — use `unknown` and narrow
- No default exports — named exports only
- Platform-specific code uses `.ios.ts` / `.android.ts` file suffixes
- Tests co-located in `__tests__/` at root level, mirroring source structure
- Integration tests in `__integration__/`
- Storage keys must match native SDKs (see `src/storage/keys.ts`)

## Out of Scope (v1)

- Multi-account support (deferred to v1.1)
- Flutter/Xamarin/other cross-platform
- Originating GPC/DNT on-device (web-only signals). A GPC recorded on the web _is_ honored, but
  only as it arrives on a Universal Consent record's `gpc` field — RN cannot produce one itself.
- react-native-web support (blocked on the native hashing module — see TRUST-2500)
- Expo Go support (same blocker — a dev client or prebuild is required)
- Old Architecture (RN < 0.76) support
