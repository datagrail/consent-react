# Maestro E2E

Run commands from `test-client/`. Keep Metro running in a separate terminal
while building the app and executing Maestro. Maestro 1.39 selects a connected
Android emulator before a booted iOS simulator, so keep only the target
platform connected while running a suite.

## Android

Terminal 1:

```sh
npm start -- --reset-cache
```

Terminal 2:

```sh
npm run android -- --no-packager

maestro test --config e2e/config.yaml \
  -e APP_ID=com.consenttestclient \
  -e PLATFORM=android \
  --format JUNIT \
  --output e2e/android-results.xml \
  --debug-output e2e/debug/android-suite \
  e2e/flows
```

## iOS

Terminal 1:

```sh
npm start -- --reset-cache
```

Terminal 2:

```sh
cd ios && bundle exec pod install && cd ..
npm run ios -- --simulator "iPhone 17 Pro"

# Disconnect or stop Android emulators before this command.
maestro test --config e2e/config.yaml \
  -e APP_ID=org.reactjs.native.example.ConsentTestClient \
  -e PLATFORM=ios \
  --format JUNIT \
  --output e2e/ios-results.xml \
  --debug-output e2e/debug/ios-suite \
  e2e/flows
```

Run one flow by replacing `e2e/flows` with its YAML path, for example:

```sh
maestro test \
  -e APP_ID=com.consenttestclient \
  -e PLATFORM=android \
  e2e/flows/02-consent-banner.yaml
```

## Artifacts

| Artifact | Location |
|----------|----------|
| Milestone screenshots | `e2e/screenshots/` |
| Android debug output | `e2e/debug/android-suite/` |
| iOS debug output | `e2e/debug/ios-suite/` |
| Android JUnit report | `e2e/android-results.xml` |
| iOS JUnit report | `e2e/ios-results.xml` |

Screenshot filenames start with `android-` or `ios-`, followed by the flow
number and ordered checkpoint. For example,
`android-02-consent-01-banner-visible.png`.

List generated artifacts from `test-client/`:

```sh
find e2e/screenshots -type f -name '*.png' | sort
find e2e/debug -type f | sort
ls -l e2e/*-results.xml
```
