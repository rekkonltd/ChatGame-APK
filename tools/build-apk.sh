#!/usr/bin/env bash
# =============================================================================
# THAN-DOR — сборка тестового APK без Gradle и Android Studio.
#
#   ./tools/build-apk.sh              собрать debug APK
#   ./tools/build-apk.sh --release    подписать своим ключом (см. ниже)
#
# Что нужно в окружении (на обычной машине ставится один раз):
#   JDK 17+ ................. java, keytool
#   aapt2 ................... из Android build-tools
#   android.jar ............. из Android SDK platforms
#   d8.jar .................. из Android build-tools/lib
#   apksigner.jar ........... из Android build-tools/lib
#   ecj.jar ................. компилятор Java (Eclipse Compiler for Java)
#
# Пути можно задать переменными:
#   ANDROID_JAR, AAPT2, D8_JAR, APKSIGNER_JAR, ECJ_JAR, JAVA_HOME
#
# В песочнице Arena эти пути подставляются автоматически (см. tools/README.md).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/android-native"
BUILD="$NATIVE/build"
OUT="$ROOT/artifacts"
WEB="$ROOT/prototype"
PKG_PATH="com/thandor/vtorzhenie"

# ── поиск инструментов ───────────────────────────────────────────────────────
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA="$JAVA_HOME/bin/java"
else
  JAVA="$(command -v java || true)"
fi
KEYTOOL="$(dirname "${JAVA:-/usr/bin/java}")/keytool"

AAPT2="${AAPT2:-$(command -v aapt2 || true)}"
ANDROID_JAR="${ANDROID_JAR:-}"
D8_JAR="${D8_JAR:-}"
APKSIGNER_JAR="${APKSIGNER_JAR:-}"
ECJ_JAR="${ECJ_JAR:-}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
need() { [ -n "$1" ] && [ -e "$1" ] || die "не найден $2 (путь: '$1')"; }

need "$JAVA" "java (JDK)"
need "$AAPT2" "aapt2"
need "$ANDROID_JAR" "android.jar"
need "$D8_JAR" "d8.jar"
need "$APKSIGNER_JAR" "apksigner.jar"
need "$ECJ_JAR" "ecj.jar"

VERSION_NAME="${VERSION_NAME:-0.1.0}"
VERSION_CODE="${VERSION_CODE:-1}"
RELEASE=0
[ "${1:-}" = "--release" ] && RELEASE=1

echo "== THAN-DOR APK =========================================="
echo "java:      $JAVA"
echo "aapt2:     $AAPT2"
echo "android:   $ANDROID_JAR"

rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$BUILD/assets" "$OUT"

# ── 1. манифест: подставляем версию ─────────────────────────────────────────
sed -e "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$VERSION_CODE\"/" \
    -e "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION_NAME\"/" \
    "$NATIVE/AndroidManifest.xml" > "$BUILD/AndroidManifest.xml"

# ── 2. ресурсы ───────────────────────────────────────────────────────────────
echo "-- compile resources"
"$AAPT2" compile --dir "$NATIVE/res" -o "$BUILD/res/compiled.zip"

echo "-- link resources + manifest"
"$AAPT2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$BUILD/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --auto-add-overlay \
  "$BUILD/res/compiled.zip"

# ── 3. java ──────────────────────────────────────────────────────────────────
echo "-- compile java"
mkdir -p "$BUILD/java/$PKG_PATH"
cp "$NATIVE/src/$PKG_PATH/MainActivity.java" "$BUILD/java/$PKG_PATH/"
"$JAVA" -jar "$ECJ_JAR" -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  "$BUILD/java/$PKG_PATH/MainActivity.java" 2>&1 | grep -v "^Note:" || true

[ -f "$BUILD/classes/$PKG_PATH/MainActivity.class" ] || die "MainActivity не скомпилировался"

# ── 4. dex ───────────────────────────────────────────────────────────────────
echo "-- dex (d8)"
"$JAVA" -cp "$D8_JAR" com.android.tools.r8.D8 \
  --min-api 21 \
  --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" \
  $(find "$BUILD/classes" -name '*.class')

[ -f "$BUILD/dex/classes.dex" ] || die "classes.dex не создан"

# ── 5. www: прототип внутрь APK ──────────────────────────────────────────────
echo "-- copy web prototype"
mkdir -p "$BUILD/www"
cp -r "$WEB/index.html" "$WEB/css" "$WEB/js" "$WEB/audio" "$BUILD/www/"

# игровой шрифт уже системный; Google Fonts в APK не грузим (нет интернета)
sed -i \
  -e '/preconnect/d' \
  -e '/fonts.googleapis.com/d' \
  "$BUILD/www/index.html"

# ── 6. упаковка с выравниванием ──────────────────────────────────────────────
echo "-- package + align"
python3 "$ROOT/tools/apk_pack.py" "$BUILD/base.apk" "$BUILD/app-unsigned.apk" \
  "$BUILD/dex/classes.dex" "$BUILD/www"

# ── 7. подпись ───────────────────────────────────────────────────────────────
if [ "$RELEASE" = "1" ] && [ -n "${THANDOR_KEYSTORE:-}" ]; then
  KS="$THANDOR_KEYSTORE"
  ALIAS="${THANDOR_ALIAS:-thandor}"
  need "$KS" "keystore"
  echo "-- sign (release)"
  "$JAVA" -jar "$APKSIGNER_JAR" sign \
    --ks "$KS" --ks-key-alias "$ALIAS" \
    --ks-pass "env:THANDOR_STOREPASS" --key-pass "env:THANDOR_KEYPASS" \
    --v1-signing-enabled true --v2-signing-enabled true \
    --out "$OUT/thandor-$VERSION_NAME.apk" "$BUILD/app-unsigned.apk"
else
  KS="$BUILD/debug.keystore"
  if [ ! -f "$KS" ]; then
    echo "-- create debug keystore"
    "$KEYTOOL" -genkeypair -v \
      -keystore "$KS" -storepass android -keypass android \
      -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10950 \
      -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1 \
      || die "keytool не смог создать debug keystore"
  fi
  echo "-- sign (debug)"
  "$JAVA" -jar "$APKSIGNER_JAR" sign \
    --ks "$KS" --ks-key-alias androiddebugkey \
    --ks-pass pass:android --key-pass pass:android \
    --v1-signing-enabled true --v2-signing-enabled true \
    --out "$OUT/thandor-debug-$VERSION_NAME.apk" "$BUILD/app-unsigned.apk"
fi

APK="$(ls -t "$OUT"/*.apk | head -1)"
echo "-- verify"
"$JAVA" -jar "$APKSIGNER_JAR" verify --print-certs "$APK" | head -6

echo
echo "ГОТОВО: $APK"
echo "размер: $(du -h "$APK" | cut -f1)"
echo
echo "Установка на телефон:  adb install -r \"$APK\""
