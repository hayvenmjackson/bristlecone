// Validation uses the same exported weights, support gate and evaluator as the app.
// JSON on stdin: { weights, rows: [{ x, source, terrain }] }; JSON predictions on stdout.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const context = { Math, console, BcWxWeights: input.weights };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/web/js/wxmodel.js'), 'utf8'), context);
process.stdout.write(JSON.stringify(input.rows.map(row => context.BcWx.residuals(
  { ref: { src: row.source, t: row.ref_t, z: row.ref_z }, paired: [], reports: [] }, row.x, row.terrain ? {} : null))));
