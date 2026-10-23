// Smoke tests for bundled weights using real pilot inputs. This test does not fit
// weights or establish accuracy; independent held-out evaluation lives in train.py.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const directory = path.join(__dirname, '../../app/src/main/assets/web/js');
const context = { Math, console };
context.window = context; vm.createContext(context);
for (const file of ['wxmodel-weights.js', 'wxmodel.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
const model = context.BcWx, weights = context.BcWxWeights;
assert.ok(weights.trained && weights.trained.accepted && weights.temp.p50.length > 1, 'real accepted trained weights are bundled');
const observations = fs.readFileSync(path.join(__dirname, '../weather/data/nws-pilot-2026-10-23.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
let active = 0;
for (const row of observations) {
  const terrain = model.terrain(row.terrain, row.spacing);
  const result = model.estimate(row.s, row.z, terrain);
  for (const key of ['t', 'p10', 'p90', 'rh', 'pSnow']) assert.ok(Number.isFinite(result[key]), `${row.station} ${key} is finite`);
  assert.ok(result.p10 < result.t && result.t < result.p90, `${row.station} uncertainty remains ordered`);
  if (result.correctionApplied) active++;
  if (Number.isFinite(result.freezingLevel)) {
    assert.ok(Math.abs(model.estimate(row.s, result.freezingLevel, terrain).t) < 1e-5,
      `${row.station} freezing level must be an actual zero, not a support-boundary jump`);
  }
  if (Number.isFinite(result.snowLevel)) {
    assert.ok(Math.abs(model.estimate(row.s, result.snowLevel, terrain).pSnow - 0.5) < 1e-5,
      `${row.station} snow level must be a genuine probability crossing`);
  }
  const agreement = model.estimate({ ...row.s, reports: [{ t: result.t, z: row.z, w: 1 }] }, row.z, terrain);
  assert.ok(Math.abs(agreement.t - result.t) < 1e-8, `${row.station} agreeing report cannot add the learned residual again`);
  const altered = [
    { s: { ...row.s, ref: { ...row.s.ref, src: 'hrdps' } }, z: row.z, terrain },
    { s: { ...row.s, month: 1 }, z: row.z, terrain },
    { s: { ...row.s, ref: { ...row.s.ref, t: 60 } }, z: row.z, terrain },
    { s: row.s, z: row.s.ref.z + 1500, terrain },
    { s: row.s, z: row.z, terrain: null },
    { s: { ...row.s, bias: { t: 1, w: 0.5 } }, z: row.z, terrain },
    { s: { ...row.s, paired: [{ z: row.z, t: 10 }] }, z: row.z, terrain }
  ];
  for (const test of altered) {
    const fallback = model.estimate(test.s, test.z, test.terrain);
    assert.equal(fallback.correctionApplied, false, 'unsupported inputs use the physical core');
    assert.equal(fallback.temperatureCorrection, 0);
  }
}
assert.equal(active, observations.length, 'training-support examples exercise the real runtime correction');
console.log(`PASS: bundled trained weights on ${active} real observation inputs; ordered intervals and seven fallback conditions per input`);
