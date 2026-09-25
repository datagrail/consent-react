# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `setCcpaOptout(optedOut, sync?)` and `getCcpaOptout()`: a first-class CCPA/CPRA "Do Not Sell or Share" choice (TRUST-2591). The host app is the source of truth on React Native (there is no native DNSMPI signal). The flag is stored on the device and never changes a category. With `sync`, it is written to the user's Universal Consent record when Universal Consent is enabled, `universalConsent.sync_optout` is on, the device is bound to that identifier, and the user has an explicit category choice. Otherwise it rides the next Universal Consent write.

- `clearUserIdentifier()`: non-destructive logout for Universal Consent. It clears the device's identity binding and returns local consent to the config defaults (the banner shows again, listeners fire). It makes no network call, leaves the server-side record alone, and keeps the device ID, config cache and offline queue (TRUST-2902)

### Changed

- `setUserIdentifier` now binds the device to the user's hash and treats a call for an unbound device, or for a different identity than the bound one, as a login (TRUST-2902):
  - If a record is found, it replaces local consent: categories it carries take its value, and every other category takes the config default. Nothing is written, even when the device holds a pre-login choice. If the record holds no consent choice, local consent returns to neutral when the device held a choice or another user's state.
  - If no record is found, only an explicit local choice is written (the user chose on this device while it was not bound to someone else).
  - Otherwise nothing is written. If the device was bound to another user, local consent returns to neutral.
- A miss no longer seeds a record from config defaults, on login or re-sync. Re-sync write-through over a found record is unchanged.
- **Behavior change (TRUST-2591):** Universal Consent writes now send `ccpa_optout` from the user's stored choice (`setCcpaOptout`), gated by `universalConsent.sync_optout`, instead of always `false`. A found record's `ccpa_optout` is adopted into the local flag: on login it always replaces a pre-login value; on a re-sync only when `sync_optout` is on (with the gate off the record never carries the choice). `clearUserIdentifier()` returns the flag to `false` and `reset()` wipes it. Records written earlier are adopted as they are.

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
