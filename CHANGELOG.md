# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `clearUserIdentifier()`: non-destructive logout for Universal Consent. It clears the device's identity binding and returns local consent to the config defaults (the banner shows again, listeners fire). It makes no network call, leaves the server-side record alone, and keeps the device ID, config cache and offline queue (TRUST-2902)
- `setUserIdentifier` option `attachAnonymousConsent` (default `false`)

### Changed

- `setUserIdentifier` no longer writes a pre-login local choice to a new identity's missing record during a login transition (the device was unbound or bound to another user). Local consent returns to neutral instead. Pass `attachAnonymousConsent: true` to keep the old behavior when the host knows the choice was made in the same session. Found-record handling is unchanged (TRUST-2902)

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
