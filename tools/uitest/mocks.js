// Synthetic public data for the headless UI tests (Android and iOS runs). Dev only.
const path = require('path'), fs = require('fs'), http = require('http');
const NM = process.env.NM || '/home/claude/scratch-npm/node_modules/';
const { chromium } = require(NM + 'playwright-core');
const gvt = require(NM + 'geojson-vt'), geojsonvt = gvt.default || gvt, vtpbf = require(NM + 'vt-pbf'), { PNG } = require(NM + 'pngjs');
const WEB = path.join(__dirname, '../../app/src/main/assets/web');
const OUT = process.env.OUT || '/home/claude/shots';
const GLYPHS = process.env.GLYPHS || '/tmp/glyphs';
fs.mkdirSync(OUT, { recursive: true });

const C = [-106.30, 41.35];
const P = (dx, dy) => [C[0] + dx, C[1] + dy];
const circ = (cx, cy, r, n = 40) => { const a = []; for (let i = 0; i <= n; i++) { const t = i / n * 2 * Math.PI; a.push([cx + r * Math.cos(t) * 1.3, cy + r * Math.sin(t)]); } return a; };
const F = (props, geometry) => ({ type: 'Feature', properties: props, geometry });
const fc = (f) => ({ type: 'FeatureCollection', features: f });

// ---------- synthetic OpenMapTiles world
const world = {
  water: fc([F({ class: 'lake' }, { type: 'Polygon', coordinates: [circ(C[0] + 0.02, C[1] - 0.012, 0.007)] })]),
  waterway: fc([F({ class: 'stream', name: 'Lake Creek' }, { type: 'LineString', coordinates: [P(0.02, -0.02), P(0.03, -0.035), P(0.05, -0.05), P(0.07, -0.06)] })]),
  landcover: fc([F({ class: 'wood' }, { type: 'Polygon', coordinates: [[P(-0.2, -0.2), P(0.2, -0.2), P(0.2, 0.2), P(-0.2, 0.2), P(-0.2, -0.2)], circ(C[0] - 0.01, C[1] + 0.015, 0.012)] }),
    F({ class: 'rock' }, { type: 'Polygon', coordinates: [circ(C[0] - 0.01, C[1] + 0.015, 0.006)] })]),
  park: fc([F({ class: 'national_forest', name: 'Medicine Bow National Forest' }, { type: 'Polygon', coordinates: [[P(-0.3, -0.3), P(0.08, -0.3), P(0.08, 0.3), P(-0.3, 0.3), P(-0.3, -0.3)]] }),
    F({ class: 'national_forest', name: 'Medicine Bow National Forest', rank: 1 }, { type: 'Point', coordinates: P(-0.05, -0.04) })]),
  transportation: fc([F({ class: 'secondary' }, { type: 'LineString', coordinates: [P(-0.2, -0.03), P(-0.05, -0.028), P(0.05, -0.02), P(0.2, -0.01)] }),
    F({ class: 'minor' }, { type: 'LineString', coordinates: [P(0.0, -0.025), P(0.005, -0.005), P(0.012, 0.0)] }),
    F({ class: 'track' }, { type: 'LineString', coordinates: [P(0.05, -0.02), P(0.07, 0.01), P(0.09, 0.03)] }),
    F({ class: 'minor', surface: 'unpaved' }, { type: 'LineString', coordinates: [P(0.045, -0.035), P(0.06, -0.05), P(0.08, -0.07)] }),
    F({ class: 'motorway' }, { type: 'LineString', coordinates: [P(-0.3, -0.12), P(0, -0.11), P(0.3, -0.1)] }),
    F({ class: 'primary' }, { type: 'LineString', coordinates: [P(0.12, -0.3), P(0.11, 0), P(0.1, 0.3)] })]),
  transportation_name: fc([F({ class: 'secondary', name: 'Snowy Range Road', ref: '130', network: 'us-state', ref_length: 3 }, { type: 'LineString', coordinates: [P(-0.2, -0.03), P(-0.05, -0.028), P(0.05, -0.02), P(0.2, -0.01)] }),
    F({ class: 'motorway', name: 'Interstate 80', ref: '80', network: 'us-interstate', ref_length: 2 }, { type: 'LineString', coordinates: [P(-0.3, -0.12), P(0, -0.11), P(0.3, -0.1)] }),
    F({ class: 'primary', name: 'US 287', ref: '287', network: 'us-highway', ref_length: 3 }, { type: 'LineString', coordinates: [P(0.12, -0.3), P(0.11, 0), P(0.1, 0.3)] })]),
  boundary: fc([F({ admin_level: 4, maritime: 0 }, { type: 'LineString', coordinates: [P(0.06, -0.3), P(0.06, 0.3)] })]),
  place: fc([F({ class: 'village', name: 'Centennial' }, { type: 'Point', coordinates: P(0.045, -0.035) })]),
  mountain_peak: fc([F({ class: 'peak', name: 'Medicine Bow Peak', ele: 3662, ele_ft: 12014 }, { type: 'Point', coordinates: P(-0.01, 0.015) })])
};
const idx = Object.fromEntries(Object.entries(world).map(([k, v]) => [k, geojsonvt(v, { maxZoom: 14, indexMaxZoom: 4, extent: 4096, buffer: 64 })]));
function vectorTile(z, x, y) {
  const layers = {};
  for (const [k, ix] of Object.entries(idx)) { const t = ix.getTile(z, x, y); if (t) layers[k] = t; }
  if (!Object.keys(layers).length) return null;
  return Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 }));
}
// ---------- synthetic terrain (terrarium)
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
function elev(lon, lat) {
  const g = (cx, cy, h, s) => h * Math.exp(-(((lon - cx) * 0.75) ** 2 + (lat - cy) ** 2) / (2 * s * s));
  return 2700 + g(C[0] - 0.01, C[1] + 0.015, 950, 0.02) + g(C[0] - 0.06, C[1] + 0.05, 600, 0.03) + g(C[0] + 0.05, C[1] + 0.04, 400, 0.025) + 150 * Math.sin(lon * 90) * Math.cos(lat * 70);
}
function fakePhoto(seedStr) {
  const png = new PNG({ width: 256, height: 256 });
  let h = 0; for (const c of seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const o = (j * 256 + i) * 4, n = Math.sin((i + h % 97) / 17) * Math.cos((j + h % 53) / 23);
    png.data[o] = 70 + 40 * n + (j < 90 ? 60 : 0); png.data[o + 1] = 95 + 45 * n + (j < 90 ? 70 : 0); png.data[o + 2] = 60 + 25 * n + (j < 90 ? 110 : 0); png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}
function demTile(z, x, y) {
  const png = new PNG({ width: 256, height: 256 });
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = elev(x2lon(x + i / 256, z), y2lat(y + j / 256, z)) + 32768;
    const o = (j * 256 + i) * 4;
    png.data[o] = Math.floor(v / 256); png.data[o + 1] = Math.floor(v % 256); png.data[o + 2] = Math.floor((v % 1) * 256); png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}
// ---------- synthetic public data
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });
const overpass = { elements: [
  way(1, { highway: 'path', name: 'Lakes Trail', sac_scale: 'hiking', surface: 'dirt', trail_visibility: 'good', check_date: '2026-07-12' }, [P(0.012, 0.0), P(0.018, 0.004), P(0.025, -0.002), P(0.03, -0.012), P(0.024, -0.022), P(0.014, -0.02), P(0.012, -0.01), P(0.012, 0.0)]),
  way(2, { highway: 'path', name: 'Medicine Bow Peak Trail', sac_scale: 'demanding_mountain_hiking' }, [P(0.012, 0.0), P(0.004, 0.006), P(-0.004, 0.01), P(-0.01, 0.015)]),
  way(3, { highway: 'path', sac_scale: 'alpine_hiking' }, [P(-0.01, 0.015), P(-0.02, 0.02), P(-0.035, 0.03)]),
  way(4, { 'piste:type': 'downhill', 'piste:difficulty': 'intermediate', name: 'Upper Cirque' }, [P(-0.06, 0.04), P(-0.055, 0.025), P(-0.05, 0.01)]),
  way(5, { 'piste:type': 'downhill', 'piste:difficulty': 'advanced', name: 'Headwall' }, [P(-0.065, 0.04), P(-0.068, 0.02), P(-0.062, 0.008)]),
  way(6, { 'piste:type': 'nordic', name: 'Meadow Loop' }, [P(0.03, 0.02), P(0.045, 0.028), P(0.05, 0.04), P(0.035, 0.045), P(0.03, 0.02)]),
  way(7, { highway: 'track', atv: 'designated', name: 'FR 317' }, [P(0.05, -0.02), P(0.07, 0.01), P(0.09, 0.03)]),
  way(8, { highway: 'path', bicycle: 'designated', 'mtb:scale': '2', name: 'Barber Lake Flow' }, [P(-0.03, -0.028), P(-0.035, -0.015), P(-0.03, -0.005)]),
  { type: 'node', id: 20, lat: C[1] + 0.0, lon: C[0] + 0.012, tags: { highway: 'trailhead', name: 'Lake Marie Trailhead', parking: 'surface', fee: 'no' } },
  { type: 'node', id: 21, lat: C[1] - 0.028, lon: C[0] - 0.03, tags: { highway: 'trailhead', name: 'Barber Lake Trailhead' } },
  { type: 'node', id: 22, lat: C[1] + 0.02, lon: C[0] - 0.02, tags: { sport: 'climbing', name: 'Diamond Buttress', 'climbing:grade:yds_class': '5.9' } },
  { type: 'relation', id: 90, tags: { route: 'hiking', name: 'Snowy Range Scenic Byway Trails' }, members: [{ type: 'way', ref: 3 }] }
] };
const padus = fc([F({ Unit_Nm: 'Medicine Bow National Forest', Mang_Name: 'USFS', Mang_Type: 'FED', Des_Tp: 'NF', Pub_Access: 'OA' }, { type: 'Polygon', coordinates: [[P(-0.3, -0.3), P(0.08, -0.3), P(0.08, 0.3), P(-0.3, 0.3), P(-0.3, -0.3)]] }),
  F({ Unit_Nm: 'Snowy Range State Wildlife Area', Mang_Name: 'SDNR', Mang_Type: 'STAT', Des_Tp: 'SW', Pub_Access: 'OA' }, { type: 'Polygon', coordinates: [[P(0.085, -0.1), P(0.2, -0.1), P(0.2, 0.0), P(0.085, 0.0), P(0.085, -0.1)]] })]);
const tribal = fc([F({ NAME: 'Example Reservation' }, { type: 'Polygon', coordinates: [[P(0.1, 0.02), P(0.25, 0.02), P(0.25, 0.15), P(0.1, 0.15), P(0.1, 0.02)]] })]);
const fire = fc([F({ poly_IncidentName: 'Libby Flats', poly_GISAcres: 1840.4, attr_PercentContained: 35, poly_DateCurrent: Date.now() - 5 * 3600000 }, { type: 'Polygon', coordinates: [circ(C[0] - 0.12, C[1] + 0.08, 0.02)] })]);
const nws = { type: 'FeatureCollection', features: [
  { properties: { headline: 'Red Flag Warning issued for Snowy Range', event: 'Red Flag Warning', description: 'Gusty winds and low humidity will create critical fire weather conditions.', sent: ago(1.5), ends: new Date(Date.now() + 10 * 3600000).toISOString(), severity: 'Severe', '@id': 'https://api.weather.gov/alerts/x' } },
  { properties: { headline: 'Winter Weather Advisory', event: 'Winter Weather Advisory', description: 'Snow above 10,000 feet.', sent: ago(80), severity: 'Moderate' } }] };
const notes = { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: P(0.02, 0.0) }, properties: { id: 123, status: 'open', date_created: '2026-09-14 16:00:00 UTC', comments: [{ date: '2026-09-14 16:00:00 UTC', text: 'Bridge over Lake Creek washed out, ford required at high water.' }] } }] };
const reverse = { name: 'Snowy Range Road', address: { road: 'Snowy Range Road', village: 'Centennial', state: 'Wyoming', postcode: '82055', country_code: 'us', 'ISO3166-2-lvl4': 'US-WY' }, lat: String(C[1] - 0.026), lon: String(C[0] + 0.01) };

function mock(url, method, body) {
  const u = new URL(url);
  const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.hostname === 'tiles.openfreemap.org') {
    if (u.pathname === '/planet') return json({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/20260915_001001_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 });
    const fm = decodeURIComponent(u.pathname).match(/^\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/);
    if (fm) { const stack = fm[1].split(',')[0]; const f = path.join(GLYPHS, stack, fm[2] + '.pbf'); return fs.existsSync(f) ? { status: 200, contentType: 'application/x-protobuf', body: fs.readFileSync(f) } : { status: 404, body: '' }; }
    const m = u.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) { const b = vectorTile(+m[1], +m[2], +m[3]); return b ? { status: 200, contentType: 'application/x-protobuf', body: b } : { status: 204, body: '' }; }
  }
  if (u.hostname === 's3.amazonaws.com') { const m = u.pathname.match(/(\d+)\/(\d+)\/(\d+)\.png$/); return { status: 200, contentType: 'image/png', body: demTile(+m[1], +m[2], +m[3]) }; }
  if (u.hostname.includes('overpass')) {
    const q = decodeURIComponent(u.search);
    if (q.includes('amenity')) return json({ elements: [{ type: 'way', id: 501, center: { lat: C[1] - 0.001, lon: C[0] + 0.013 }, tags: { amenity: 'parking', name: 'Lake Marie Lot', capacity: '40', fee: 'no', surface: 'paved' } }] });
    if (q.includes('out tags center')) return json({ elements: [
      { type: 'relation', id: 90, center: { lat: C[1] + 0.01, lon: C[0] - 0.01 }, tags: { name: 'Medicine Bow Peak Trail', route: 'hiking', wikidata: 'Q123', network: 'rwn' } },
      { type: 'relation', id: 91, center: { lat: 43.75, lon: -110.8 }, tags: { name: 'Cascade Canyon Trail', route: 'hiking', network: 'rwn' } },
      { type: 'way', id: 92, center: { lat: 43.0, lon: -109.6 }, tags: { name: 'Titcomb Basin Trail', highway: 'path', sac_scale: 'mountain_hiking' } }] });
    return json(overpass);
  }
  if (u.hostname === 'mastodon.social') return json([
    { url: 'https://mastodon.social/@a/1', created_at: ago(20), account: { acct: 'wyohiker' }, content: '<p>Snowy Range update: Medicine Bow Peak trail still has snow above the lake this morning, spikes helpful on the ridge. <img src=x onerror="window.__pwned=3"></p>' },
    { url: 'https://mastodon.social/@b/2', created_at: ago(30), account: { acct: 'gearshop' }, content: '<p>Snowy Range sale! 30% off all tents this weekend with code SNOWY</p>' },
    { url: 'https://mastodon.social/@c/3', created_at: ago(40), account: { acct: 'news' }, content: '<p>Wyoming senator votes on public lands bill near the Snowy Range</p>' }]);
  if (u.hostname === 'noagendasocial.com') return json([{ url: 'https://noagendasocial.com/@d/4', created_at: ago(50), account: { acct: 'trailrunner' }, content: '<p>Ran the Lakes Trail near Centennial today, blowdown across the trail at mile 2 and mud at the lower crossing.</p>' }]);
  if (u.hostname === 'gab.com') return { status: 403, contentType: 'text/plain', body: 'forbidden' };
  if (u.hostname === 'en.wikipedia.org' && u.pathname.includes('/api.php')) return json({ query: { geosearch: [{ title: 'Medicine Bow Peak', lat: C[1], lon: C[0] }] } });
  if (u.hostname === 'www.wikidata.org') return json({ entities: { Q123: { sitelinks: { enwiki: { site: 'enwiki', title: 'Medicine Bow Peak' } } } } });
  if (u.hostname === 'en.wikipedia.org' && u.pathname.includes('/summary/')) return json({ title: 'Medicine Bow Peak', extract: 'Medicine Bow Peak is the highest point in the Snowy Range of southern Wyoming, reached by a trail from Lake Marie. The final ridge is rocky and exposed to wind.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Medicine_Bow_Peak' } } });
  if (u.hostname === 'commons.wikimedia.org') return json({ query: { pages: { 1: { title: 'File:Lake Marie and Medicine Bow Peak.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/lake.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lake_Marie.jpg', mime: 'image/jpeg', extmetadata: { Artist: { value: '<a href="x">J. Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    2: { title: 'File:Snowy Range ridge.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/ridge.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ridge.jpg', mime: 'image/jpeg', extmetadata: { Artist: { value: 'A. Hiker' }, LicenseShortName: { value: 'CC BY 4.0' } } }] } } } });
  if (u.hostname === 'upload.wikimedia.org' || u.hostname === 'tiles.maps.eox.at' || (u.hostname === 'basemap.nationalmap.gov' && u.pathname.includes('Imagery'))) return { status: 200, contentType: 'image/png', body: fakePhoto(u.pathname) };
  if (u.hostname === 'services.arcgis.com') return json(padus);
  if (u.hostname === 'tigerweb.geo.census.gov') return json(u.pathname.includes('/2/') ? tribal : fc([]));
  if (u.hostname === 'services3.arcgis.com') return json(fire);
  if (u.hostname === 'api.weather.gov') return json(nws);
  if (u.hostname === 'api.openstreetmap.org') return json(notes);
  if (u.hostname === 'nominatim.openstreetmap.org') return json(u.pathname.includes('search') ? [{ name: 'Lake Marie', display_name: 'Lake Marie, Albany County, Wyoming, United States', lat: String(C[1] - 0.012), lon: String(C[0] + 0.02), boundingbox: [String(C[1] - 0.02), String(C[1]), String(C[0]), String(C[0] + 0.04)] }] : reverse);
  if (u.hostname === 'developer.nps.gov') {
    if (u.pathname.endsWith('/thingstodo')) return json({ data: [{ title: 'Hike Medicine Bow Peak Trail', shortDescription: 'A steep climb to the summit ridge.', longDescription: '<p>This steep route climbs to the summit ridge. Near the top, iron rungs help on a short exposed ledge. Not for those with a fear of heights.</p>', duration: '3-4 Hours', url: 'https://www.nps.gov/thingstodo/x.htm', images: [] }] });
    if (u.pathname.endsWith('/parkinglots')) return json({ data: [{ name: 'Mirror Lake Picnic Parking', description: 'Paved lot, fills by 9 am on summer weekends.', latitude: String(C[1] - 0.002), longitude: String(C[0] + 0.011), fees: [] }] });
    if (u.pathname.endsWith('/parks')) return json({ data: [{ parkCode: 'test', fullName: 'Test National Park', latitude: String(C[1]), longitude: String(C[0]) }] });
    // Hostile alert: markup that would run script if parsed unsafely, and a javascript: link.
    return json({ data: [{ title: 'Road closed at Lake Marie', description: '<p>Closed for repairs.</p><img src=x onerror="window.__pwned=1">', parkCode: 'test', lastIndexedDate: ago(3), category: 'Park Closure', url: 'javascript:window.__pwned=2' }] });
  }
  if (u.hostname === 'api.avalanche.org') return json(fc([]));
  if (u.hostname === 'api.openbeta.io') return json({ data: { cragsNear: [{ count: 1, crags: [{ areaName: 'Snowy Range Crags', uuid: 'abc', totalClimbs: 42, metadata: { lat: C[1] + 0.03, lng: C[0] - 0.04 } }] }] } });
  if (u.hostname.includes('opentopomap') || u.hostname.includes('nationalmap') || u.hostname.includes('geo.ca')) return { status: 404, body: '' };
  return json(fc([]));
}


module.exports = { mock, C, P, WEB, OUT, NM, chromium };
