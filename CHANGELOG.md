# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `onConfigError` option on `initialize()`: receives background config-refresh failures as a `ConsentError` (`CONFIG_NOT_PUBLISHED`, `NETWORK_ERROR`, `TIMEOUT`, `PARSE_ERROR`) instead of them being silently discarded. The cached config is still served (TRUST-2745)
- `CONFIG_NOT_PUBLISHED` error code: `initialize()` now rejects with it when the config URL returns a 4xx (other than 408/429) and there is no cached config (TRUST-2745)
- `setCcpaOptout(optedOut, sync?)` and `getCcpaOptout()`: a first-class CCPA/CPRA "Do Not Sell or Share" choice (TRUST-2591). The host app is the source of truth on React Native (there is no native DNSMPI signal). The flag is stored on the device and never changes a category. With `sync`, it is written to the user's Universal Consent record when Universal Consent is enabled, `universalConsent.sync_optout` is on, the device is bound to that identifier, and the user has an explicit category choice. Otherwise it rides the next Universal Consent write.
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
- A login that finds an essential-only record (present but empty category map) keeps every optional category off, instead of filling them with their config defaults (TRUST-2961)

### Fixed

- After a Universal Consent re-sync writes a newer local choice through, local reads now show that choice instead of the older record the read had just applied (TRUST-3310). The restored choice is seen through the same signal suppression the read applies (the record's GPC or this device's tracking signal), and the consent-changed listener fires with it.
- A `setCcpaOptout` choice on a bound device that could not write through yet (no `sync` passed, no explicit category choice, or a failed write) is no longer overwritten by the record's stale `ccpa_optout` on the next re-sync (TRUST-3308, port of the consent-banner #756 fix). The flag is marked pending sync until a successful write carries it; a login adopt, logout and neutral reset clear the marker. A re-sync that adopts the record's categories now flushes a pending flag (with an explicit local choice and `syncOptout` on): it writes the record's own raw categories back with the local flag, stamped with the record's `updated_at` rather than the request time, the same as iOS and Android. A miss or a signal-only record keeps it pending.
- A stale device's Universal Consent re-sync can no longer undo a newer revocation made on another device (TRUST-3225, the React Native port of TRUST-3154 / sign-off scenario P0-06). The SDK now records when each consent choice was made (an adopted record keeps the record's `updated_at`), sends it as `decision_ts` with `is_explicit: true` on every write and signs it into the provenance digest, and on a re-sync writes the local choice through only when it is strictly newer than the found record's `updated_at`. Otherwise it adopts the record. A same-second tie, a choice stored before this release (unknown time), or a record without a usable `updated_at` all adopt. The `getSignature` contract is unchanged; customer backends that HMAC `payload.stringToSign` verbatim need no change, but one that rebuilds the string from the fields will now be rejected.

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
