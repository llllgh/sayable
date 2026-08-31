#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  elif JAVA_21_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
    export JAVA_HOME="$JAVA_21_HOME"
  else
    echo "JDK 21 is required. Install it with: brew install openjdk@21" >&2
    exit 1
  fi
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npm run build
npx cap sync android

case "${1:-debug}" in
  debug)
    (cd android && ./gradlew assembleDebug)
    echo "APK: $ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  install)
    : "${ANDROID_RELEASE_STORE_FILE:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_STORE_PASSWORD:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_KEY_ALIAS:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_KEY_PASSWORD:?Set Android release signing values in .env}"
    (cd android && ./gradlew assembleRelease)
    adb install -r android/app/build/outputs/apk/release/app-release.apk
    ;;
  release)
    : "${ANDROID_RELEASE_STORE_FILE:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_STORE_PASSWORD:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_KEY_ALIAS:?Set Android release signing values in .env}"
    : "${ANDROID_RELEASE_KEY_PASSWORD:?Set Android release signing values in .env}"
    (cd android && ./gradlew assembleRelease)
    echo "APK: $ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk"
    ;;
  *)
    echo "Usage: $0 [debug|install|release]" >&2
    exit 2
    ;;
esac
