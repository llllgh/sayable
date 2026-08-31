#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/keytool ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  elif JAVA_21_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
    export JAVA_HOME="$JAVA_21_HOME"
  else
    echo "JDK 21 is required. Install it with: brew install openjdk@21" >&2
    exit 1
  fi
fi
export PATH="$JAVA_HOME/bin:$PATH"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${ANDROID_RELEASE_STORE_FILE:?Set ANDROID_RELEASE_STORE_FILE in .env}"
: "${ANDROID_RELEASE_STORE_PASSWORD:?Set ANDROID_RELEASE_STORE_PASSWORD in .env}"
: "${ANDROID_RELEASE_KEY_ALIAS:?Set ANDROID_RELEASE_KEY_ALIAS in .env}"
: "${ANDROID_RELEASE_KEY_PASSWORD:?Set ANDROID_RELEASE_KEY_PASSWORD in .env}"

if [[ -e "$ANDROID_RELEASE_STORE_FILE" ]]; then
  echo "Keystore already exists: $ANDROID_RELEASE_STORE_FILE" >&2
  exit 0
fi

mkdir -p "$(dirname "$ANDROID_RELEASE_STORE_FILE")"
keytool -genkeypair \
  -keystore "$ANDROID_RELEASE_STORE_FILE" \
  -storepass "$ANDROID_RELEASE_STORE_PASSWORD" \
  -alias "$ANDROID_RELEASE_KEY_ALIAS" \
  -keypass "$ANDROID_RELEASE_KEY_PASSWORD" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=Sayable, OU=Personal, O=Sayable, L=Beijing, ST=Beijing, C=CN"

echo "Created $ANDROID_RELEASE_STORE_FILE. Back up this file and .env securely."
