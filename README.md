# Bristlecone

Trail maps for the US and Canada, drawn from public data. *Know the ground.*

Android app (minSdk 26, Android 8.0 and newer). Native Java shell with a bundled MapLibre GL JS map engine. No third-party Android libraries, no account, no tracking.

## Install the test build

1. Copy `bristlecone-debug.apk` to the phone.
2. Open it and allow "Install unknown apps" for your file manager when Android asks.
3. On first launch, allow Location (and Physical activity, which the step counter needs for position estimates).

The debug APK is signed with a throwaway debug key. Build a release with your own key before publishing.

## What it does

| Feature | How |
|---|---|
| Trail map | Custom vector style (light and dark) over OpenStreetMap data via OpenFreeMap. Trails come from OpenStreetMap through the Overpass API and are restyled by type: hiking (with SAC difficulty), downhill ski runs (colored by difficulty), Nordic trails, ATV/OHV, bike/MTB, horse, via ferrata, climbing nodes. Climbing areas also from OpenBeta. |
| Terrain | Hillshade and contour lines generated on the phone from AWS Terrain Tiles (USGS 3DEP, SRTM, NRCan CDEM and others), in feet or meters. Optional 3D terrain. |
| Other base maps | USGS Topo, USGS Imagery (US), OpenTopoMap (US and Canada), Canada Base Map (NRCan). Trails, lands and borders draw over any of them. |
| Boundaries | Country, state and provincial borders. Public and protected lands from USGS PAD-US 4.1 (national parks, national forests, BLM, wildlife refuges, state and local lands) and ECCC CPCAD (Canada). Tribal lands from US Census TIGERweb (reservations, trust lands). First Nations reserves and settlement lands plus national parks from NRCan CLSS. |
| Trailheads | Tap for the OpenStreetMap address if tagged, otherwise the nearest road address (Nominatim), otherwise coordinates. Copy, share, or open directions in any maps app. |
| Position | GPS first. If GPS drops out: Wi-Fi and cell location, then dead reckoning from the last good fix (step detector, compass with magnetic declination, barometer) using a stride model the phone learns from your own GPS walks (recursive least squares). Anything but GPS is shown in amber, labeled as an estimate, with a growing uncertainty circle and a prompt to confirm against landmarks. The dot is matched to the nearest trail when one is inside the circle. |
| Reports | National Weather Service, Environment and Climate Change Canada, National Park Service alerts and closures, Avalanche.org, Avalanche Canada, NIFC wildfire perimeters, OpenStreetMap trail notes, and your own field reports. Always sorted newest first and grouped by age. Saved copies are labeled with their age when offline. |
| Offline | "Download this view" saves vector tiles, terrain, glyphs, trail data, land boundaries, hazards and a reports snapshot. Every request the map makes is also cached as you browse. Downloaded regions survive cache trimming and server tile updates. |
| Export | Map image with a Bristlecone credit strip, and GPX of trails in view. |
| Languages | English (US), English (Canada), Français (Canada), Español (EE. UU. y Latinoamérica). Switch any time in Settings. |
| Appearance | Automatic light and dark from sunrise and sunset at your location (NOAA solar math), or fixed light or dark. |
| Storage | Everything lives on the phone. "Back up to Google Drive" writes a single .zip through the Android file picker; choose Drive as the destination. Restore reads it back. Optionally include downloaded maps. |

## Project layout

```
app/src/main/java/app/bristlecone/   Native layer
  MainActivity.java     WebView host, permissions, file picker, system bars
  Bridge.java           Calls available to the web UI
  NetCache.java         Local-first network layer and cache (serves the UI too)
  CachePolicy.java      What is cached and for how long
  RegionManager.java    Offline region downloads
  LocationEngine.java   GPS, network location, dead reckoning
  StrideModel.java      Learned step length (recursive least squares)
  DeadReckoner.java     Position and uncertainty math
  Storage.java          Settings, places, backup and restore
app/src/main/assets/web/             UI
  js/style.js           Map style (all themes, units, bases)
  js/data.js            Trails, lands, climbing, fire, geocoding
  js/reports.js         Conditions and reports
  js/offline.js         Region planning, GPX and image export
  js/i18n.js            All four languages
  js/app.js             App controller
  css/app.css           Katsura design language
branding/                            Mark and icon sources (SVG)
tools/                               Build and test scripts
```

## Building

**Android Studio:** open the folder. The Gradle files target compileSdk and targetSdk 35 with AGP 8.9.1 and Gradle 8.14.3. Studio may offer to update AGP; that is fine.

**Command line without Gradle** (how the included APK was built, on Ubuntu):

```
sudo apt install android-sdk-platform-23 aapt dalvik-exchange apksigner zipalign openjdk-21-jdk
./tools/build-apk.sh
```

## Tests

- `./tools/test-logic.sh`: stride model, dead reckoning, cache policy (24 checks).
- `node tools/jstest/style-and-data.test.js`: validates the map style against the MapLibre spec in all 80 theme, unit, base map and language combinations; trail parsing and classification; polygon handling; sunrise math; that French and Spanish have every string; no em or en dashes; no stock marketing words.
- `node tools/uitest/run.js`: headless UI run with synthetic tiles and mocked public APIs, capturing screenshots in all languages and both themes.

## Before a public launch

- **Name.** No Android app named Bristlecone turned up in a search, but the name is used elsewhere in tech (Bristlecone Inc. is a supply-chain software company, and Google used it for a quantum chip). Run a USPTO and CIPO trademark search, and consider "Bristlecone Maps" or "Bristlecone Trails" as the store name.
- **Shared public services.** Overpass, Nominatim, OpenFreeMap and OpenTopoMap are volunteer or donation-run and have fair-use policies. They are fine for testing and light use. At scale, self-host Overpass and Nominatim, host your own OpenFreeMap/PMTiles extract, or use a paid provider. The National Park Service demo key is rate limited; add a free key in Settings.
- **Real device testing.** The UI, map style and logic were tested in headless Chromium and plain Java. Sensors, GPS fallbacks, the file picker and downloads need a pass on real phones.
- **Store requirements.** Release signing key, privacy policy (location use), data-safety form, and the Play location permission declaration (the app only uses location while it is open).
- **Google Drive.** Backup uses the system file picker, so no Google Cloud project or sign-in is needed. Automatic scheduled Drive sync would need the Drive REST API with an OAuth client.

## Credits

Map data © OpenStreetMap contributors (ODbL). OpenMapTiles, OpenFreeMap, USGS, NRCan (Open Government Licence Canada), ECCC, US Census Bureau, NPS, NWS, NIFC, Avalanche.org, Avalanche Canada, OpenBeta, OpenTopoMap (CC-BY-SA). MapLibre GL JS and maplibre-contour (BSD-3-Clause). Inter and Cormorant Garamond (SIL OFL).

Made by H.M. Jackson.
