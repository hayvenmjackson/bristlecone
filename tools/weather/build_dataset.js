// Turns matched observations into training rows for the learned correction.
//
// Input (JSON lines, one per observation), the same shape the app builds on the phone:
//   { "station": "367:WY:SNTL", "observed": -3.1, "z": 3121,
//     "s": { "ref": {...}, "paired": [...], "precipChance": 0.8, "hour": 14, "month": 10, "night": false, ... },
//     "terrain": [[...5x5 elevations...]], "spacing": 150,
//     "type": "snow" }                       optional: observed precipitation type
//
// Output (CSV): station, every feature in wxmodel-weights.js, core, observed, residual
// (observed minus core), est_t and est_rh (the full estimate's temperature and humidity at
// the station, for the rain/snow fit), type. train.py reads this.
//
// Usage: node tools/weather/build_dataset.js observations.jsonl > rows.csv
// The feature definitions live only in wxmodel.js, so training and the phone always agree.
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, '../../app/src/main/assets/web/js/');
const ctx = { Math, console };
ctx.window = ctx; vm.createContext(ctx);
['wxmodel-weights.js', 'wxmodel.js'].forEach(f => vm.runInContext(fs.readFileSync(JS + f, 'utf8'), ctx, { filename: f }));
// Train against the physical core alone, never against a previous correction.
ctx.BcWxWeights.temp = { p10: [], p50: [], p90: [] };

const file = process.argv[2];
if (!file) { console.error('usage: node build_dataset.js observations.jsonl'); process.exit(2); }
const names = ctx.BcWxWeights.features;
const out = ['station,' + names.join(',') + ',core,observed,residual,est_t,est_rh,type'];
let n = 0, bad = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    const o = JSON.parse(line);
    const ter = o.terrain ? ctx.BcWx.terrain(o.terrain, o.spacing || 150) : null;
    const e = ctx.BcWx.explain(o.s, o.z, ter);
    const est = ctx.BcWx.estimate(o.s, o.z, ter);
    const residual = o.observed - e.core;
    if (!isFinite(residual) || Math.abs(residual) > 25) { bad++; continue; }
    out.push([JSON.stringify(String(o.station || ''))].concat(e.x.map(v => +v.toFixed(5)), [e.core, o.observed, residual, est.t, est.rh].map(v => +v.toFixed(3)), [o.type || '']).join(','));
    n++;
  } catch (err) { bad++; }
}
process.stdout.write(out.join('\n') + '\n');
console.error(n + ' rows, ' + bad + ' skipped');
