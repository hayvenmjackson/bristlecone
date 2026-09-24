// Headless UI test: serves the web app, mocks every public data source with synthetic data,
// and captures screenshots in several states. Dev only; not shipped in the APK.
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
    F({ class: 'track' }, { type: 'LineString', coordinates: [P(0.05, -0.02), P(0.07, 0.01), P(0.09, 0.03)] })]),
  transportation_name: fc([F({ class: 'secondary', name: 'Snowy Range Road', ref: 'WY 130' }, { type: 'LineString', coordinates: [P(-0.2, -0.03), P(-0.05, -0.028), P(0.05, -0.02), P(0.2, -0.01)] })]),
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
  if (u.hostname.includes('overpass')) return json(overpass);
  if (u.hostname === 'services.arcgis.com') return json(padus);
  if (u.hostname === 'tigerweb.geo.census.gov') return json(u.pathname.includes('/2/') ? tribal : fc([]));
  if (u.hostname === 'services3.arcgis.com') return json(fire);
  if (u.hostname === 'api.weather.gov') return json(nws);
  if (u.hostname === 'api.openstreetmap.org') return json(notes);
  if (u.hostname === 'nominatim.openstreetmap.org') return json(u.pathname.includes('search') ? [{ name: 'Lake Marie', display_name: 'Lake Marie, Albany County, Wyoming, United States', lat: String(C[1] - 0.012), lon: String(C[0] + 0.02), boundingbox: [String(C[1] - 0.02), String(C[1]), String(C[0]), String(C[0] + 0.04)] }] : reverse);
  if (u.hostname === 'developer.nps.gov') return json({ data: [] });
  if (u.hostname === 'api.avalanche.org') return json(fc([]));
  if (u.hostname === 'api.openbeta.io') return json({ data: { cragsNear: [{ count: 1, crags: [{ areaName: 'Snowy Range Crags', uuid: 'abc', totalClimbs: 42, metadata: { lat: C[1] + 0.03, lng: C[0] - 0.04 } }] }] } });
  if (u.hostname.includes('opentopomap') || u.hostname.includes('nationalmap') || u.hostname.includes('geo.ca')) return { status: 404, body: '' };
  return json(fc([]));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8765, r));
  const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium')).map(d => path.join('/opt/pw-browsers', d, 'chrome-linux/chrome')).find(fs.existsSync);
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  async function page(settings, label) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, deviceScaleFactor: 1.5, locale: 'en-US', timezoneId: 'America/Denver' });
    await ctx.addInitScript((s) => { localStorage.setItem('bc_settings', JSON.stringify(s)); }, settings);
    await ctx.route(/^https?:\/\/(?!localhost)/, async (route) => {
      const r = route.request();
      const m = mock(r.url(), r.method(), r.postData());
      await route.fulfill({ status: m.status, contentType: m.contentType, body: m.body, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const pg = await ctx.newPage();
    pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(label + ': ' + m.text()); });
    pg.on('pageerror', e => errors.push(label + ' PAGEERROR: ' + e.message));
    await pg.goto('http://localhost:8765/index.html');
    await pg.waitForTimeout(3500);
    return pg;
  }
  const base = { lang: 'en-US', units: 'imperial', appearance: 'light', base: 'bristlecone', view: { center: C, zoom: 13.2 }, layers: { hiking: true, ski: true, atv: true, bike: true, horse: true, climbing: true, trailheads: true, hillshade: true, contours: true, terrain3d: false, lands: true, tribal: true, admin: true, fire: true, avalanche: false } };
  const shot = (pg, n) => pg.screenshot({ path: path.join(OUT, n + '.png') });
  const wait = (pg, ms) => pg.waitForTimeout(ms);

  // 1. Light map, GPS fix
  let pg = await page(base, 'light');
  await wait(pg, 3000);
  await pg.evaluate((c) => window.bcNative.onLocation(JSON.stringify({ mode: 'gps', lat: c[1] - 0.004, lon: c[0] + 0.014, acc: 6, heading: 40, gpsEnabled: true })), C);
  await wait(pg, 2500);
  await shot(pg, '01-map-light-gps');
  // 2. Estimate mode
  await pg.evaluate((c) => window.bcNative.onLocation(JSON.stringify({ mode: 'estimate', lat: c[1] + 0.002, lon: c[0] + 0.006, acc: 220, heading: 300, walked: 850, gpsEnabled: true })), C);
  await wait(pg, 1500);
  await shot(pg, '02-map-estimate');
  await pg.click('#loc-chip'); await wait(pg, 600); await shot(pg, '03-estimate-details');
  await pg.click('[data-close]'); await wait(pg, 300);
  // 3. Tap the trailhead
  const pt = await pg.evaluate((c) => { const p = window.App && document.querySelector('#map') && null; return null; }, C);
  await pg.evaluate(() => window.bcNative.onLocation(JSON.stringify({ mode: 'gps', lat: 41.346, lon: -106.286, acc: 5, gpsEnabled: true })));
  await wait(pg, 1200);
  // 4. Layers
  await pg.click('#btn-layers'); await wait(pg, 600); await shot(pg, '04-layers');
  await pg.click('[data-close]'); await wait(pg, 300);
  // 5. Conditions
  await pg.click('[data-tab="conditions"]'); await wait(pg, 2500); await shot(pg, '05-conditions');
  // 6. Offline
  await pg.click('[data-tab="offline"]'); await wait(pg, 1200); await shot(pg, '06-offline');
  // 7. Places editor via long press equivalent
  await pg.click('[data-tab="places"]'); await wait(pg, 500); await shot(pg, '07-places');
  await pg.click('[data-tab="more"]'); await wait(pg, 600); await shot(pg, '08-settings');
  // 8. Trailhead card: click on the rendered symbol
  await pg.click('[data-tab="map"]'); await wait(pg, 400);
  const scr = await pg.evaluate((c) => { const m = document.querySelector('#map'); return null; });
  await pg.evaluate(() => { });
  await pg.close();

  // Dark, French, metric, 3D
  pg = await page(Object.assign({}, base, { appearance: 'dark', lang: 'fr-CA', units: 'metric', layers: Object.assign({}, base.layers, { terrain3d: false }) }), 'dark-fr');
  await wait(pg, 3500);
  await pg.evaluate((c) => window.bcNative.onLocation(JSON.stringify({ mode: 'network', lat: c[1] + 0.003, lon: c[0] + 0.01, acc: 480, gpsEnabled: false })), C);
  await wait(pg, 2000);
  await shot(pg, '09-map-dark-fr-network');
  await pg.click('[data-tab="conditions"]'); await wait(pg, 2500); await shot(pg, '10-conditions-fr-dark');
  await pg.close();

  // Spanish, trailhead card
  pg = await page(Object.assign({}, base, { lang: 'es-419', view: { center: [C[0] + 0.012, C[1]], zoom: 15 } }), 'es');
  await wait(pg, 4000);
  const box = await pg.locator('#map').boundingBox();
  // Click near the map center, where the Lake Marie trailhead is.
  await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await wait(pg, 2000);
  await shot(pg, '11-trailhead-es');
  await pg.close();

  // Imagery base with overlays (raster missing in mock, so overlays on background)
  pg = await page(Object.assign({}, base, { appearance: 'auto', view: { center: C, zoom: 11.5 } }), 'auto');
  await wait(pg, 4000);
  await shot(pg, '12-map-auto-z11');
  await pg.close();

  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'console.txt'), errors.join('\n'));
  console.log('errors:', errors.length); console.log(errors.slice(0, 30).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
