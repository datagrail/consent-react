#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
  echo "Usage: ./launch.sh [options]"
  echo ""
  echo "Options:"
  echo "  --ios          Run on iOS simulator (default)"
  echo "  --android      Run on Android emulator"
  echo "  --clean        Clean build before running"
  echo "  --install      Install dependencies only (no run)"
  echo "  --device       Run on physical device"
  echo "  -h, --help     Show this help"
  echo ""
  echo "Examples:"
  echo "  ./launch.sh                  # Install deps + run iOS"
  echo "  ./launch.sh --android        # Install deps + run Android"
  echo "  ./launch.sh --clean --ios    # Clean + install + run iOS"
  echo "  ./launch.sh --install        # Just install deps (for CI)"
}

PLATFORM="ios"
CLEAN=false
INSTALL_ONLY=false
DEVICE_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ios) PLATFORM="ios"; shift ;;
    --android) PLATFORM="android"; shift ;;
    --clean) CLEAN=true; shift ;;
    --install) INSTALL_ONLY=true; shift ;;
    --device) DEVICE_FLAG="--device"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

echo "==> Installing test-client dependencies..."
npm install --legacy-peer-deps

echo "==> Installing parent SDK dependencies..."
(cd .. && npm install --legacy-peer-deps)

if [ "$CLEAN" = true ]; then
  echo "==> Cleaning build artifacts..."
  rm -rf node_modules/.cache
  if [ "$PLATFORM" = "ios" ]; then
    rm -rf ios/Pods ios/build ios/ConsentTestClient.xcworkspace
    rm -f ios/Podfile.lock
  elif [ "$PLATFORM" = "android" ]; then
    (cd android && ./gradlew clean 2>/dev/null || true)
  fi
fi

if [ "$PLATFORM" = "ios" ]; then
  echo "==> Installing CocoaPods..."
  (cd ios && pod install)
fi

if [ "$INSTALL_ONLY" = true ]; then
  echo "==> Install complete. Run './launch.sh' to start the app."
  exit 0
fi

echo "==> Starting Metro bundler + $PLATFORM app..."
if [ "$PLATFORM" = "ios" ]; then
  npx react-native run-ios $DEVICE_FLAG
elif [ "$PLATFORM" = "android" ]; then
  npx react-native run-android $DEVICE_FLAG
fi
