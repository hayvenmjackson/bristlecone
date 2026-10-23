// Regression tests for integrating learned residuals. These small test fixtures
// are never used as training data or written to the shipped weather weights.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.join(__dirname, '../../app/src/main/assets/web/js');
const context = { Math, console };
context.window = context;
vm.createContext(context);
for (const file of ['wxmodel-weights.js', 'wxmodel.js']) {
  vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context, { filename: file });
}
const shipped = context.BcWxWeights;
const model = context.BcWx;
const constant = value => [[[-1, 0, 0, 0, value]]];
const setResiduals = (low, median, high) => {
  context.BcWxWeights = { ...shipped, support: null, temp: { p10: constant(low), p50: constant(median), p90: constant(high) } };
};
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const input = {
  ref: { z: 500, t: 5, rh: 70, windMs: 5, windDir: 270, gustMs: 8, sky: 60, src: 'nws' },
  precipChance: 0.1, hour: 10, month: 10, night: false, ageH: 0.5, reports: []
};
context.BcWxWeights = { ...shipped, temp: { p10: [], p50: [], p90: [] } };
const baseline = model.estimate(input, 500, null);
const missingSnowLevel = model.estimate({ ...input, snowLevel: null }, 500, null);
near(missingSnowLevel.snowLevel, baseline.snowLevel, 'missing official snow level is not sea level');
const seaLevel = model.estimate({ ...input, snowLevel: 0 }, 500, null);
near(seaLevel.snowLevel, baseline.snowLevel / 2, 'an explicit official sea-level reading is retained');
const noTemperature = model.estimate({ ...input, reports: [{ type: 'snow', t: null, z: 500, w: 0.8 }] }, 500, null);
near(noTemperature.t, baseline.t, 'a report without a temperature cannot become a freezing reading');

setResiduals(1, 2, 3);
const corrected = model.estimate(input, 500, null);
const agreeingReport = model.estimate({ ...input, reports: [{ t: corrected.t, z: 500, w: 1 }] }, 500, null);
near(agreeingReport.t, corrected.t, 'an agreeing temperature report cannot double-count learned correction');
const colderReport = model.estimate({ ...input, reports: [{ t: corrected.t - 2, z: 500, w: 1 }] }, 500, null);
near(colderReport.t, corrected.t - 1, 'a colder report pulls toward its measured temperature');
near(corrected.t, baseline.t + 2, 'median correction is applied once');
near(corrected.p10, baseline.p10 + 1, 'lower residual is measured from the physical core');
near(corrected.p90, baseline.p90 + 3, 'upper residual is measured from the physical core');
assert.ok(corrected.freezingLevel > baseline.freezingLevel, 'a warm correction raises the freezing level');
near(model.estimate(input, corrected.freezingLevel, null).t, 0, 'freezing level and corrected temperature agree');

setResiduals(-3, -2, -1);
const cold = model.estimate(input, 500, null);
near(cold.p10, baseline.p10 - 3, 'negative lower residual does not double-count the median');
near(cold.p90, baseline.p90 - 1, 'negative upper residual does not double-count the median');
assert.ok(cold.freezingLevel < baseline.freezingLevel, 'a cold correction lowers the freezing level');

setResiduals(5, 2, -4);
const crossed = model.estimate(input, 500, null);
assert.ok(crossed.p10 < crossed.t && crossed.t < crossed.p90, 'crossed learned quantiles cannot invert the displayed interval');

context.BcWxWeights = { ...shipped, temp: { p10: [], p50: [], p90: [] } };
const unchanged = model.estimate(input, 500, null);
for (const key of ['t', 'p10', 'p90', 'freezingLevel', 'snowLevel']) near(unchanged[key], baseline[key], `empty weights preserve ${key}`);
context.BcWxWeights = shipped;
assert.ok(Number.isNaN(model.solve(z => z < 100 ? -1 : 1, 0, 0, 200)), 'a pure jump cannot become a reported root');
near(model.solve(z => z < 100 ? z - 25 : -1, 0, 0, 200), 25, 'a genuine root is found even if endpoint signs agree');
console.log('PASS: learned weather residuals, interval ordering, freezing-level consistency and empty-weight fallback');
