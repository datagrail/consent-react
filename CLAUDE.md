# CLAUDE.md

## Project Overview

DataGrail React Native Consent SDK — `@datagrail.io/react-native-consent`. Open-source (Apache License, Version 2.0), TypeScript-first privacy consent management for React Native 0.76+ (New Architecture only — TurboModules/Fabric).

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
│   └── attShared.ts            # Shared ATT status → consent mapping
└── webview/
    └── WebViewConsent.ts       # Consent payload for webview injection
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

Also exported: `requestTrackingAuthorization`/`getTrackingStatus` (ATT, `src/platform/att*.ts`),
`getConsentPayloadForWebView`/`getConsentInjectionScript` (`src/webview/WebViewConsent.ts`), and
the `Banner`/`PreferenceCenter` UI components.

## Backend Endpoints

All relative to `https://{privacyDomain}/`:

- `GET {configUrl}` — fetch config JSON (save_open tracks impressions)
- `GET /save_open?dg_customer_id=X&consent_id=Y&config_version=Z&timestamp=T` — track banner shown
- `POST /save_preferences` — body: `{ dg_customer_id, consent_id, config_version, is_customised, cookie_options: [{gtm_key, is_enabled}], timestamp }`

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
- GPC/DNT signal handling (web-only)
- react-native-web support
- Old Architecture (RN < 0.76) support
