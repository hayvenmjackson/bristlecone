// Run the existing physical-model and US/Canada integration cases without the
// unrelated MapLibre style-validator dependency required by the full JS suite.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const W = path.join(__dirname, '../../app/src/main/assets/web/js/');
const ctx = { module: undefined, location: { origin: 'https://app.bristlecone.local' }, window: {}, console, Date, Math, URLSearchParams,
  navigator: { language: 'en-US', onLine: true },
  document: { createElement: () => ({ set innerHTML(value) { this.textContent = value.replace(/<[^>]+>/g, ''); } }) } };
ctx.window = ctx; vm.createContext(ctx);
for (const file of ['i18n.js', 'sun.js', 'style.js', 'icons.js', 'data.js', 'reportfilter-model.js', 'reportfilter.js', 'reports.js', 'trailinfo.js', 'regions.js']) {
  vm.runInContext(fs.readFileSync(W + file, 'utf8'), ctx, { filename: file });
}
const suite = fs.readFileSync(path.join(__dirname, 'style-and-data.test.js'), 'utf8');
const marker = suite.indexOf('// Mountain weather model');
if (marker < 0) throw new Error('Weather integration section missing');
let fails = 0;
const check = (ok, message) => { console.log((ok ? 'PASS ' : 'FAIL ') + message); if (!ok) fails++; };
vm.runInNewContext(suite.slice(marker), { fs, vm, W, ctx, check, console, Date, URL,
  get fails() { return fails; }, process });
