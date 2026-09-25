/* Bristlecone map style. One builder for light and dark, imperial and metric, and every base map.
   The base vector map uses the OpenMapTiles schema served free by OpenFreeMap. */
(function () {
  const OFM = 'https://tiles.openfreemap.org/planet';
  // Map labels use Overpass glyphs bundled with the app (tools/fonts/make_glyphs.py). The native
  // layer falls back to Noto Sans from OpenFreeMap for scripts Overpass does not cover.
  // On iOS the bundled glyphs are reached through the app's cache under the Android host name.
  const GLYPHS = (window.BC_PROXY ? 'https://app.bristlecone.local' : location.origin) + '/glyphs/{fontstack}/{range}.pbf';
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const F = { reg: ['Overpass Regular'], bold: ['Overpass Bold'], ital: ['Overpass Italic'] };

  const BASES = {
    bristlecone: null,
    // Satellite is one choice in the UI; the app picks the imagery for where the map is:
    // USGS NAIP aerials in the US (about 1 m, public domain) and the 2016 Sentinel-2 cloudless
    // mosaic elsewhere (10 m, CC BY-SA 4.0, commercial use allowed).
    satNaip: { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'Imagery: USGS The National Map (NAIP)' },
    satS2: { tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'], maxzoom: 14, attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)' },
    usgsTopo: { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'USGS The National Map' },
    openTopo: { tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'], maxzoom: 17, attribution: 'OpenTopoMap (CC-BY-SA), SRTM' },
    canada: { tiles: ['https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}'], maxzoom: 17, attribution: 'Natural Resources Canada, Canada Base Map' }
  };

  const PALETTE = {
    light: {
      bg: '#F2EFE6', water: '#A9CFE0', waterLine: '#7FB3CC', wood: '#D3E2C4', grass: '#E3EAD0', ice: '#F7FAFB', rock: '#E2DDD3',
      sand: '#EEE4C9', wetland: '#D5E4DA', scrub: '#DCE5CB', meadow: '#E8EDD6', farmland: '#EFEDDD', scree: '#E6E1D8', glacier: '#F4F9FB', cemetery: '#DCE6D2', residential: '#EAE5DA', building: '#DDD5C6', buildingLine: '#CFC6B5',
      roadCase: '#B3A992', motorway: '#E59A55', trunk: '#EDB673', primary: '#F4D08F', secondary: '#FAE5B6', minor: '#FFFFFF', service: '#FBFAF6', unpaved: '#EFE3C8', unpavedCase: '#A68A5E', bridgeCase: '#8E8471', tunnel: '#F4F1EA',
      track: '#8F7550', rail: '#9C958A', text: '#26241F', textSoft: '#5B574E', halo: 'rgba(246,243,234,0.92)',
      country: '#5D3F66', state: '#8C7892', contour: '#A28763', contourMajor: '#8A6D45', hsShadow: '#473B2B', hsHighlight: '#FFFFFF',
      park: '#8DB36B', trailCase: 'rgba(255,255,255,0.85)', peak: '#5A4632', meFill: '#1F6B4A', estimate: '#D9901A'
    },
    dark: {
      bg: '#10181A', water: '#16303C', waterLine: '#24495A', wood: '#16261C', grass: '#18261D', ice: '#26343A', rock: '#1E2524',
      sand: '#2A2A22', wetland: '#172A26', scrub: '#18241C', meadow: '#1A251E', farmland: '#1B2320', scree: '#232826', glacier: '#2C3A40', cemetery: '#18241C', residential: '#172022', building: '#1F2A2C', buildingLine: '#2A3638',
      roadCase: '#070C0D', motorway: '#A36A36', trunk: '#8F653A', primary: '#735D3E', secondary: '#524D3F', minor: '#3D4443', service: '#323938', unpaved: '#3A362C', unpavedCase: '#6E5E44', bridgeCase: '#000000', tunnel: '#262D2D',
      track: '#B0915F', rail: '#4A504E', text: '#E8E3D5', textSoft: '#A9A392', halo: 'rgba(16,24,26,0.92)',
      country: '#C5A6CF', state: '#8F7F96', contour: '#7A6A52', contourMajor: '#9A8561', hsShadow: '#000000', hsHighlight: '#3C4A48',
      park: '#4F7A45', trailCase: 'rgba(16,24,26,0.8)', peak: '#D8C9A8', meFill: '#58C28F', estimate: '#F0A92E'
    }
  };

  const LAND_COLORS = {
    NPS: '#5E9446', PC: '#5E9446', USFS: '#7FAE5A', BLM: '#E2B96B', FWS: '#5FA99A', STAT: '#4E9E8C', LOC: '#9DC08A',
    FED: '#A8B38A', NGO: '#9BB7A0', TRIB: '#B97746', OTH: '#9FB097'
  };

  const TRAIL = {
    hiking: '#B8412F', footway: '#B8412F', steps: '#B8412F', ski_nordic: '#2F77B8', ski_other: '#5B6FB0', atv: '#D07A1E',
    bike: '#7A4FB5', horse: '#8A5A2B', via_ferrata: '#3A3A3A', track: '#8F7550'
  };
  const PISTE = ['match', ['get', 'difficulty'],
    'novice', '#2E9E5B', 'easy', '#2E9E5B', 'intermediate', '#1F5FBF', 'advanced', '#111111', 'expert', '#111111',
    'freeride', '#E07B20', 'extreme', '#C0302B', '#1F5FBF'];

  function nameExpr(lang) {
    if (lang === 'fr-CA') return ['coalesce', ['get', 'name:fr'], ['get', 'name']];
    if (lang === 'es-419') return ['coalesce', ['get', 'name'], ['get', 'name:es']];
    return ['coalesce', ['get', 'name'], ['get', 'name_en']];
  }

  function build(o) {
    let P = PALETTE[o.dark ? 'dark' : 'light'];
    const nm = nameExpr(o.lang);
    const imperial = o.units === 'imperial';
    const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
    const L = o.layers;
    const vectorBase = o.base === 'bristlecone' || !BASES[o.base];
    const hybrid = o.base === 'satNaip' || o.base === 'satS2';
    const roadsOn = vectorBase || hybrid;
    // On imagery, labels are light with dark halos, the way aerial maps are usually lettered.
    if (hybrid) P = Object.assign({}, P, { text: '#FFFFFF', textSoft: '#F1EDE2', halo: 'rgba(0,0,0,0.78)', peak: '#FFF4D6', state: '#F1E4F5', country: '#F7E9FB', contour: '#F3E3C0', contourMajor: '#FFF1CF' });
    const sources = {
      omt: { type: 'vector', url: OFM, attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
      dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: 'Terrain: USGS 3DEP, SRTM, GMTED, and others via <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>' },
      demhs: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12 },
      trails: { type: 'geojson', data: o.data.trails, attribution: 'Trails: © OpenStreetMap contributors' },
      points: { type: 'geojson', data: o.data.points },
      crags: { type: 'geojson', data: o.data.crags, attribution: 'Climbing: OpenBeta' },
      lands: { type: 'geojson', data: o.data.lands, attribution: 'Lands: USGS PAD-US, US Census TIGER, NRCan, ECCC CPCAD' },
      fire: { type: 'geojson', data: o.data.fire, attribution: 'Wildfire: NIFC' },
      avy: { type: 'geojson', data: o.data.avy, attribution: 'Avalanche.org' },
      mine: { type: 'geojson', data: o.data.mine },
      me: { type: 'geojson', data: o.data.me },
      hl: { type: 'geojson', data: o.data.hl },
      track: { type: 'geojson', data: o.data.track || { type: 'FeatureCollection', features: [] } }
    };
    if (o.contourUrl) sources.contours = { type: 'vector', tiles: [o.contourUrl], maxzoom: 15 };
    if (!vectorBase) sources.raster = Object.assign({ type: 'raster', tileSize: 256 }, BASES[o.base]);

    const layers = [];
    const add = (l) => layers.push(l);

    add({ id: 'bg', type: 'background', paint: { 'background-color': P.bg } });

    if (!vectorBase) {
      add({ id: 'raster', type: 'raster', source: 'raster', paint: { 'raster-opacity': 1, 'raster-brightness-max': o.dark ? 0.75 : 1, 'raster-saturation': o.dark ? -0.2 : 0 } });
    } else {
      const lc = (sub) => ['in', ['coalesce', ['get', 'subclass'], ''], ['literal', sub]];
      const cl = (c) => ['==', ['get', 'class'], c];
      add({ id: 'landcover-farmland', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('farmland'), paint: { 'fill-color': P.farmland, 'fill-opacity': 0.8 } });
      add({ id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['all', cl('grass'), ['!', lc(['scrub', 'heath', 'fell', 'shrubbery'])]], paint: { 'fill-color': P.meadow, 'fill-opacity': 0.85 } });
      add({ id: 'landcover-scrub', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['any', lc(['scrub', 'heath', 'fell', 'shrubbery']), ['all', cl('grass'), lc(['scrub'])]], paint: { 'fill-color': P.scrub, 'fill-opacity': 0.9 } });
      add({ id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('wood'), paint: { 'fill-color': P.wood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 0.92] } });
      add({ id: 'landcover-wetland', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('wetland'), paint: { 'fill-color': P.wetland, 'fill-opacity': 0.85 } });
      add({ id: 'landcover-rock', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('rock'), paint: { 'fill-color': ['match', ['coalesce', ['get', 'subclass'], ''], 'scree', P.scree, 'shingle', P.scree, P.rock] } });
      add({ id: 'landcover-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('sand'), paint: { 'fill-color': P.sand } });
      add({ id: 'landcover-ice', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cl('ice'), paint: { 'fill-color': P.glacier } });
      add({ id: 'landcover-ice-edge', type: 'line', source: 'omt', 'source-layer': 'landcover', filter: cl('ice'), minzoom: 10, paint: { 'line-color': o.dark ? '#5B7C8A' : '#9CC3D3', 'line-width': 0.8, 'line-dasharray': [3, 2] } });
      add({ id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail']]], maxzoom: 16, paint: { 'fill-color': P.residential, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 15, 0.9] } });
      add({ id: 'landuse-cemetery', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cl('cemetery'), minzoom: 12, paint: { 'fill-color': P.cemetery } });
      add({ id: 'park-fill', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': ['match', ['get', 'class'], 'aboriginal_lands', LAND_COLORS.TRIB, P.park], 'fill-opacity': o.dark ? 0.1 : 0.12 } });
    }

    if (vectorBase) {
      add({ id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': P.water } });
      add({ id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', minzoom: 11, paint: { 'line-color': P.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2], 'line-opacity': 0.8 } });
      add({ id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': P.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, ['match', ['get', 'class'], 'river', 3, 1.2]] } });
    }

    // Multidirectional relief: light from several directions reads as real terrain rather than
    // a single spotlight, the way modern relief maps are shaded.
    add({ id: 'hillshade', type: 'hillshade', source: 'demhs', layout: vis(L.hillshade), paint: {
      'hillshade-method': 'multidirectional',
      'hillshade-illumination-direction': [270, 315, 0, 45],
      'hillshade-illumination-altitude': [30, 40, 30, 25],
      'hillshade-highlight-color': o.dark ? ['#2E3B39', '#344341', '#2A3735', '#26312F'] : ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.2)'],
      'hillshade-shadow-color': o.dark ? ['#000000', '#000000', '#050807', '#050807'] : ['rgba(60,50,35,0.35)', 'rgba(60,50,35,0.55)', 'rgba(60,50,35,0.3)', 'rgba(60,50,35,0.2)'],
      'hillshade-exaggeration': vectorBase ? (o.dark ? 0.38 : 0.45) : 0.18 } });

    if (vectorBase) {
      add({ id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13.5, maxzoom: 15.5, paint: { 'fill-color': P.building, 'fill-outline-color': P.buildingLine } });
      add({ id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 15, filter: ['!=', ['get', 'hide_3d'], true], paint: {
        'fill-extrusion-color': P.building, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.6, 0.85] } });
    }

    if (sources.contours) {
      add({ id: 'contour', type: 'line', source: 'contours', 'source-layer': 'contours', layout: Object.assign(vis(L.contours), { 'line-join': 'round' }), minzoom: 10, paint: { 'line-color': ['case', ['>', ['get', 'level'], 0], P.contourMajor, P.contour], 'line-width': ['case', ['>', ['get', 'level'], 0], 1.1, 0.5], 'line-opacity': vectorBase ? 0.75 : 0.9 } });
      add({ id: 'contour-label', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0], minzoom: 12, layout: Object.assign(vis(L.contours), { 'symbol-placement': 'line', 'text-field': ['concat', ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }], imperial ? ' ft' : ' m'], 'text-font': F.reg, 'text-size': 10, 'text-max-angle': 25, 'text-padding': 10 }), paint: { 'text-color': P.contourMajor, 'text-halo-color': P.halo, 'text-halo-width': 1.2 } });
    }

    // Public lands, tribal and First Nations lands
    const landColor = ['match', ['get', 'mgr'], 'NPS', LAND_COLORS.NPS, 'PC', LAND_COLORS.PC, 'USFS', LAND_COLORS.USFS, 'BLM', LAND_COLORS.BLM, 'FWS', LAND_COLORS.FWS,
      'STAT', LAND_COLORS.STAT, 'LOC', LAND_COLORS.LOC, 'FED', LAND_COLORS.FED, 'NGO', LAND_COLORS.NGO, 'TRIB', LAND_COLORS.TRIB, LAND_COLORS.OTH];
    add({ id: 'lands-fill', type: 'fill', source: 'lands', filter: ['!=', ['get', 'mgr'], 'TRIB'], layout: vis(L.lands), paint: { 'fill-color': landColor, 'fill-opacity': o.dark ? 0.16 : 0.2 } });
    add({ id: 'tribal-fill', type: 'fill', source: 'lands', filter: ['==', ['get', 'mgr'], 'TRIB'], layout: vis(L.tribal), paint: { 'fill-color': LAND_COLORS.TRIB, 'fill-opacity': o.dark ? 0.14 : 0.16 } });

    add({ id: 'fire-fill', type: 'fill', source: 'fire', layout: vis(L.fire), paint: { 'fill-color': '#D9412B', 'fill-opacity': 0.28 } });
    add({ id: 'fire-line', type: 'line', source: 'fire', layout: vis(L.fire), paint: { 'line-color': '#B32D1A', 'line-width': 1.6 } });
    add({ id: 'avy-fill', type: 'fill', source: 'avy', layout: vis(L.avalanche), maxzoom: 12, paint: { 'fill-color': ['coalesce', ['get', 'color'], '#999999'], 'fill-opacity': 0.22 } });

    add({ id: 'lands-line', type: 'line', source: 'lands', filter: ['!=', ['get', 'mgr'], 'TRIB'], layout: vis(L.lands), paint: { 'line-color': landColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 13, 2], 'line-opacity': 0.85 } });
    add({ id: 'tribal-line', type: 'line', source: 'lands', filter: ['==', ['get', 'mgr'], 'TRIB'], layout: vis(L.tribal), paint: { 'line-color': LAND_COLORS.TRIB, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 13, 2.2], 'line-dasharray': [3, 1.5] } });
    if (vectorBase) {
      add({ id: 'park-line', type: 'line', source: 'omt', 'source-layer': 'park', layout: vis(!L.lands), paint: { 'line-color': P.park, 'line-width': 1, 'line-opacity': 0.7 } });
    }

    if (roadsOn) {
      // Roads. Widths follow real road widths once zoomed in (exponential base 2 doubles each
      // zoom level, as ground distance does), and stay legible when zoomed out.
      const REAL = { motorway: 24, trunk: 18, primary: 13, secondary: 11, tertiary: 9, minor: 7, service: 4.5 };
      const MIN = { motorway: [0.6, 1.8, 3.2], trunk: [0.5, 1.5, 2.8], primary: [0.4, 1.3, 2.4], secondary: [0.3, 1.1, 2], tertiary: [0.2, 0.9, 1.7], minor: [0.1, 0.6, 1.3], service: [0.05, 0.3, 0.8] };
      const roadW = (k, extra) => {
        const e = extra || 0, m = MIN[k], z15 = Math.max(m[2] * 1.35, REAL[k] / 3.66);
        return ['interpolate', ['exponential', 2], ['zoom'], 5, m[0] + e * 0.4, 10, m[1] + e * 0.7, 13, m[2] + e, 15, z15 + e, 20, z15 * 32 + e * 2];
      };
      const cls = (c) => ['==', ['get', 'class'], c];
      const unpaved = ['==', ['get', 'surface'], 'unpaved'];
      const tunnel = ['==', ['get', 'brunnel'], 'tunnel'];
      const bridge = ['==', ['get', 'brunnel'], 'bridge'];
      const road = [
        ['service', ['all', cls('service'), ['!', ['in', ['get', 'service'], ['literal', ['parking_aisle', 'driveway']]]]], P.service, 13],
        ['minor', cls('minor'), P.minor, 11],
        ['tertiary', cls('tertiary'), P.secondary, 9],
        ['secondary', cls('secondary'), P.secondary, 8],
        ['primary', cls('primary'), P.primary, 6],
        ['trunk', cls('trunk'), P.trunk, 5],
        ['motorway', cls('motorway'), P.motorway, 4]
      ];
      const hy = hybrid ? 0.72 : 1;
      road.forEach(([id, f, color, minz]) => {
        add({ id: 'road-case-' + id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', f, ['!', tunnel]], minzoom: minz, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['case', bridge, P.bridgeCase, unpaved, P.unpavedCase, P.roadCase], 'line-width': roadW(id, 1.6), 'line-opacity': ['interpolate', ['linear'], ['zoom'], minz, 0, minz + 1, hybrid ? 0.55 : 1] } });
        add({ id: 'road-case-tunnel-' + id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', f, tunnel], minzoom: Math.max(minz, 12),
          paint: { 'line-color': P.roadCase, 'line-width': roadW(id, 1.2), 'line-dasharray': [0.6, 0.5], 'line-opacity': 0.8 } });
      });
      road.forEach(([id, f, color, minz]) => {
        add({ id: 'road-' + id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter: f, minzoom: minz, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['case', tunnel, P.tunnel, unpaved, P.unpaved, color], 'line-width': roadW(id), 'line-opacity': hy } });
      });
      add({ id: 'road-unpaved-dash', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', unpaved, ['in', ['get', 'class'], ['literal', ['minor', 'tertiary', 'secondary', 'service']]]], minzoom: 13,
        paint: { 'line-color': P.unpavedCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1.5], 'line-dasharray': [2, 3], 'line-opacity': 0.7 } });
      add({ id: 'road-track', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'track'], minzoom: 11, paint: { 'line-color': hybrid ? '#F3E3C0' : P.track, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.6, 16, 2, 19, 5], 'line-dasharray': [3, 1.5] } });
      add({ id: 'road-oneway', type: 'symbol', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'oneway'], 1], minzoom: 16,
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 120, 'icon-image': 'bc-oneway', 'icon-size': 0.8, 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true } });
      if (vectorBase) {
        add({ id: 'omt-path', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'path'], minzoom: 12, layout: vis(L.hiking), paint: { 'line-color': TRAIL.hiking, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.6], 'line-dasharray': [2, 1.4], 'line-opacity': 0.65 } });
        add({ id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], minzoom: 8, paint: { 'line-color': P.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 16, 2.2] } });
        add({ id: 'rail-ties', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], minzoom: 13, paint: { 'line-color': P.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 8], 'line-dasharray': [0.2, 2.5] } });
      }
    }

    // Borders (also over imagery and other base maps, so wayfinding stays consistent)
    add({ id: 'border-state', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], layout: vis(L.admin), paint: { 'line-color': P.state, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 10, 1.6], 'line-dasharray': [4, 2, 1, 2] } });
    if (vectorBase) add({ id: 'border-country-case', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], layout: vis(L.admin), paint: { 'line-color': P.country, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 7], 'line-opacity': 0.18 } });
    add({ id: 'border-country', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], layout: vis(L.admin), paint: { 'line-color': P.country, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 2] } });

    // Trails (from OpenStreetMap via Overpass, restyled here)
    const kindIs = (k) => ['==', ['get', 'kind'], k];
    const kindIn = (arr) => ['in', ['get', 'kind'], ['literal', arr]];
    const tw = (w) => ['interpolate', ['linear'], ['zoom'], 11, w * 0.6, 14, w, 17, w * 2.2];
    add({ id: 'trail-case', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, filter: ['!=', ['get', 'kind'], 'track'], paint: { 'line-color': P.trailCase, 'line-width': tw(4.2), 'line-opacity': vectorBase ? 0.9 : 0.75 } });
    add({ id: 'trail-track', type: 'line', source: 'trails', filter: kindIs('track'), layout: vis(L.atv), paint: { 'line-color': P.track, 'line-width': tw(1.6), 'line-dasharray': [3, 1.5] } });
    const alpine = ['in', ['get', 'sac'], ['literal', ['alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking']]];
    add({ id: 'trail-hiking', type: 'line', source: 'trails', filter: ['all', kindIn(['hiking', 'footway', 'steps']), ['!', alpine]], layout: Object.assign(vis(L.hiking), { 'line-cap': 'round', 'line-join': 'round' }),
      paint: { 'line-color': TRAIL.hiking, 'line-width': tw(2.2), 'line-dasharray': [2.6, 1.2] } });
    add({ id: 'trail-alpine', type: 'line', source: 'trails', filter: ['all', kindIn(['hiking', 'footway', 'steps']), alpine], layout: Object.assign(vis(L.hiking), { 'line-cap': 'round', 'line-join': 'round' }),
      paint: { 'line-color': TRAIL.hiking, 'line-width': tw(1.7), 'line-dasharray': [0.8, 1.7] } });
    add({ id: 'trail-bike', type: 'line', source: 'trails', filter: kindIs('bike'), layout: vis(L.bike), paint: { 'line-color': TRAIL.bike, 'line-width': tw(2), 'line-dasharray': [3, 1] } });
    add({ id: 'trail-horse', type: 'line', source: 'trails', filter: kindIs('horse'), layout: vis(L.horse), paint: { 'line-color': TRAIL.horse, 'line-width': tw(2), 'line-dasharray': [2, 1, 0.5, 1] } });
    add({ id: 'trail-atv', type: 'line', source: 'trails', filter: kindIs('atv'), layout: vis(L.atv), paint: { 'line-color': TRAIL.atv, 'line-width': tw(2.6), 'line-dasharray': [4, 1.2] } });
    add({ id: 'trail-nordic', type: 'line', source: 'trails', filter: kindIn(['ski_nordic', 'ski_other']), layout: vis(L.ski), paint: { 'line-color': TRAIL.ski_nordic, 'line-width': tw(2.2), 'line-dasharray': [1.2, 1.2] } });
    add({ id: 'trail-downhill', type: 'line', source: 'trails', filter: kindIs('ski_downhill'), layout: Object.assign(vis(L.ski), { 'line-cap': 'round' }), paint: { 'line-color': o.dark ? ['match', ['get', 'difficulty'], 'advanced', '#E8E8E8', 'expert', '#E8E8E8', PISTE] : PISTE, 'line-width': tw(3), 'line-opacity': 0.9 } });
    add({ id: 'trail-ferrata', type: 'line', source: 'trails', filter: kindIs('via_ferrata'), layout: vis(L.climbing), paint: { 'line-color': o.dark ? '#E8E3D5' : TRAIL.via_ferrata, 'line-width': tw(2), 'line-dasharray': [0.5, 1] } });
    add({ id: 'hl-line', type: 'line', source: 'hl', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#C9A227', 'line-width': tw(7), 'line-opacity': 0.55 } });
    add({ id: 'hl-fill', type: 'line', source: 'hl', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#C9A227', 'line-width': 3 } });

    // Labels
    if (roadsOn) {
      add({ id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': nm, 'text-font': F.ital, 'text-size': 12 }, paint: { 'text-color': o.dark ? '#7FB0C4' : '#3F7390', 'text-halo-color': P.halo, 'text-halo-width': 1 } });
      add({ id: 'water-name-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'text-field': nm, 'text-font': F.ital, 'text-size': 12, 'symbol-placement': 'line' }, paint: { 'text-color': o.dark ? '#7FB0C4' : '#3F7390', 'text-halo-color': P.halo, 'text-halo-width': 1 } });
      add({ id: 'waterway-name', type: 'symbol', source: 'omt', 'source-layer': 'waterway', minzoom: 12, layout: { 'text-field': nm, 'text-font': F.ital, 'text-size': 11, 'symbol-placement': 'line' }, paint: { 'text-color': o.dark ? '#7FB0C4' : '#3F7390', 'text-halo-color': P.halo, 'text-halo-width': 1 } });
      add({ id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 12.5, filter: ['has', 'name'], layout: { 'text-field': nm, 'text-font': F.reg, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 18, 13], 'symbol-placement': 'line', 'text-max-angle': 30, 'text-padding': 4 }, paint: { 'text-color': P.textSoft, 'text-halo-color': P.halo, 'text-halo-width': 1.5 } });
      // Route shields: Interstate, US and state highways, Trans-Canada and provincial routes.
      add({ id: 'road-shield', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 6, filter: ['all', ['has', 'ref'], ['<=', ['coalesce', ['get', 'ref_length'], 9], 6]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 360,
          'icon-image': ['concat', 'shield|', ['coalesce', ['get', 'network'], 'road'], '|', ['get', 'ref']], 'icon-rotation-alignment': 'viewport', 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 12, 0.95], 'icon-padding': 6 } });
    }
    add({ id: 'lands-label', type: 'symbol', source: 'lands', minzoom: 8, layout: Object.assign(vis(L.lands || L.tribal), { 'text-field': ['get', 'name'], 'text-font': F.ital, 'text-size': 12, 'text-max-width': 9, 'symbol-placement': 'point', 'text-padding': 30 }), paint: { 'text-color': ['match', ['get', 'mgr'], 'TRIB', '#8E5226', o.dark ? '#9FCB8A' : '#36612A'], 'text-halo-color': P.halo, 'text-halo-width': 1.4 } });
    if (vectorBase) {
      add({ id: 'park-label', type: 'symbol', source: 'omt', 'source-layer': 'park', filter: ['==', ['geometry-type'], 'Point'], layout: Object.assign(vis(!L.lands), { 'text-field': nm, 'text-font': F.ital, 'text-size': 12, 'text-max-width': 9 }), paint: { 'text-color': o.dark ? '#9FCB8A' : '#36612A', 'text-halo-color': P.halo, 'text-halo-width': 1.4 } });
    }
    add({ id: 'trail-label', type: 'symbol', source: 'trails', minzoom: 13, filter: ['has', 'name'], layout: { 'text-field': ['get', 'name'], 'text-font': F.reg, 'text-size': 11, 'symbol-placement': 'line', 'symbol-spacing': 320 }, paint: { 'text-color': o.dark ? '#F0B8A8' : '#8A2E1F', 'text-halo-color': P.halo, 'text-halo-width': 1.6 } });
    add({ id: 'crags', type: 'symbol', source: 'crags', minzoom: 9, layout: Object.assign(vis(L.climbing), { 'icon-image': 'bc-crag', 'icon-allow-overlap': false, 'text-field': ['get', 'name'], 'text-font': F.reg, 'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }), paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.3 } });
    add({ id: 'climb-points', type: 'symbol', source: 'points', filter: ['==', ['get', 'kind'], 'climb'], minzoom: 11, layout: Object.assign(vis(L.climbing), { 'icon-image': 'bc-crag', 'icon-size': 0.8, 'text-field': ['get', 'name'], 'text-font': F.reg, 'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }), paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.3 } });
    add({ id: 'trailheads', type: 'symbol', source: 'points', filter: ['==', ['get', 'kind'], 'trailhead'], minzoom: 10, layout: Object.assign(vis(L.trailheads), { 'icon-image': 'bc-trailhead', 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 12, ['get', 'name']], 'text-font': F.bold, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }), paint: { 'text-color': o.dark ? '#E7C45A' : '#6B5410', 'text-halo-color': P.halo, 'text-halo-width': 1.5 } });

    if (roadsOn) {
      const eleText = imperial
        ? ['coalesce', ['get', 'ele_ft'], ['round', ['*', ['to-number', ['get', 'ele'], 0], 3.28084]]]
        : ['get', 'ele'];
      add({ id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', filter: ['match', ['get', 'class'], ['peak', 'volcano'], true, false], minzoom: 9,
        layout: { 'icon-image': 'bc-peak', 'icon-size': 0.9, 'text-field': ['case', ['has', 'ele'], ['format', nm, {}, '\n', {}, ['concat', ['number-format', ['to-number', eleText, 0], { 'max-fraction-digits': 0 }], imperial ? ' ft' : ' m'], { 'font-scale': 0.85 }], nm], 'text-font': F.reg, 'text-size': 11, 'text-offset': [0, 0.8], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': P.peak, 'text-halo-color': P.halo, 'text-halo-width': 1.4 } });
    }
    if (roadsOn) {
      add({ id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'suburb']]], minzoom: 10, layout: { 'text-field': nm, 'text-font': F.reg, 'text-size': 11 }, paint: { 'text-color': P.textSoft, 'text-halo-color': P.halo, 'text-halo-width': 1.3 } });
      add({ id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'town'], minzoom: 7, layout: { 'text-field': nm, 'text-font': F.reg, 'text-size': 13 }, paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.5 } });
      add({ id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'city'], minzoom: 4, layout: { 'text-field': nm, 'text-font': F.bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 17] }, paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.6 } });
    }
    add({ id: 'place-state', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['state', 'province']]], minzoom: 3, maxzoom: 9, layout: Object.assign(vis(L.admin), { 'text-field': nm, 'text-font': F.bold, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.15, 'text-max-width': 8 }), paint: { 'text-color': P.state, 'text-halo-color': P.halo, 'text-halo-width': 1.5 } });
    add({ id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'country'], maxzoom: 7, layout: Object.assign(vis(L.admin), { 'text-field': nm, 'text-font': F.bold, 'text-size': 15, 'text-transform': 'uppercase', 'text-letter-spacing': 0.2 }), paint: { 'text-color': P.country, 'text-halo-color': P.halo, 'text-halo-width': 2 } });

    // Your recorded hike (live while recording, or a saved one being viewed)
    add({ id: 'track-case', type: 'line', source: 'track', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': o.dark ? '#0B1A14' : '#0F3D2E', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8] } });
    add({ id: 'track-line', type: 'line', source: 'track', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#E3B53A', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4.5] } });
    add({ id: 'track-ends', type: 'symbol', source: 'track', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': ['match', ['get', 'role'], 'start', 'bc-track-start', 'bc-track-end'], 'icon-allow-overlap': true } });

    // Your pins and field reports
    add({ id: 'mine', type: 'symbol', source: 'mine', layout: { 'icon-image': ['match', ['get', 'type'], 'pin', 'bc-pin', 'bc-report'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'text-field': ['get', 'name'], 'text-font': F.bold, 'text-size': 11, 'text-offset': [0, 0.3], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.5 } });

    // You are here
    add({ id: 'me-acc', type: 'fill', source: 'me', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['match', ['get', 'mode'], 'gps', P.meFill, P.estimate], 'fill-opacity': ['match', ['get', 'mode'], 'gps', 0.12, 0.16] } });
    add({ id: 'me-acc-line', type: 'line', source: 'me', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'mode'], 'gps']], paint: { 'line-color': P.meFill, 'line-width': 1.5 } });
    add({ id: 'me-acc-line-est', type: 'line', source: 'me', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['!=', ['get', 'mode'], 'gps']], paint: { 'line-color': P.estimate, 'line-width': 2, 'line-dasharray': [2, 2] } });
    add({ id: 'me-heading', type: 'symbol', source: 'me', filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'heading']], layout: { 'icon-image': ['match', ['get', 'mode'], 'gps', 'bc-heading', 'bc-heading-est'], 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    add({ id: 'me-dot', type: 'circle', source: 'me', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'mode'], 'gps', P.meFill, P.estimate], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 } });

    const style = { version: 8, name: 'Bristlecone', glyphs: GLYPHS, sources, layers };
    if (L.terrain3d) style.terrain = { source: 'dem', exaggeration: 1.35 };
    style.sky = { 'sky-color': o.dark ? '#0B1418' : '#BFD6E0', 'horizon-color': o.dark ? '#1B2A2E' : '#EAE6DA', 'fog-color': o.dark ? '#10181A' : '#F2EFE6', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.8 };
    return style;
  }

  window.BcStyle = { build, BASES, OFM, DEM, LAND_COLORS, TRAIL, PALETTE };
})();
