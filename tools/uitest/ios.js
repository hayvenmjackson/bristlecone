// Headless run of the shared UI as the iOS app sees it: the WKWebView bridge (a message handler
// that answers with Promises), settings handed over at startup, and every remote request going
// through the app's proxy path. Dev only; not shipped.
const path = require('path'), fs = require('fs'), http = require('http');
const { mock, C, WEB, OUT, chromium } = require('./mocks');
const PORT = 8766;

const proxied = [], direct = [];
const server = http.createServer((req, res) => {
  const raw = req.url;
  if (raw.startsWith('/proxy/')) {
    const rest = raw.slice('/proxy/'.length);
    proxied.push(rest);
    if (rest.startsWith('app.bristlecone.local/')) {
      const f = path.join(WEB, decodeURIComponent(rest.slice('app.bristlecone.local'.length).split('?')[0]));
      if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
      return fs.createReadStream(f).pipe(res);
    }
    const m = mock('https://' + rest, req.method);
    res.writeHead(m.status, { 'Content-Type': m.contentType || 'text/plain', 'Access-Control-Allow-Origin': '*', 'X-Bc-Fetched': String(Date.now()), 'X-Bc-Stale': '0' });
    return res.end(m.body);
  }
  let p = decodeURIComponent(raw.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

/** Runs in the page: a stand-in for WebViewController's message handler. */
function fakeIos({ settings, idiom, proxy, C }) {
  const calls = [];
  const kv = { settings: JSON.stringify(settings) };
  const tracks = {};
  let rec = null;
  window.__iosCalls = calls;
  window.BC_INFO = { platform: 'ios', idiom, locale: 'en-US', version: '1.2.0', health: true, healthGranted: false, openedFor: null, barometer: true, stepDetector: true, locationPermission: true, online: true, strideSamples: 0 };
  window.BC_KV = kv;
  window.BC_PROXY = proxy;
  const later = (v) => new Promise(r => setTimeout(() => r(v), 5));
  const handlers = {
    listRegions: () => JSON.stringify([{ id: 'r1', name: 'Snowy Range', bbox: [C[0] - 0.1, C[1] - 0.1, C[0] + 0.1, C[1] + 0.1], created: Date.now() - 86400000, state: 'ready', done: 10, total: 10, bytes: 2400000 }]),
    storageStats: () => JSON.stringify({ cacheBytes: 52000000, dataBytes: 12000, freeBytes: 9000000000 }),
    downloadRegion: () => 'ok',
    trackStart: () => {
      rec = { id: 't' + Date.now(), pts: [] };
      for (let i = 0; i < 25; i++) rec.pts.push([C[0] + 0.012 - i * 0.0005, C[1] + i * 0.0004, Date.now() - (25 - i) * 60000, 3150 + i * 6]);
      setTimeout(() => window.bcNative.onRecording(JSON.stringify({ started: true })), 20);
    },
    trackStatus: () => JSON.stringify(rec ? { recording: true, id: rec.id, paused: false, distance: 1460, gain: 144, movingMs: 1440000, elapsedMs: 1500000, points: rec.pts.length, steps: 2100 } : { recording: false }),
    trackStop: () => {
      if (!rec) return '';
      const id = rec.id;
      tracks[id] = { meta: { id, name: null, start: rec.pts[0][2], end: rec.pts[rec.pts.length - 1][2], distance: 1460, gain: 144, loss: 0, barometer: true, movingMs: 1440000, elapsedMs: 1500000, points: 25, steps: 2100, healthSynced: false }, pts: rec.pts };
      rec = null;
      return id;
    },
    trackMeta: (id) => JSON.stringify(tracks[id] ? tracks[id].meta : null),
    trackPoints: (id) => JSON.stringify(rec && rec.id === id ? rec.pts : tracks[id] ? tracks[id].pts : []),
    trackList: () => JSON.stringify(Object.values(tracks).map(t => t.meta)),
    trackUpdate: (json) => { const u = JSON.parse(json); if (!tracks[u.id]) return false; Object.assign(tracks[u.id].meta, u); return true; },
    shareFile: (b64, name, mime, text) => { window.__lastShare = { b64, name, mime, text }; return true; },
    healthRequest: () => { setTimeout(() => window.bcNative.onHealthPermission(JSON.stringify({ granted: true })), 20); },
    healthWrite: (id) => { setTimeout(() => window.bcNative.onHealthResult(JSON.stringify({ id, ok: true, error: null })), 20); }
  };
  window.webkit = { messageHandlers: { bc: { postMessage: (msg) => {
    if (!msg || typeof msg.m !== 'string' || !Array.isArray(msg.a)) return Promise.reject(new Error('bad call'));
    calls.push(msg.m);
    if (msg.m === 'kvPut') { kv[msg.a[0]] = msg.a[1]; return later(true); }
    const h = handlers[msg.m];
    return later(h ? h(...msg.a) : null);
  } } } };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium')).map(d => path.join('/opt/pw-browsers', d, 'chrome-linux/chrome')).find(fs.existsSync);
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const fail = (m) => { errors.push('FAIL ' + m); };
  const base = { lang: 'en-US', units: 'imperial', appearance: 'light', base: 'bristlecone', view: { center: C, zoom: 13.2 }, layers: { hiking: true, ski: true, atv: true, bike: true, horse: true, climbing: true, trailheads: true, hillshade: true, contours: true, terrain3d: false, lands: true, tribal: true, admin: true, fire: true, avalanche: false } };
  const shot = (pg, n) => pg.screenshot({ path: path.join(OUT, n + '.png') });
  const wait = (pg, ms) => pg.waitForTimeout(ms);

  async function page(settings, label, idiom, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/New_York' });
    await ctx.addInitScript(fakeIos, { settings, idiom, proxy: 'http://localhost:' + PORT + '/proxy/', C });
    // On iOS nothing should reach the network directly (the OpenBeta POST is the one exception).
    await ctx.route(/^https?:\/\/(?!localhost)/, async (route) => {
      const r = route.request();
      direct.push(r.method() + ' ' + r.url());
      const m = mock(r.url(), r.method(), r.postData());
      await route.fulfill({ status: m.status, contentType: m.contentType, body: m.body, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const pg = await ctx.newPage();
    pg.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    pg.on('pageerror', e => errors.push(label + ' PAGEERROR: ' + e.message));
    await pg.goto('http://localhost:' + PORT + '/index.html');
    await pg.waitForTimeout(4500);
    return pg;
  }

  // iPad, English: map through the proxy, side-panel sheets, offline tab, Apple Health wording
  let pg = await page(base, 'ipad', 'pad', { width: 1024, height: 1366 });
  const plat = await pg.evaluate(() => Native.platform);
  if (plat !== 'ios') fail('platform detected as ' + plat);
  await pg.evaluate((c) => window.bcNative.onLocation(JSON.stringify({ mode: 'gps', lat: c[1] - 0.004, lon: c[0] + 0.014, acc: 6, heading: 40, gpsEnabled: true })), C);
  await wait(pg, 2500); await shot(pg, 'ios-01-ipad-map');
  const tiles = proxied.filter(u => u.startsWith('tiles.openfreemap.org/planet/')).length;
  const glyphs = proxied.filter(u => u.startsWith('app.bristlecone.local/glyphs/')).length;
  const dem = proxied.filter(u => u.includes('elevation-tiles-prod')).length;
  console.log('through the proxy: vector tiles', tiles, '| glyphs', glyphs, '| terrain', dem, '| total', proxied.length);
  if (!tiles || !glyphs || !dem) fail('map requests did not go through the proxy');
  await pg.click('[data-tab="offline"]'); await wait(pg, 1200); await shot(pg, 'ios-02-ipad-offline');
  const off = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
  if (!off.includes('Snowy Range')) fail('offline list did not render from the async bridge');
  const sheet = await pg.evaluate(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return { left: r.left, width: r.width }; });
  if (sheet.width > 480) fail('iPad sheet is not a side panel: ' + JSON.stringify(sheet));
  await pg.click('[data-tab="more"]'); await wait(pg, 800); await shot(pg, 'ios-03-ipad-settings');
  const more = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
  if (/Android/.test(more)) fail('settings mention Android on iOS');
  if (!/iCloud Drive/.test(more)) fail('backup note is not the iOS one');
  console.log('settings text check:', /Android/.test(more) ? 'mentions Android' : 'no Android wording', '| iPad wording:', /this iPad/.test(more));
  await pg.close();

  // Recording flow on iPhone size with the async bridge, then Apple Health
  pg = await page(base, 'iphone-record', 'phone', { width: 390, height: 844 });
  await pg.click('#btn-record'); await wait(pg, 500); await shot(pg, 'ios-04-record-intro');
  const intro = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
  if (!intro.includes('Apple Health')) fail('recording intro does not name Apple Health');
  await pg.click('#rec-go'); await wait(pg, 2500); await shot(pg, 'ios-05-recording');
  const barShown = await pg.evaluate(() => !document.getElementById('rec-bar').classList.contains('hidden'));
  if (!barShown) fail('recording bar did not appear from async trackStatus');
  await pg.click('#rec-stop'); await wait(pg, 2500); await shot(pg, 'ios-06-hike-saved');
  const hike = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
  if (!/Save to Apple Health/.test(hike)) fail('hike sheet has no Apple Health button');
  await pg.click('#h-health'); await wait(pg, 600);
  const synced = await pg.evaluate(() => document.getElementById('h-health').textContent);
  if (!/Saved to Apple Health/.test(synced)) fail('Apple Health save did not complete: ' + synced);
  await pg.click('#h-card'); await wait(pg, 7000);
  const card = await pg.evaluate(() => window.__lastShare);
  if (!card || !card.b64) fail('route card not shared'); else fs.writeFileSync(path.join(OUT, 'ios-07-route-card.png'), Buffer.from(card.b64, 'base64'));
  await pg.click('[data-close]').catch(() => { });
  await pg.click('[data-tab="places"]'); await wait(pg, 800); await shot(pg, 'ios-08-places-hikes');
  const places = await pg.evaluate(() => document.getElementById('sheet-body').innerText);
  if (!/Hike near|Hike/.test(places)) fail('saved hike missing from Places');
  const calls = await pg.evaluate(() => window.__iosCalls);
  console.log('bridge calls:', [...new Set(calls)].join(', '));
  await pg.close();

  // French on iPad: device wording
  pg = await page(Object.assign({}, base, { lang: 'fr-CA', units: 'metric' }), 'ipad-fr', 'pad', { width: 1024, height: 1366 });
  const fr = await pg.evaluate(() => [I18N.t('health.save'), I18N.t('backup.driveNote'), I18N.t('about.privacy')]);
  console.log('fr:', fr.join(' | '));
  if (fr[0] !== 'Enregistrer dans Santé' || !fr[1].includes('cet iPad') || fr[2].includes('téléphone')) fail('French iOS wording: ' + fr.join(' | '));
  await pg.close();

  const unexpected = direct.filter(u => !u.includes('api.openbeta.io'));
  if (unexpected.length) fail('requests bypassed the proxy: ' + unexpected.slice(0, 5).join(', '));
  await browser.close(); server.close();
  console.log('errors:', errors.length); console.log(errors.slice(0, 30).join('\n'));
  process.exit(errors.some(e => e.startsWith('FAIL') || e.includes('PAGEERROR')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
