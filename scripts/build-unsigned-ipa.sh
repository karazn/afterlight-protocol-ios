#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/App"
DERIVED_DIR="$ROOT_DIR/build/ios-derived"
OUTPUT_DIR="$ROOT_DIR/outputs"

cd "$ROOT_DIR"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm run build
  pnpm exec cap sync ios
elif command -v npm >/dev/null 2>&1; then
  npm install
  npm run build
  npx cap sync ios
else
  echo "Нужен Node.js с npm или pnpm." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode не найден. Установите Xcode и Command Line Tools." >&2
  exit 1
fi
if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods не найден. Установите: sudo gem install cocoapods" >&2
  exit 1
fi

cd "$IOS_DIR"
pod install
xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath "$DERIVED_DIR" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  build

APP_PATH="$DERIVED_DIR/Build/Products/Release-iphoneos/App.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Сборка завершилась без ожидаемого App.app: $APP_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
TEMP_PACKAGE="$(mktemp -d)"
trap 'rm -rf "$TEMP_PACKAGE"' EXIT
mkdir -p "$TEMP_PACKAGE/Payload"
cp -R "$APP_PATH" "$TEMP_PACKAGE/Payload/"
cd "$TEMP_PACKAGE"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent Payload "$OUTPUT_DIR/AfterlightProtocol-unsigned.ipa"
echo "Готово: $OUTPUT_DIR/AfterlightProtocol-unsigned.ipa"
