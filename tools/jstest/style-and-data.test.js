// Node checks: style validity for every theme/unit/base/language combo, parsers, sun math, i18n completeness.
const fs = require('fs'), vm = require('vm'), path = require('path');
const W = path.join(__dirname, '../../app/src/main/assets/web/js/');
const spec = require(process.env.STYLE_SPEC || '/home/claude/scratch-npm/node_modules/@maplibre/maplibre-gl-style-spec');
const ctx = { window: {}, console, Date, Math, URLSearchParams, navigator: { language: 'en-US', onLine: true }, document: { createElement: () => ({ set innerHTML(v) { this.textContent = v.replace(/<[^>]+>/g, ''); } }) } };
ctx.window = ctx; vm.createContext(ctx);
['i18n.js', 'sun.js', 'style.js', 'data.js', 'reports.js'].forEach(f => vm.runInContext(fs.readFileSync(W + f, 'utf8'), ctx, { filename: f }));
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
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
