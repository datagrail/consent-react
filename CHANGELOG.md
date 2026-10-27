# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Upgrade note (from 1.7.0)

1.7.0 stored no decision time with a consent choice. The first `setUserIdentifier` re-sync after upgrading therefore cannot tell that a local change is newer than the record, and adopts the record (the revocation-safe choice). On 1.7.0 only `setUserIdentifier` wrote categories, so a local category change made on 1.7.0 since its last re-sync (for example, marketing turned off) is replaced by the record's older value and is not written. Choices made after upgrading carry their time and sync normally.

### Fixed

- After a Universal Consent re-sync writes a newer local choice through, local reads now show that choice instead of the older record the read had just applied (TRUST-3310). The restored choice is seen through the same signal suppression the read applies (the record's GPC or this device's tracking signal), and the consent-changed listener fires once, with it: the read no longer tells listeners about the older record first, which could briefly report a category the newer local choice turned off as enabled.
- A `setCcpaOptout` choice on a bound device that could not write through yet (no `sync` passed, no explicit category choice, or a failed write) is no longer overwritten by the record's stale `ccpa_optout` on the next re-sync (TRUST-3308, port of the consent-banner #756 fix). The flag is marked pending sync until a successful write carries it; a login adopt, logout and neutral reset clear the marker. A re-sync that adopts the record's categories now flushes a pending flag (with an explicit local choice and `syncOptout` on). A miss or a signal-only record keeps it pending. Every CCPA write (`setCcpaOptout` and the flush) is CCPA-only: an empty category map with no `isCustomised` or record metadata, dated when the choice was made. The pending marker stores that time. `setCcpaOptout` first writes the category choice at its own time. A CCPA write the record already outranks (the edge's `stale_fields`) is settled rather than reported as written, the same way on both paths: the record's newer flag becomes the local one (the SDK reads the record back after the stale answer, rather than reusing a read made before the write, which another device may have overtaken; if that read fails or finds no record the choice stays pending for the next re-sync), unless a newer `setCcpaOptout` call was made meanwhile. A re-sync category write-through over a found record no longer carries the CCPA flag. This is the same design as consent-banner #756.
- A stale device's Universal Consent re-sync can no longer undo a newer revocation made on another device (TRUST-3225, the React Native port of TRUST-3154 / sign-off scenario P0-06). The SDK now records when each consent choice was made (an adopted record keeps the record's `updated_at`, and so does an ATT save over it, which changes only the local view), sends it as `decision_ts` with `is_explicit: true` on every write and signs it into the provenance digest, and on a re-sync writes the local choice through only when it is strictly newer than the found record's `updated_at`. Otherwise it adopts the record. A same-second tie, a choice stored before this release (unknown time), or a record without a usable `updated_at` all adopt. The `getSignature` contract is unchanged; customer backends that HMAC `payload.stringToSign` verbatim need no change, but one that rebuilds the string from the fields will now be rejected.
- With `universalConsent.sync_optout` off, Universal Consent writes leave `ccpa_optout` out entirely rather than sending `false`, and a `setCcpaOptout` choice made on a bound device while the gate is off stays pending, with its decision time, and is sent by the first re-sync after the gate turns on (TRUST-3381, as web and the native SDKs).
- A `setUserIdentifier` crossed by a logout during its hash now reads, applies and binds nothing, as one crossed during its read or write already did (TRUST-2591).
- A logout, `reset()` or identity switch while a `setCcpaOptout` write-through or a re-sync's CCPA flush is in flight no longer lets the old user's flag land on the device or start another request: the write chain re-checks the identity it started under after every await. A `reset()` during a `setUserIdentifier` write no longer throws a `TypeError` (TRUST-2591).
- A re-sync write-through over a found record that holds no category choice (signal-only, e.g. a web opt-out) now adopts the record's `ccpa_optout` locally with `sync_optout` on, as a re-sync without a local choice already did. A re-sync over a missing record no longer sends a pending CCPA choice on the category write at the categories' time; it gets its own CCPA-only write, dated when it was made (TRUST-3308).
- A category choice made right after this device's own `setCcpaOptout` write (or after reading a record stamped ahead of this clock) is now stamped strictly after it. Before, its decision time was floored only on the previous category choice, so it could tie the record's `updated_at` (which the CCPA write had just moved) and be adopted over, losing the change with no write, on the next re-sync. The same holds after a `setUserIdentifier` write-through of a choice with no stored decision time (e.g. one stored by 1.7.0): that write is now dated before it is sent and floors the next choice too. The floor belongs to the bound identity: a logout or a login to another identity drops it, so one user's record times never push the next user's choices ahead (TRUST-3225).

## [1.7.0] - 2026-10-26

Entries accumulated since 0.1.0-alpha.1; they shipped across 1.1.0 to 1.7.0 (see the GitHub Releases for the per-version split).

### Added

- `onConfigError` option on `initialize()`: receives background config-refresh failures as a `ConsentError` (`CONFIG_NOT_PUBLISHED`, `NETWORK_ERROR`, `TIMEOUT`, `PARSE_ERROR`) instead of them being silently discarded. The cached config is still served (TRUST-2745)
- `CONFIG_NOT_PUBLISHED` error code: `initialize()` now rejects with it when the config URL returns a 4xx (other than 408/429) and there is no cached config (TRUST-2745)
- `setCcpaOptout(optedOut, sync?)` and `getCcpaOptout()`: a first-class CCPA/CPRA "Do Not Sell or Share" choice (TRUST-2591). The host app is the source of truth on React Native (there is no native DNSMPI signal). The flag is stored on the device and never changes a category. With `sync`, it is written to the user's Universal Consent record when Universal Consent is enabled, `universalConsent.sync_optout` is on, the device is bound to that identifier, and the user has an explicit category choice. Otherwise it rides the next Universal Consent write.
- Config-delivered Universal Consent API key (TRUST-2603): `apiKey` is now optional on `fetchUniversalConsent`, `rehydrateFromUniversalConsent`, `setUserIdentifier` and `setCcpaOptout`. When it's omitted, the SDK uses `universalConsent.apiKey` from config.json. An explicit key wins (an empty string counts as no key); with neither, the call rejects with `VALIDATION_ERROR`. `setCcpaOptout` with `sync` checks for the key before the binding, so a missing key rejects whether or not the device is bound.
- `clearUserIdentifier()`: non-destructive logout for Universal Consent. It clears the device's identity binding and returns local consent to the config defaults (the banner shows again, listeners fire). It makes no network call, leaves the server-side record alone, and keeps the device ID, config cache and offline queue (TRUST-2902)

### Changed

- A 4xx config fetch (other than 408/429) no longer rejects with `NETWORK_ERROR`; 408, 429, 5xx and transport failures still do (TRUST-2745)
- `setUserIdentifier` now binds the device to the user's hash and treats a call for an unbound device, or for a different identity than the bound one, as a login (TRUST-2902):
  - If a record is found, it replaces local consent: categories it carries take its value, and every other category takes the config default. Nothing is written, even when the device holds a pre-login choice. If the record holds no consent choice, local consent returns to neutral when the device held a choice or another user's state.
  - If no record is found, only an explicit local choice is written (the user chose on this device while it was not bound to someone else).
  - Otherwise nothing is written. If the device was bound to another user, local consent returns to neutral.
- A miss no longer seeds a record from config defaults, on login or re-sync. Re-sync write-through over a found record is unchanged.
- **Behavior change (TRUST-2591):** Universal Consent writes now send `ccpa_optout` from the user's stored choice (`setCcpaOptout`), gated by `universalConsent.sync_optout`, instead of always `false`. A found record's `ccpa_optout` is adopted into the local flag: on login it always replaces a pre-login value; on a re-sync only when `sync_optout` is on (with the gate off the record never carries the choice). `clearUserIdentifier()` returns the flag to `false` and `reset()` wipes it. Records written earlier are adopted as they are.
- A Universal Consent write that re-sends an adopted record (a `setCcpaOptout` write-through, or a re-sync) now sends the record's raw categories, not the locally signal-suppressed view, so a denied ATT or the record's GPC is never stored cross-device as the user's denial. A `setCcpaOptout` write-through is also dropped when the device's binding changes while it computes the user hash (TRUST-2591)
- A login that finds an essential-only record (a present map that names no optional category this config knows: empty, essentials only, or only unknown keys) keeps every optional category off, instead of filling them with their config defaults (TRUST-2961)
- `setCcpaOptout` resolves `true` when it wrote the flag to the Universal Consent record and `false` when it saved it locally only. A write-through sends the flag stored at write time, so an older call can't overwrite a newer one (TRUST-2591)
- The ATT bridge's save no longer discards an adopted record's raw choice, and does not change it: the tracking status's marketing decision applies to this device's view only, so a later write-through stores neither the record's GPC suppression nor this device's ATT status as the user's cross-device choice (TRUST-2591)
- A `setCcpaOptout` call made while a Universal Consent read (`setUserIdentifier` or `rehydrateFromUniversalConsent`) is in flight is kept: the read's adopt no longer overwrites it, and a re-sync write carries it. A logout (`clearUserIdentifier()` or `reset()`) while a read is in flight applies nothing from it, and a `setUserIdentifier` crossed by a logout no longer binds. A record category whose value is not a boolean is ignored rather than applied or re-sent (TRUST-2591)

## [0.1.0-alpha.1] - 2026-05-29

### Added

- Core consent runtime (StorageService, NetworkService, ConfigService)
- ConsentManager with full public API
- Config-driven Banner component
- PreferenceCenter component with category toggles
- ATT integration (iOS) with consent category mapping
- Google Advertising ID integration (Android)
- WebView consent payload injection
- Expo config plugin for ATT description
- Offline queue with exponential backoff retry
- MMKV-backed synchronous consent reads
- Theme system with dark mode support
- 216 unit and integration tests
