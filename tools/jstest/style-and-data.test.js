// Node checks: style validity for every theme/unit/base/language combo, parsers, sun math, i18n completeness.
const fs = require('fs'), vm = require('vm'), path = require('path');
const W = path.join(__dirname, '../../app/src/main/assets/web/js/');
const spec = require(process.env.STYLE_SPEC || '/home/claude/scratch-npm/node_modules/@maplibre/maplibre-gl-style-spec');
const ctx = { module: undefined, location: { origin: 'https://app.bristlecone.local' }, window: {}, console, Date, Math, URLSearchParams, navigator: { language: 'en-US', onLine: true }, document: { createElement: () => ({ set innerHTML(v) { this.textContent = v.replace(/<[^>]+>/g, ''); } }) } };
ctx.window = ctx; vm.createContext(ctx);
['i18n.js', 'sun.js', 'style.js', 'icons.js', 'data.js', 'reportfilter-model.js', 'reportfilter.js', 'reports.js', 'trailinfo.js', 'regions.js'].forEach(f => vm.runInContext(fs.readFileSync(W + f, 'utf8'), ctx, { filename: f }));
let fails = 0; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// 1. Style validity
const FC = { type: 'FeatureCollection', features: [] };
const data = { trails: FC, points: FC, crags: FC, lands: FC, fire: FC, avy: FC, mine: FC, me: FC, hl: FC };
const layersAll = { hiking: true, ski: true, atv: true, bike: true, horse: true, climbing: true, trailheads: true, hillshade: true, contours: true, terrain3d: true, lands: true, tribal: true, admin: true, fire: true, avalanche: true };
let combos = 0, errs = [];
for (const dark of [false, true]) for (const units of ['imperial', 'metric']) for (const base of Object.keys(ctx.BcStyle.BASES)) for (const lang of Object.keys(ctx.I18N.LANGS)) {
  const st = ctx.BcStyle.build({ dark, units, lang, base, layers: layersAll, data, contourUrl: 'dem-contour://{z}/{x}/{y}?x=1' });
  const e = spec.validateStyleMin(JSON.parse(JSON.stringify(st)));
  combos++;
  if (e.length) errs.push(dark + units + base + lang + ': ' + e.map(x => x.message).join('; '));
}
check(errs.length === 0, 'style valid in ' + combos + ' combinations' + (errs.length ? '\n  ' + errs.slice(0, 5).join('\n  ') : ''));
const ids = ctx.BcStyle.build({ dark: false, units: 'imperial', lang: 'en-US', base: 'bristlecone', layers: layersAll, data, contourUrl: 'x://{z}' }).layers.map(l => l.id);
check(new Set(ids).size === ids.length, 'layer ids unique (' + ids.length + ' layers)');

// 2. Overpass parser
const sample = { elements: [
  { type: 'way', id: 1, tags: { highway: 'path', name: 'Ridge Trail', sac_scale: 'mountain_hiking', trail_visibility: 'good' }, geometry: [{ lat: 44.27, lon: -71.3 }, { lat: 44.28, lon: -71.31 }] },
  { type: 'way', id: 2, tags: { 'piste:type': 'downhill', 'piste:difficulty': 'advanced' }, geometry: [{ lat: 44.2, lon: -71.2 }, { lat: 44.21, lon: -71.2 }] },
  { type: 'way', id: 3, tags: { highway: 'track', atv: 'designated' }, geometry: [{ lat: 44.1, lon: -71.1 }, { lat: 44.11, lon: -71.1 }] },
  { type: 'way', id: 4, tags: { highway: 'path' }, geometry: [{ lat: 44.1, lon: -71.1 }, { lat: 44.12, lon: -71.1 }] },
  { type: 'way', id: 5, tags: { 'piste:type': 'nordic' }, geometry: [{ lat: 44.1, lon: -71.1 }, { lat: 44.12, lon: -71.1 }] },
  { type: 'way', id: 6, tags: { highway: 'track' }, geometry: [{ lat: 44.1, lon: -71.1 }, { lat: 44.12, lon: -71.1 }] },
  { type: 'node', id: 10, lat: 44.3, lon: -71.4, tags: { highway: 'trailhead', name: 'Ammo Lot', 'addr:street': 'Base Station Rd', 'addr:city': 'Bretton Woods', 'addr:state': 'NH' } },
  { type: 'node', id: 11, lat: 44.3, lon: -71.4, tags: { sport: 'climbing', name: 'Cannon Cliff' } },
  { type: 'relation', id: 99, tags: { route: 'hiking', name: 'Appalachian Trail' }, members: [{ type: 'way', ref: 4 }] }
] };
const r = ctx.BcData.parseOverpass(sample);
const kinds = Object.fromEntries(r.trails.map(f => [f.id, f.properties.kind]));
check(kinds[1] === 'hiking' && kinds[2] === 'ski_downhill' && kinds[3] === 'atv' && kinds[5] === 'ski_nordic' && kinds[6] === 'track', 'trail classification ' + JSON.stringify(kinds));
check(r.trails.find(f => f.id === 4).properties.name === 'Appalachian Trail', 'route relation names unnamed way');
const th = r.points.find(p => p.properties.kind === 'trailhead');
check(th && th.properties.addr === 'Base Station Rd, Bretton Woods, NH', 'trailhead address from tags: ' + (th && th.properties.addr));
check(r.points.some(p => p.properties.kind === 'climb'), 'climbing node parsed');

// 3. Esri JSON to GeoJSON (outer clockwise + hole counter-clockwise)
const esri = { features: [{ attributes: { NAME: 'x' }, geometry: { rings: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]] } }] };
const g = ctx.BcData.esriToGeoJson(esri);
check(g.features[0].geometry.coordinates.length === 1 && g.features[0].geometry.coordinates[0].length === 2, 'esri hole attached to outer ring');
check(ctx.BcReports.pointInGeom([1, 1], { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]] }) && !ctx.BcReports.pointInGeom([3, 3], { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]] }), 'point in polygon with hole');

// 4. Tiles and URLs are deterministic (needed for offline)
const u1 = ctx.BcData.overpassUrls(600, 740, 11)[0], u2 = ctx.BcData.overpassUrls(600, 740, 11)[0];
check(u1 === u2 && u1.startsWith('https://overpass-api.de/'), 'overpass cell URL deterministic');
const lu = ctx.BcData.landUrls(55, 90, 8);
check(lu.length >= 4 && lu.every(u => u.includes('f=geojson')), 'land cell URLs: ' + lu.length + ' sources');
const tc = ctx.BcData.tilesFor([-71.5, 44, -71, 44.5], 11).length; check(tc >= 12 && tc <= 25, 'tile cover count ' + tc);

// 5. Sun: Cheyenne on the June solstice, sunrise ~05:3x MDT, sunset ~20:3x MDT
const s = ctx.Sun.times(new Date(Date.UTC(2026, 5, 21, 18)), 41.14, -104.82);
const rH = (s.sunrise.getUTCHours() - 6 + 24) % 24, sH = (s.sunset.getUTCHours() - 6 + 24) % 24;
check(rH === 5 && sH === 20, 'Cheyenne solstice sunrise ' + s.sunrise.toISOString() + ' sunset ' + s.sunset.toISOString());
check(ctx.Sun.isDark(new Date(Date.UTC(2026, 5, 21, 7)), 41.14, -104.82) === true && ctx.Sun.isDark(new Date(Date.UTC(2026, 5, 21, 18)), 41.14, -104.82) === false, 'isDark midnight vs noon MDT');
check(ctx.Sun.times(new Date(Date.UTC(2026, 11, 21, 12)), 71.3, -156.8).polar === 'night', 'Utqiagvik polar night');

// 6. i18n completeness: every key exists in fr and es
const d = ctx.I18N._dicts;
const missingFr = Object.keys(d.en).filter(k => !(k in d.fr)), missingEs = Object.keys(d.en).filter(k => !(k in d.es));
check(!missingFr.length && !missingEs.length, 'fr/es complete' + (missingFr.length || missingEs.length ? ' missing fr:' + missingFr + ' es:' + missingEs : ''));
const allText = JSON.stringify(d);
check(!/[\u2014\u2013]/.test(allText), 'no em or en dashes in strings');
const banned = /\b(adventure|adventures|adventurous|aventure|aventura|explore|explorer|explorar|epic|journey|wanderlust|unleash|discover|découvr|descubr|conquer|off the beaten)\b/i;
check(!banned.test(allText), 'no cliche marketing words' + (banned.test(allText) ? ': ' + allText.match(banned)[0] : ''));
// House rule: app copy says "model" or "machine learning", never artificial intelligence. The company
// name in the credit line is the only place the letters AI appear.
const aiWords = /artificial intelligence|intelligence artificielle|inteligencia artificial|\b(AI|IA)\b|AI-(generated|powered|driven)/i;
const aiText = allText.split('Krummholz AI LLC').join('');
check(!aiWords.test(aiText), 'no artificial intelligence wording in app copy' + (aiWords.test(aiText) ? ': ' + aiText.match(aiWords)[0] : ''));
check(allText.includes('Krummholz AI LLC'), 'credit line names Krummholz AI LLC');

// 7. Country test used to pick imagery and report sources
const cases = [['Cheyenne', -104.82, 41.14, 'us'], ['Banff', -115.57, 51.18, 'ca'], ['Toronto', -79.38, 43.65, 'ca'], ['Buffalo', -78.88, 42.89, 'us'],
  ['Detroit', -83.05, 42.33, 'us'], ['Windsor ON', -83.02, 42.28, 'ca'], ['Montreal', -73.57, 45.5, 'ca'], ['Bangor', -68.77, 44.8, 'us'],
  ['Madawaska ME', -68.32, 47.35, 'us'], ['Edmundston NB', -68.33, 47.37, 'ca'], ['Seattle', -122.33, 47.6, 'us'], ['Vancouver', -123.12, 49.28, 'ca'],
  ['Juneau', -134.42, 58.3, 'us'], ['Whitehorse', -135.05, 60.72, 'ca'], ['Anchorage', -149.9, 61.2, 'us'], ['Duluth', -92.1, 46.78, 'us'],
  ['Thunder Bay', -89.25, 48.38, 'ca'], ['Halifax', -63.57, 44.65, 'ca'], ['Sault Ste Marie MI', -84.35, 46.49, 'us'], ['Prince Rupert', -130.32, 54.31, 'ca']];
const wrong = cases.filter(([n, lon, lat, c]) => ctx.BcData.countryOf(lon, lat) !== c).map(x => x[0]);
check(!wrong.length, 'countryOf on 20 border-area cities' + (wrong.length ? ' wrong: ' + wrong.join(', ') : ''));

// 8. Trail rating: Easy to Expert Only, with reasons
const R = ctx.BcTrail.rate;
const flat = R({ ways: [{ kind: 'hiking', sac: 'hiking' }], lengthM: 2000, gainM: 30, lossM: 30, loop: false, maxGrade: 0.05 });
check(flat.level === 1 && flat.key === 'td.level.easy', 'short flat T1 trail is Easy (' + flat.key + ')');
const precipice = R({ ways: [{ kind: 'hiking', sac: 'demanding_mountain_hiking', ladder: 'yes' }], texts: [{ source: 'National Park Service', text: 'A steep climb using iron rungs and ladders along exposed ledges. Not for those with a fear of heights.' }], lengthM: 1500, gainM: 300, lossM: 20, loop: false, maxGrade: 0.45 });
check(precipice.level === 5 && precipice.reasons.some(r => r.key === 'td.why.text'), 'Precipice-style trail is Expert Only, citing the description');
const longHaul = R({ ways: [{ kind: 'hiking', sac: 'mountain_hiking' }], lengthM: 14 * 1609, gainM: 1500, lossM: 1500, loop: false, maxGrade: 0.2 });
check(longHaul.level === 4 && !longHaul.techKnown === false, 'long big-climb T2 trail is Very Hard from effort, never Expert Only (' + longHaul.key + ')');
const noTags = R({ ways: [{ kind: 'hiking' }], lengthM: 5000, gainM: 200, lossM: 200, loop: true, maxGrade: 0.1 });
check(!noTags.techKnown && noTags.level >= 1 && noTags.level <= 4, 'untagged trail rated on effort only and says so');
const ferrata = R({ ways: [{ kind: 'via_ferrata' }], lengthM: 800, gainM: 150, loop: false, maxGrade: 0.8 });
check(ferrata.level === 5, 'via ferrata is Expert Only');
check(ctx.BcTrail.textLevel('Wide gravel path along the river') === null, 'benign description adds no difficulty');
// 9. Geometry: chaining reversed and shuffled segments, resampling, profile stats
const segA = [[0, 0], [0.001, 0]], segB = [[0.002, 0], [0.001, 0]], segC = [[0.002, 0], [0.003, 0.0005]];
const chained = ctx.BcTrail.chain([segB, segC, segA]);
const ends = [chained[0][0], chained[chained.length - 1][0]].sort().join(',');
check(chained.length === 4 && ends === '0,0.003', 'chain joins shuffled, reversed segments into one path');
const rs = ctx.BcTrail.resample([[0, 0], [0.01, 0]], 50);
check(Math.abs(rs[rs.length - 1][2] - 1113) < 3 && rs.length === 24, 'resample every 50 m along 1.11 km (' + rs.length + ' points)');
const samples = rs.map((p, i) => [p[0], p[1], p[2], 1000 + i * 10]);
const ps = ctx.BcTrail.profileStats(samples);
check(Math.abs(ps.gain - 230) < 25 && ps.loss < 5 && ps.maxGrade > 0.15 && ps.maxGrade < 0.25, 'steady climb: gain ' + Math.round(ps.gain) + ' m, grade ' + ps.maxGrade.toFixed(2));
const hrs = ctx.BcTrail.naismithMs(3 * 1609.344 * 2, 2000 / 3.28084) / 3600000;
check(Math.abs(hrs - 3) < 0.01, 'Naismith: 6 mi with 2,000 ft is 3 h');
// 10. Region search
const m1 = ctx.BcRegions.match('trails in southern utah', 'en-US');
check(m1[0] && m1[0].id === 's-utah', 'region: "trails in southern utah"');
check((ctx.BcRegions.match('Wyoming mountains', 'en-US')[0] || {}).id === 'wy-mtns', 'region: Wyoming mountains');
check((ctx.BcRegions.match('coastal maine', 'en-US')[0] || {}).id === 'me-coast', 'region: coastal Maine');
check((ctx.BcRegions.match('north maine woods', 'en-US')[0] || {}).id === 'nmw', 'region: North Maine Woods');
check((ctx.BcRegions.match('Grand Canyon', 'en-US')[0] || {}).id === 'gcanyon', 'region: Grand Canyon area');
check((ctx.BcRegions.match('sentiers dans la gaspesie', 'fr-CA')[0] || {}).name === 'Gaspésie', 'region in French: Gaspésie');
check((ctx.BcRegions.match('sur de utah', 'es-419')[0] || {}).id === 's-utah', 'region in Spanish: sur de Utah');
check(ctx.BcRegions.match('xq', 'en-US').length === 0, 'short nonsense matches nothing');
const badBox = ctx.BcRegions.REGIONS.filter(r => r.boxes.some(b => !(b[0] < b[2] && b[1] < b[3] && b[0] >= -170 && b[2] <= -50 && b[1] >= 24 && b[3] <= 72)));
check(!badBox.length, 'all ' + ctx.BcRegions.REGIONS.length + ' regions have sane boxes' + (badBox.length ? ': ' + badBox.map(r => r.id) : ''));
// 11. Report filter (model shipped in the app)
const RF = require(W + 'reportfilter.js');
const model = new RF.Model(ctx.BcReportModel.w, ctx.BcReportModel.b);
check(model.score('Trail is icy above treeline this morning, microspikes needed.') > 0.8 && model.score('Huge sale on tents, 30% off with code TRAIL') < 0.2 && model.score('The senator voted against the parks bill.') < 0.2, 'report filter separates reports from ads and politics');
check(ctx.BcReports.socialTags({ target: 'Precipice Trail', label: 'Bar Harbor', stateName: 'Maine' }).join(',') === 'PrecipiceTrail,Precipice,BarHarbor,Maine', 'social hashtags built from place names');
check(ctx.BcIcons && ctx.BcIcons.cleanRef('us-interstate', 'I 80') === '80' && ctx.BcIcons.cleanRef('us-highway', 'US 287') === '287', 'route shield ref cleanup');

// Privacy trimming of shared routes: path distance AND straight-line distance from each end.
ctx.Native = { kvGet: () => null };
{
  // record.js builds its buttons when it loads; a do-nothing element is enough for that.
  const el = () => new Proxy({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} },
    { get: (o, k) => (k in o ? o[k] : (k === 'querySelector' ? () => null : k === 'querySelectorAll' ? () => [] : () => el())) , set: (o, k, v) => { o[k] = v; return true; } });
  ctx.App = { ui: { t: (k) => k, esc: (x) => String(x), $: () => el(), $$: () => [], settings: {} } };
  const doc = ctx.document, make = doc.createElement;
  doc.createElement = () => el();
  const body = doc.body; doc.body = el();
  try { vm.runInContext(fs.readFileSync(W + 'record.js', 'utf8'), ctx, { filename: 'record.js' }); }
  finally { doc.createElement = make; doc.body = body; }
}
const dLat = (m) => m / 111320;
const home = [-68.77, 44.80];
// Starts at home, circles the block (about 300 m of path, never more than 60 m from home), then walks 2 km north and back east.
const route = [];
for (let i = 0; i <= 20; i++) { const a = i / 20 * 2 * Math.PI; route.push([home[0] + Math.cos(a) * dLat(60) / Math.cos(44.8 * Math.PI / 180) - dLat(60) / Math.cos(44.8 * Math.PI / 180), home[1] + Math.sin(a) * dLat(60)]); }
for (let i = 1; i <= 40; i++) route.push([home[0], home[1] + dLat(50 * i)]);
for (let i = 1; i <= 20; i++) route.push([home[0] + dLat(50 * i), home[1] + dLat(2000)]);
const trimmed = ctx.BcRecord.trimEnds(route, 200);
const nearest = Math.min(...trimmed.map(p => ctx.BcData.haversine(p, home)));
check(trimmed.length > 10 && nearest >= 200, 'shared route keeps no point within 200 m of the start, even after a loop near home (nearest ' + Math.round(nearest) + ' m)');
const end = route[route.length - 1];
check(Math.min(...trimmed.map(p => ctx.BcData.haversine(p, end))) >= 200, 'shared route keeps no point within 200 m of the end');
check(ctx.BcRecord.trimEnds(route.slice(0, 21), 200).length === 0, 'a short loop around home shares nothing');

// Mountain weather model
['wxmodel-weights.js', 'wxmodel.js', 'weather.js'].forEach(f => vm.runInContext(fs.readFileSync(W + f, 'utf8'), ctx, { filename: f }));
{
  const X = ctx.BcWx, toF = (c) => c * 9 / 5 + 32, ftm = (f) => f * 0.3048;
  // Millinocket about 350 ft: raining, 40 F, saturated. Baxter Peak 5,267 ft.
  const s = { ref: { z: ftm(350), t: (40 - 32) * 5 / 9, rh: 95, windMs: 4, windDir: 270, gustMs: 7, sky: 100 }, precipChance: 0.9, hour: 13, month: 10, night: false, ageH: 0.5 };
  const top = X.estimate(s, ftm(5267), null), low = X.estimate(s, ftm(350), null);
  check(top.type === 'snow' && toF(top.t) > 20 && toF(top.t) < 30, 'Katahdin: rain at 40 F in Millinocket means snow on the summit (' + toF(top.t).toFixed(0) + ' F)');
  check(low.type === 'rain' && Math.abs(toF(low.t) - 40) < 0.5, 'Katahdin: rain stays rain in town');
  const snowFt = top.snowLevel / 0.3048;
  check(snowFt > 1500 && snowFt < 3500, 'Katahdin: snow level between 1,500 and 3,500 ft (' + Math.round(snowFt) + ' ft)');
  check(top.p10 < top.t && top.t < top.p90 && (top.t - top.p10) > (top.p90 - top.t), 'range brackets the estimate and leans cold');
  check(X.estimate(s, ftm(5267), null).p90 - X.estimate(s, ftm(5267), null).p10 > low.p90 - low.p10, 'range widens with the climb');
  // Wet bulb: 20 C at 50% RH is about 13.7 C (Stull 2011 worked example).
  check(Math.abs(X.wetBulb(20, 50) - 13.7) < 0.2, 'wet-bulb temperature (Stull)');
  // Dry air keeps snow alive above freezing; humid air turns it to rain.
  check(X.pSnow(1.5, 45) > 0.8 && X.pSnow(1.5, 98) < 0.5, 'humidity changes the rain and snow line');
  // Paired stations override the default lapse: an inversion (warmer up high) is detected.
  const inv = X.lapseFor({ rh: 60, precipChance: 0, night: true, windMs: 1, sky: 10, hour: 4, paired: [{ z: 100, t: -8 }, { z: 1200, t: -2 }] });
  check(inv.paired && inv.g > 0, 'paired stations detect an inversion');
  // Terrain: a summit is exposed and speeds the wind; a hollow shelters it.
  const peak = X.terrain([[1400, 1450, 1400], [1450, 1605, 1450], [1400, 1450, 1400]], 300);
  const hollow = X.terrain([[1500, 1450, 1500], [1450, 1300, 1450], [1500, 1450, 1500]], 300);
  const ref = { z: 1300, windMs: 8, windDir: 270, gustMs: 12 };
  check(X.wind(ref, 1605, peak).p50 > X.wind(ref, 1300, hollow).p50 * 1.5 && X.wind(ref, 1605, peak).exposure === 'exposed', 'ridge and summit winds above hollow winds');
  // Report reading
  const r1 = X.readReport('Snowing hard above treeline, 28 degrees at the saddle', 'F');
  check(r1 && r1.type === 'snow' && Math.abs(r1.t - (-2.22)) < 0.1, 'report: snow and 28 F read');
  check(X.readReport('No snow on the trail, rain at the bottom', 'F').type === 'rain', 'report: "no snow" is not snow');
  check(X.readReport('Il neige au sommet, -3 °C', 'C').type === 'snow', 'report: French snow');
  check(X.readReport('Great views, bring water', 'F') === null, 'report: no weather, no evidence');
  // A first-hand report of the type near this elevation beats the formula.
  const rep = X.estimate(Object.assign({}, s, { reports: [{ type: 'rain', t: NaN, z: ftm(5200), w: 0.9 }] }), ftm(5267), null);
  check(rep.type === 'rain' && rep.notes.includes('wx.why.reportType'), 'report of rain on the summit overrides');
  // NWS grid parsing
  const W2 = ctx.BcWeather, t0 = Date.parse('2026-10-18T12:00:00Z');
  const el = { uom: 'wmoUnit:degC', values: [{ validTime: '2026-10-18T09:00:00+00:00/PT3H', value: 1 }, { validTime: '2026-10-18T12:00:00+00:00/PT2H', value: 4.4 }] };
  check(W2.at(el, t0 + 3600000) === 4.4 && W2.span('2026-10-18T00:00:00+00:00/P1DT6H')[1] - W2.span('2026-10-18T00:00:00+00:00/P1DT6H')[0] === 30 * 3600000, 'NWS grid value at a time');
  check(W2.typeOfWords(['rain_showers', 'snow']) === 'mix' && W2.typeOfWords(['freezing_rain']) === 'freezing' && W2.typeOfWords(['fog']) === null, 'NWS weather words to type');
  // Trained trees evaluate as flat node arrays.
  check(X.trees([[[0, 1.5, 1, 2, 0], [-1, 0, 0, 0, -0.4], [-1, 0, 0, 0, 0.6]]], [2]) === 0.6, 'residual trees evaluate');
}

// The whole estimate, end to end, with canned public data: US (NWS + SNOTEL) and Canada (HRDPS + SWOB).
(async () => {
  const W2 = ctx.BcWeather, now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const valid = (v, uom) => ({ uom, values: [{ validTime: iso(now - 7200000).replace('.000Z', '+00:00') + '/PT12H', value: v }] });
  const canned = (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/points/')) return { properties: { forecastGridData: 'https://api.weather.gov/gridpoints/CAR/1,2', observationStations: 'https://api.weather.gov/gridpoints/CAR/1,2/stations' } };
    if (u.pathname.endsWith('/stations') && u.hostname === 'api.weather.gov') return { features: [{ properties: { stationIdentifier: 'KMLT', name: 'Millinocket', elevation: { unitCode: 'wmoUnit:m', value: 123 } }, geometry: { coordinates: [-68.80, 45.82] } }] };
    if (u.pathname.includes('/observations/')) return { properties: { timestamp: iso(now - 1200000), temperature: { unitCode: 'wmoUnit:degC', value: 4.4 }, presentWeather: [{ weather: 'rain' }] } };
    if (u.pathname.startsWith('/gridpoints/')) return { properties: { updateTime: iso(now - 3600000), elevation: { unitCode: 'wmoUnit:m', value: 250 }, temperature: valid(3.5, 'wmoUnit:degC'), relativeHumidity: valid(95), windSpeed: valid(25, 'wmoUnit:km_h-1'), windDirection: valid(270), probabilityOfPrecipitation: valid(90), weather: valid([{ weather: 'rain' }]) } };
    if (u.hostname === 'wcc.sc.egov.usda.gov') return [];
    if (u.hostname === 'geo.weather.gc.ca') { const l = u.searchParams.get('LAYERS'); return { features: [{ properties: { value: { 'HRDPS.CONTINENTAL_TT': 3, 'HRDPS.CONTINENTAL_HR': 94, 'HRDPS.CONTINENTAL_UU': 30, 'HRDPS.CONTINENTAL_WD': 250 }[l] } }] }; }
    if (u.pathname.includes('swob-realtime')) return { features: [{ id: 'a', geometry: { coordinates: [-115.57, 51.17] }, properties: { 'msc_id-value': '3031093', 'stn_nam-value': 'BANFF', 'date_tm-value': iso(now - 1800000), 'air_temp': 4.0, 'air_temp-uom': '°C', 'stn_elev-value': 1397, 'pcpn_amt_pst1hr': 0.6 } }] };
    throw new Error('unexpected ' + url);
  };
  const realData = ctx.BcData.getJson;
  ctx.BcData.getJson = async (url) => ({ json: canned(url), meta: { fetched: now, stale: false } });
  // Terrain: a single 1,600 m summit 2 km east of a 300 m valley floor.
  ctx.BcTrail = { elevations: async (pts) => pts.map(([lon, lat]) => 300 + 1300 * Math.exp(-(((lon - (BASE[0] + 0.025)) * 78000) ** 2 + ((lat - BASE[1]) * 111000) ** 2) / (900 ** 2))) };
  ctx.Sun = { elevation: () => 20 };
  let BASE = [-68.92, 45.90];
  try {
    const us = await W2.compute({ lon: BASE[0], lat: BASE[1] }, { lon: BASE[0], lat: BASE[1] }, { country: 'us', stateCode: 'ME', lang: 'en-US' }, Promise.resolve([]));
    check(us.here && us.here.type === 'rain' && us.summit && us.summit.type === 'snow', 'US end to end: rain in the valley, snow on the summit (' + Math.round(us.summit.z * 3.28) + ' ft)');
    check(us.data.src.includes('nws') && us.data.src.includes('stations') && us.s.bias, 'US end to end: grid, station and station correction used');
    BASE = [-115.57, 51.18];
    ctx.BcTrail.elevations = async (pts) => pts.map(([lon, lat]) => 1400 + 1500 * Math.exp(-(((lon - (BASE[0] + 0.025)) * 70000) ** 2 + ((lat - BASE[1]) * 111000) ** 2) / (900 ** 2)));
    const ca = await W2.compute({ lon: BASE[0], lat: BASE[1] }, { lon: BASE[0], lat: BASE[1] }, { country: 'ca', lang: 'en-CA' }, Promise.resolve([{ src: 'mine', time: now - 3600000, title: 'Snow or ice', body: 'Snowing at the col', coords: [BASE[0] + 0.02, BASE[1]], cat: 'snow' }]));
    check(ca.data.src.includes('hrdps') && ca.data.src.includes('swob') && ca.s.precipChance >= 0.85, 'Canada end to end: HRDPS and SWOB used, station precipitation seen');
    check(ca.summit && ca.summit.type === 'snow' && ca.s.reports.length === 1, 'Canada end to end: snow up high, field report counted');
  } catch (e) { check(false, 'weather end to end threw: ' + e.message); }
    // Coastal Maine in January: snowing at 27 F at the shore. The card says snow reaches the sea.
    BASE = [-68.21, 44.39];
    const coast = (url) => { const j = canned(url); const p = j && j.properties;
      if (p && p.temperature) { p.elevation.value = 5; p.temperature = valid(-2.8, 'wmoUnit:degC'); p.weather = valid([{ weather: 'snow' }]); }
      return j; };
    ctx.BcData.getJson = async (url) => ({ json: coast(url), meta: { fetched: now, stale: false } });
    ctx.BcTrail.elevations = async (pts) => pts.map(([lon, lat]) => 5 + 460 * Math.exp(-(((lon - (BASE[0] + 0.02)) * 79000) ** 2 + ((lat - BASE[1]) * 111000) ** 2) / (900 ** 2)));
    ctx.I18N.lang = 'en-US';
    const el = { innerHTML: '', isConnected: true };
    ctx.App = { ui: { t: ctx.I18N.t, esc: (x) => String(x), settings: {}, imperial: true, fmtEle: (m) => Math.round(m * 3.28084) + ' ft', ageText: () => 'just now' } };
    await W2.render(el, { lon: BASE[0], lat: BASE[1] }, { lon: BASE[0], lat: BASE[1] }, { country: 'us', lang: 'en-US' }, Promise.resolve([]));
    check(el.innerHTML.includes('Snow down to sea level.') && !/Snow level about -?0 ft/.test(el.innerHTML), 'coastal snow reads "Snow down to sea level", not "about 0 ft"');
  ctx.BcData.getJson = realData;
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
