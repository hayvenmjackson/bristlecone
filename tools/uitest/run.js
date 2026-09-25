// Headless UI test: serves the web app, mocks every public data source with synthetic data,
// and captures screenshots in several states. Dev only; not shipped in the APK.
const path = require('path'), fs = require('fs'), http = require('http');
const { mock, C, P, WEB, OUT, chromium } = require('./mocks');

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
  const sec = await pg.evaluate(() => ({ pwned: window.__pwned || 0, closure: document.body.innerText.includes('Road closed at Lake Marie'), jsLink: !!document.querySelector('[data-ext^="javascript"]') }));
  if (sec.pwned || !sec.closure || sec.jsLink) errors.push('SECURITY CHECK FAILED ' + JSON.stringify(sec)); else console.log('security check passed', JSON.stringify(sec));
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

  // ---------------- 1.1 features
  // Shields, unpaved road, relief at a mid zoom
  pg = await page(Object.assign({}, base, { view: { center: [C[0] + 0.05, C[1] - 0.06], zoom: 11.3 } }), 'roads');
  await wait(pg, 4500); await shot(pg, '20-roads-shields');
  await pg.close();

  // Recording flow (browser stand-in for the service)
  pg = await page(base, 'record');
  await wait(pg, 3000);
  await pg.click('#btn-record'); await wait(pg, 500); await shot(pg, '21-record-intro');
  await pg.click('#rec-go'); await wait(pg, 400);
  for (let i = 0; i < 25; i++) {
    await pg.evaluate(([c, i]) => window.bcNative.onLocation(JSON.stringify({ mode: 'gps', lat: c[1] + i * 0.0004, lon: c[0] + 0.012 - i * 0.0005, acc: 5, alt: 3150 + i * 6, time: Date.now() - (25 - i) * 60000, gpsEnabled: true })), [C, i]);
  }
  await wait(pg, 2600); await shot(pg, '22-recording');
  await pg.click('#rec-stop'); await wait(pg, 2500); await shot(pg, '23-hike-saved');
  await pg.click('#h-card'); await wait(pg, 7000);
  const card = await pg.evaluate(() => window.__lastShare);
  if (card && card.b64) { fs.writeFileSync(path.join(OUT, '24-route-card.png'), Buffer.from(card.b64, 'base64')); console.log('route card', card.name, card.mime, card.text); }
  else errors.push('route card not produced');
  await pg.click('[data-tab="places"]'); await wait(pg, 700); await shot(pg, '25-places-hikes');
  await pg.close();

  // Trail details (tap the Medicine Bow Peak trail)
  pg = await page(Object.assign({}, base, { view: { center: [C[0] + 0.004, C[1] + 0.006], zoom: 15.2 } }), 'trail');
  await wait(pg, 4500);
  const tb = await pg.locator('#map').boundingBox();
  await pg.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await wait(pg, 3000); await shot(pg, '26-trail-peek');
  const hasDetails = await pg.locator('[data-act="details"]').count();
  if (hasDetails) {
    await pg.click('[data-act="details"]'); await wait(pg, 5000); await shot(pg, '27-trail-details');
    await pg.evaluate(() => { const b = document.getElementById('sheet-body'); b.scrollTop = b.scrollHeight; }); await wait(pg, 1500); await shot(pg, '28-trail-details-more');
    const txt = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
    console.log('rating shown:', (txt.match(/(Easy|Moderate|Hard|Very Hard|Expert Only)/) || [])[0], '| reasons:', (txt.match(/mentions[^\n]*/) || [''])[0]);
  } else errors.push('trail peek had no details button');
  await pg.close();

  // Region search
  pg = await page(Object.assign({}, base, { view: { center: C, zoom: 9 } }), 'region');
  await wait(pg, 3000);
  await pg.fill('#search', 'Wyoming mountains'); await pg.press('#search', 'Enter'); await wait(pg, 1500); await shot(pg, '29-region-search');
  await pg.click('[data-region="0"]'); await wait(pg, 3500); await shot(pg, '30-region-trails');
  await pg.close();

  // Conditions with social reports (ad and political post must be filtered, script must not run)
  pg = await page(base, 'social');
  await wait(pg, 3000);
  await pg.click('[data-tab="conditions"]'); await wait(pg, 3500); await shot(pg, '31-conditions-social');
  const soc = await pg.evaluate(() => ({ text: document.getElementById('sheet-body').innerText, pwned: window.__pwned || 0 }));
  const okSoc = soc.text.includes('wyohiker') && soc.text.includes('trailrunner') && !soc.text.includes('gearshop') && !soc.text.includes('senator') && !soc.pwned;
  if (!okSoc) errors.push('SOCIAL CHECK FAILED ' + JSON.stringify({ pwned: soc.pwned, hiker: soc.text.includes('wyohiker'), runner: soc.text.includes('trailrunner'), ad: soc.text.includes('gearshop'), pol: soc.text.includes('senator') }));
  else console.log('social check passed: 2 reports kept, ad and political post filtered, no script ran');
  await pg.click('[data-tab="more"]'); await wait(pg, 800);
  await pg.evaluate(() => { const b = document.getElementById('sheet-body'); const h = [...b.querySelectorAll('h3')].find(x => /social/i.test(x.textContent)); if (h) b.scrollTop = h.offsetTop - 20; });
  await wait(pg, 400); await shot(pg, '32-settings-social');
  await pg.close();

  // Satellite hybrid
  pg = await page(Object.assign({}, base, { base: 'satellite', view: { center: C, zoom: 13 } }), 'satellite');
  await wait(pg, 4500); await shot(pg, '33-satellite-hybrid');
  await pg.close();

  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'console.txt'), errors.join('\n'));
  console.log('errors:', errors.length); console.log(errors.slice(0, 30).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
