# Bristlecone weather calibration data — preliminary single-day pilot

Acquired October 23, 2026. This folder contains the preliminary reproducibility dataset for the app's bounded weather correction. It is separate from the website's curated dataset catalogue and does not establish a validated mountain-weather product. No application code was changed by the data acquisition itself.

## Ready-to-use file

`nws-pilot-2026-10-23.jsonl`: 187 observed-temperature targets from 31 public US weather stations, one latest observation per station/UTC hour. Times span 2026-10-23 04:55–17:40 UTC. Requested 32 stations; KPDX had no observation after its latest grid update and was excluded.

SHA-256: `d39b1ce65eb16f8605602d8f79f23c0a10ff8091b63019158da9f6c5744bd394`

Station elevation range: 3–3,026 m. **Grid-to-target elevation difference is only −57.3 to +186.5 m.** A broad absolute elevation range does not validate extrapolation hundreds or thousands of metres above the reference grid. Most stations are airports/valleys; KMWN supplies summit observations.

Each row includes station coordinates/elevation, observed temperature in Celsius, forecast grid elevation, forecast temperature/RH/wind/gust/direction/cloud/precipitation probability, aggregate grid update time, each input's valid interval, source URLs, retrieval timestamps and SHA-256 hashes. Wind is converted from km/h to m/s; precipitation probability from percent to 0–1. All seven forecast inputs are required and time-matched; there is no fallback to the first value when an interval does not match.

`s.night` is computed using the application's exact `Sun.elevation()` and threshold below −4°. The row preserves the source script hash. The 5×5 elevation array uses 150 m spacing, row zero north, zoom-12 Terrarium tiles, and the exact grid/pixel conventions in `weather.js` and `trailinfo.js`. Thirty-four cached tiles total 3.67 MB. Terrain is static and not derived from weather targets.

`s.ageH` is the elapsed time from the aggregate grid update to the observation, rather than a hard-coded freshness assumption. It ranges from 0.037 to 13.424 hours. It is **not** forecast lead from an underlying NWP model initialization; that information is not supplied by this NWS grid snapshot.

## Leakage and quality review

Validation passed for every row:

- Exact timezone-aware grid update timestamp is strictly before observation timestamp.
- Observation lies within every required forecast-variable interval.
- No observation later than the observation-response retrieval time is accepted.
- Target observation appears only in `observed`, never in reference temperature, paired lapse inputs, reports, bias, or terrain. `paired` and `reports` are empty; no bias observation is supplied.
- Station/hour keys are unique and all numeric features/terrain samples are finite.
- No random row train/test split is prepared; downstream evaluation must keep stations disjoint and also test a later time block. Station IDs and target values must not enter model features.

The API responses contain MADIS QC descriptors: 182 targets have `V` and 5 have `S`. NOAA defines `V` as passing levels 1–3 and `S` as passing levels 1–2. Neither is a claim of final climate certification. Report a verified-only sensitivity check if the screened rows materially affect results. Null or other-QC targets were not retained. [MADIS surface QC](https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml).

All observations used fit in each station's first response; no later-page target is attributed to an earlier-page hash. The downloader checks pagination coverage before accepting a station and can retrieve up to six pages if needed. Every raw response has a sidecar with its URL, retrieval time, byte count and hash.

**Limitations:** one day only; no independent future-day/season validation; sparse rows for several western stations after recent grid updates; limited mountain exposure and elevation-difference coverage; temperatures only as measured targets. Wind and precipitation are inputs, not validated output targets. Official forecasts can assimilate prior station observations upstream; this pilot prevents direct target leakage in our own join but does not claim an upstream-observation-free weather model. The grid's aggregate update timestamp and current response are weaker provenance than an immutable historical issue archive. No production skill or calibrated coverage claim follows from a successful fit on these 187 rows.

## Sources and commercial-use basis

Forecasts and station observations were fetched directly from the public [NWS API](https://www.weather.gov/documentation/services-web-api). Its pricing section describes API data as open and free for any purpose. [NWS use policy](https://www.weather.gov/disclaimer) generally places its information in the public domain unless otherwise noted, permits lawful reuse, and prohibits false ownership, implied endorsement, or representing modified data as official government material. Station-provider quality can vary; preserve source credit and the raw provenance. The derived training rows and any predictions are Krummholz processing, not official NWS forecasts.

Terrain comes from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/). For these continental US points, retain the credit **USGS 3DEP, SRTM and GMTED2010 terrain data via AWS Terrain Tiles**. Provider rights/attribution details: [Tilezen attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Do not apply a blanket worldwide license statement to the full global terrain collection; providers differ by region.

No paid API, user account, personal data, synthetic weather observations, large GRIB download or training run was used. Public station location is geographic meteorological metadata.

## Reproducibility

The frozen JSONL in this repository is sufficient to reproduce feature extraction and training using the parent directory's instructions. The raw manifest is also included. Raw snapshots (27.9 MB) and the acquisition scripts listed below are retained separately in the acquisition archive; they are not app assets and are not needed to run or retrain the bundled model. Hashes and source URLs are preserved in every frozen row.

- `acquire_nws_pilot.py`: bounded acquisition and exact interval join; local cached snapshots are reused.
- `add_terrain.py`: numeric Terrarium decoding, small cached tile set.
- `add_sun.cjs`: exact application sun calculation.
- `validate_pilot.py`: leakage/time/shape checks and measured coverage statistics.
- `acquisition-summary.json`, `validation-summary.json`: outcomes and exclusions.
- `raw-source-manifest.json`: hashes of 324 raw data/sidecar/tile files, 27,850,339 bytes total.

SHA-256 of `raw-source-manifest.json`: `137ceb14247ab64b0b3b2e3f951f31c86c4be351b033799d8ca8dd934023cf0a`

For multi-day growth, retain these forecast snapshots and pair their future periods with subsequently available observations. A true historical alternative is the [NOAA HRRR archive](https://registry.opendata.aws/noaa-hrrr-pds/) linked by [NOAA](https://rapidrefresh.noaa.gov/hrrr/), using fixed issue cycles and forecast-hour fields plus independent station observations. HRRR inputs are a different forecasting product and must not be silently labeled or pooled as NWS grid forecasts; record source/cycle/lead and validate product transfer separately. No HRRR files were downloaded in this pilot.
