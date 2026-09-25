#!/usr/bin/env bash
# Builds a signed debug APK without Gradle, using the Debian/Ubuntu Android build tools
# (aapt, javac, dx, zipalign, apksigner). Android Studio users can use the Gradle build instead.
set -euo pipefail
cd "$(dirname "$0")/.."

# Resources and Java are both built against the API 34 platform, so Health Connect and
# foreground-service APIs and manifest attributes are available.
# Put android-34.jar in .sdk/ (copy platforms/android-34/android.jar from an Android SDK install).
SDK=${ANDROID_JAR:-.sdk/android-34.jar}
SDK_JAVA=${ANDROID_JAR_34:-$SDK}
BT=${BUILD_TOOLS:-/usr/lib/android-sdk/build-tools/debian}
OUT=build/apk
SRC=app/src/main
rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/dex"

echo "== resources"
# The source manifest is Gradle-style (no package or SDK levels); add them for aapt.
sed 's#<manifest xmlns:android="http://schemas.android.com/apk/res/android">#<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.bristlecone">#' \
  "$SRC/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
aapt package -f -m -J "$OUT/gen" -M "$OUT/AndroidManifest.xml" -S "$SRC/res" -I "$SDK" \
  -A "$SRC/assets" -F "$OUT/unsigned.apk" --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 3 --version-name 1.1.0 -0 woff2 -0 pbf

echo "== java"
find "$SRC/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options --release 8 -cp "$SDK_JAVA" -d "$OUT/obj" @"$OUT/sources.txt"

echo "== dex"
"$BT/dx" --dex --min-sdk-version=26 --output="$OUT/dex/classes.dex" "$OUT/obj"
(cd "$OUT/dex" && aapt add ../unsigned.apk classes.dex > /dev/null)

echo "== align and sign"
KS=${KEYSTORE:-tools/debug.keystore}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Bristlecone Debug,O=Bristlecone,C=US" > /dev/null 2>&1
fi
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out "$OUT/bristlecone-debug.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/bristlecone-debug.apk"
ls -la "$OUT/bristlecone-debug.apk"
