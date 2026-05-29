# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
