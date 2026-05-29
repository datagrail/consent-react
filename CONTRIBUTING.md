# Contributing to @datagrail/react-native-consent

Thank you for your interest in contributing! This document covers how to set up the project for development and our expectations for contributions.

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Watchman** (for React Native file watching)
- **iOS development**: Xcode 15+, CocoaPods
- **Android development**: Android Studio, JDK 17, Android SDK 34

## Setup

```bash
# Clone the repository
git clone https://github.com/datagrail/react-native-consent.git
cd react-native-consent

# Install dependencies
npm install --legacy-peer-deps

# Verify the setup
npm run typecheck
npm run lint
npm run test
```

## Development Workflow

### Running tests

```bash
# Unit tests
npm run test

# Unit tests in watch mode
npm run test:watch

# Integration tests
npm run test:integration

# Tests with coverage
npm run test:coverage
```

### Type checking

```bash
npm run typecheck
```

### Linting

```bash
# Check for lint errors
npm run lint

# Auto-fix lint errors
npm run lint:fix
```

### Building

```bash
npm run build
```

This produces CommonJS, ES Module, and TypeScript declaration outputs in `lib/`.

## Architecture Overview

The SDK follows a modular architecture:

```
src/
  index.ts              Public API re-exports
  ConsentManager.ts     Module-level singleton orchestrator
  types.ts              All public TypeScript types
  config/               Config fetching, parsing, caching
  consent/              Consent resolution logic, event emitter
  network/              HTTP client, offline queue, retry logic
  platform/             Platform-specific code (ATT, GAID)
  storage/              MMKV storage abstraction
  ui/                   Banner and PreferenceCenter components
  webview/              WebView consent injection
```

For detailed architecture documentation, see `CLAUDE.md` in the repository root.

## PR Process

### Branch naming

Use descriptive branch names with a prefix:

- `feature/` — New functionality
- `fix/` — Bug fixes
- `docs/` — Documentation changes
- `refactor/` — Code restructuring without behavior change
- `test/` — Adding or updating tests

Example: `feature/add-gpc-support`, `fix/offline-queue-retry`

### Commit messages

Write clear, imperative-mood commit messages:

```
Add exponential backoff to offline queue retry

Previously the queue retried immediately on connectivity restore,
which could overwhelm the backend. Now uses 1s/2s/4s/8s backoff
with jitter, capped at 30s.
```

### Review process

1. Open a PR against `main`
2. Ensure CI passes (typecheck, lint, tests)
3. Request review from a maintainer
4. Address feedback
5. Squash-merge once approved

## Code Style

- **Strict TypeScript** — No `any` types. Use `unknown` + type narrowing when needed.
- **Named exports only** — No default exports (except the Expo plugin entry point).
- **Explicit return types** — All public functions must have explicit return type annotations.
- **No classes for singletons** — Use module-level state + exported functions (matches native SDK pattern).
- **Functional React components** — No class components.
- **Test file colocation** — Tests live in `__tests__/` at the root, mirroring `src/` structure.

## Adding New Features

1. Define types in `src/types.ts`
2. Implement logic in the appropriate module under `src/`
3. Export from `src/index.ts`
4. Add unit tests in `__tests__/`
5. Add integration test if the feature involves multiple modules
6. Update the README API reference table

## Reporting Issues

- Use the GitHub issue templates for bug reports and feature requests
- Search existing issues before opening a new one
- Include React Native version, platform, and SDK version in bug reports
