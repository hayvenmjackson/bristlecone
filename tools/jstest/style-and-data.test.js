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
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
