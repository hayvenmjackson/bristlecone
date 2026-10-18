# Mountain weather model

What the Conditions tab shows as "Mountain weather": temperature (with a 10th to 90th percentile range), precipitation type, snow level, freezing level and wind, at your elevation and at the highest ground within about 2.5 miles. It is always labeled as a model estimate, not an observation.

## Pieces

| File | Role |
|---|---|
| `app/src/main/assets/web/js/weather.js` | Fetches the inputs, reads terrain from the map's elevation tiles, draws the card |
| `app/src/main/assets/web/js/wxmodel.js` | The model: plain math, no network, runs the same in Node |
| `app/src/main/assets/web/js/wxmodel-weights.js` | Learned weights (generated; do not edit) |
| `tools/weather/build_dataset.js` | Matched observations to training rows, using the app's own feature code |
| `tools/weather/train.py` | Trains, tests on held-out stations, writes the weights |

## Inputs

| | US | Canada |
|---|---|---|
| Forecast grid | NWS gridpoints (temperature, humidity, wind, gusts, sky, chance of precipitation, weather words, snow level where published) | ECCC HRDPS 2.5 km via GeoMet (TT, HR, UU, WD) |
| Stations | Nearest NWS observation stations | ECCC SWOB realtime |
| High elevation | NRCS SNOTEL (AWDB REST API) | SWOB mountain stations |
| Evidence | Recent trail reports, OSM notes and your own field reports (precipitation type and temperatures read from the text) | same |
| Terrain | AWS Terrain Tiles, already used for hillshade | same |

All public domain or Open Government Licence Canada. Ruled out for a paid app: Open-Meteo's free tier, mPING and PRISM (non-commercial terms).

Cache: forecast grids, readings and GeoMet answers are a `FORECAST` class (30 minutes) in `CachePolicy.java` and `NetCache.swift`; point lookups and station lists are `DATA` (7 days). Offline, the last copy is used and the range widens with its age.

## The physical core

1. **Lapse rate.** Regime default (saturated 5.5 C/km, standard 6.5, dry afternoon 8.0, clear calm night 2.0 with a wide spread), blended with a least-squares fit across stations at different elevations when they span at least 300 m. A measured inversion wins.
2. **Station correction.** The forecast's error at the nearest station (within 25 km, last 2.5 hours), carried to the target with a weight that falls off with distance.
3. **Humidity aloft.** Dewpoint falls 1.8 C/km; in precipitation the air is held near saturation.
4. **Precipitation type.** P(snow) = 1 / (1 + exp(a + b T + c RH)), the humidity-aware form of Jennings et al. (2018). Freezing rain only when the official grid says so. A fresh first-hand report of the type near that elevation overrides.
5. **Snow and freezing levels.** Bisection up and down the column; the NWS snow level is averaged in when published.
6. **Wind.** Grid wind raised with height above the grid's own terrain, then weighted by exposure after Liston and Elder's MicroMet: slope into the wind and curvature (summits and ridges up, hollows and lee slopes down). Gusts use the forecast gust ratio.
7. **Range.** Spread grows with the climb, the lapse uncertainty and the forecast's age; the cold side is wider, because underestimating cold costs more on a mountain.

## The learned correction

Quantile gradient-boosted trees (150 trees, depth 3) for the core's temperature error at the 10th, 50th and 90th percentiles, from the features listed in `wxmodel-weights.js` (elevation offset, lapse regime, humidity, wind, sky, hour, month, curvature, topographic position, slope, south-facing exposure, chance of precipitation). Exported as flat node lists the app evaluates directly; `tools/jstest` checks the evaluator.

```
node tools/weather/build_dataset.js observations.jsonl > rows.csv
python3 tools/weather/train.py rows.csv
```

`train.py` tests on held-out stations (every station predicted by a model that never saw it) and refuses to write weights that do not beat the core alone. It also refits the rain/snow coefficients when there are at least 200 labeled rain or snow rows.

**Training data to collect first:** SNOTEL hourly temperature (Mountain West), NWS ASOS at summits and passes, and Mount Washington-type summit stations where licensing allows, each matched to the NWS grid forecast valid at that hour (archive the grid JSON hourly for the season; the API does not serve past forecasts).

## Still to come (1.5)

- **Opt-in observations.** Off by default. Only explicit weather reports and phone pressure readings (never phone temperature), location rounded to about 330 ft, time to 10 minutes, no device ID or track, uploaded in batches and deletable. Needs a small ingest service with neighbor-agreement outlier filtering; the nightly training run uses the same two scripts above.
- **Signed weights.** Once weights are downloaded rather than bundled, verify an ed25519 signature before use.
- **Upper-air wind.** HRRR and HRDPS pressure-level winds for summits, instead of scaling the 10 m grid wind.
- **Radar.** MRMS and ECCC radar precipitation flags as a further "is it falling now" input.
- **Trail profiles.** Shade the snow band on trail elevation profiles.
