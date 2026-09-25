/* Bristlecone app controller: map, location, sheets, settings. */
(function () {
  const t = (k, v) => I18N.t(k, v);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FC = () => ({ type: 'FeatureCollection', features: [] });
  const ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 1112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    cond: '<svg viewBox="0 0 24 24"><path d="M4 18h16M6 14l3-4 3 3 4-6 2 3"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-3.8M8.2 13l7.6 3.8"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/></svg>',
    route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 000-8h-4a4 4 0 010-8h6"/></svg>',
    drive: '<svg viewBox="0 0 24 24"><path d="M8 3h8l6 10-4 7H6l-4-7 6-10z"/><path d="M8 3l6 10H2M16 3l-6 10 4 7"/></svg>'
  };

  // ------------------------------------------------------------------ State
  const info = Native.info();
  const deviceRegion = String(info.locale || navigator.language || '').split(/[-_]/)[1] || '';
  function defaultSettings() {
    const lang = I18N.pickDefault(info.locale);
    let units = I18N.defaultUnits(lang);
    if (lang === 'es-419') units = deviceRegion === 'US' || deviceRegion === '' ? 'imperial' : 'metric';
    return {
      lang, units, appearance: 'auto', base: 'bristlecone', keepAwake: false, npsKey: '',
      layers: { hiking: true, ski: true, atv: true, bike: true, horse: true, climbing: true, trailheads: true, hillshade: true, contours: true, terrain3d: false, lands: true, tribal: true, admin: true, fire: true, avalanche: false },
      view: { center: [-104.8, 41.14], zoom: 4 }
    };
  }
  const saved = Native.kvGetJson('settings');
  const S = Object.assign(defaultSettings(), saved || {});
  S.layers = Object.assign(defaultSettings().layers, (saved && saved.layers) || {});
  I18N.lang = S.lang;

  const App = window.App = {
    state: { places: Native.kvGetJson('places') || [], me: null, follow: false, dark: false, regionProgress: {}, placeCache: {} },
    settings: S
  };
  const data = { trails: FC(), points: FC(), crags: FC(), lands: FC(), fire: FC(), avy: FC(), mine: FC(), me: FC(), hl: FC(), track: FC() };
  const saveSettings = () => Native.kvPutJson('settings', S);

  // ------------------------------------------------------------------ Formatting
  const imperial = () => S.units === 'imperial';
  function fmtLen(m) {
    if (m == null || isNaN(m)) return '';
    const nf = (v, d) => v.toLocaleString(I18N.dateLocale(), { maximumFractionDigits: d, minimumFractionDigits: 0 });
    if (imperial()) {
      const ft = m * 3.28084;
      if (ft < 1000) return nf(Math.round(ft / 10) * 10 || Math.round(ft), 0) + ' ' + t('unit.ft');
      return nf(m / 1609.344, m < 16093 ? 2 : 1) + ' ' + t('unit.mi');
    }
    if (m < 1000) return nf(Math.round(m), 0) + ' ' + t('unit.m');
    return nf(m / 1000, m < 10000 ? 2 : 1) + ' ' + t('unit.km');
  }
  function fmtEle(meters) {
    if (meters == null || isNaN(meters)) return '';
    return imperial() ? Math.round(meters * 3.28084).toLocaleString(I18N.dateLocale()) + ' ' + t('unit.ft') : Math.round(meters).toLocaleString(I18N.dateLocale()) + ' ' + t('unit.m');
  }
  function fmtBytes(b) {
    if (!b) return '0 MB';
    if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + ' KB';
    if (b < 1e9) return (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB';
    return (b / 1e9).toFixed(2) + ' GB';
  }
  function ageText(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 5 * 60000) return t('cond.justNow');
    if (d < 3600000) return t('cond.minsAgo', { n: Math.round(d / 60000) });
    if (d < 24 * 3600000) return t('cond.hoursAgo', { n: Math.round(d / 3600000) });
    if (d < 48 * 3600000) return t('cond.yesterday');
    return t('cond.daysAgo', { n: Math.round(d / 86400000) });
  }
  const fmtTime = (ts) => new Date(ts).toLocaleString(I18N.dateLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtClock = (d) => d ? d.toLocaleTimeString(I18N.dateLocale(), { hour: 'numeric', minute: '2-digit' }) : '';
  function dms(v, pos, neg) {
    const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = ((mf - m) * 60).toFixed(1);
    return d + '° ' + m + '′ ' + s + '″ ' + (v >= 0 ? pos : neg);
  }
  const coordText = (lon, lat) => lat.toFixed(5) + ', ' + lon.toFixed(5);
  /** Hostname of an https link from a data source, or null if it is not a usable https URL. */
  function safeHost(u) {
    try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname.replace(/^www\./, '') : null; } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ UI helpers
  let toastTimer;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3200);
  }
  let busy = 0;
  function setBusy(delta) { busy = Math.max(0, busy + delta); $('#loadbar').classList.toggle('on', busy > 0); }

  let sheetOnClose = null, currentTab = 'map';
  function openSheet(html, opts) {
    opts = opts || {};
    if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
    $('#sheet-body').innerHTML = html;
    $('#sheet-body').scrollTop = 0;
    $('#sheet').classList.remove('hidden');
    $('#sheet').classList.toggle('peek', !!opts.peek);
    $('#scrim').classList.toggle('hidden', !!opts.peek);
    sheetOnClose = opts.onClose || null;
    $$('[data-close]', $('#sheet')).forEach(b => b.addEventListener('click', closeSheet));
    return $('#sheet-body');
  }
  function closeSheet() {
    $('#sheet').classList.add('hidden');
    $('#scrim').classList.add('hidden');
    if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
    if (data.hl.features.length) { data.hl = FC(); setData('hl'); }
    setTab('map', true);
  }
  function head(title, sub) {
    return '<div class="sheet-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><button class="close" data-close aria-label="' + esc(t('common.close')) + '">' + ICON.close + '</button></div>';
  }
  function toggleRow(id, label, desc, on, swatch) {
    return '<label class="toggle"><div class="row grow">' + (swatch || '') + '<div class="grow"><div class="t-label">' + esc(label) + '</div>' + (desc ? '<div class="t-desc">' + esc(desc) + '</div>' : '') + '</div></div>' +
      '<span class="switch"><input type="checkbox" data-toggle="' + id + '"' + (on ? ' checked' : '') + '><span></span></span></label>';
  }
  function seg(name, options, value) {
    return '<div class="seg" data-seg="' + name + '">' + options.map(([v, l]) => '<button data-v="' + v + '" class="' + (v === value ? 'on' : '') + '">' + esc(l) + '</button>').join('') + '</div>';
  }
  function bindSeg(root, name, fn) {
    const el = $('[data-seg="' + name + '"]', root);
    if (!el) return;
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('button', el).forEach(x => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  }
  function setTab(tab, silent) {
    currentTab = tab;
    $$('.bottomnav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (silent) return;
    if (tab === 'map') closeSheet();
    else if (tab === 'conditions') renderConditions();
    else if (tab === 'offline') renderOffline();
    else if (tab === 'places') renderPlaces();
    else if (tab === 'more') renderSettings();
  }

  // ------------------------------------------------------------------ Contours
  let demSource = null;
  function contourUrl() {
    if (!window.mlcontour) return null;
    if (!demSource) {
      demSource = new mlcontour.DemSource({ url: BcStyle.DEM, encoding: 'terrarium', maxzoom: 12, worker: false, cacheSize: 100, timeoutMs: 20000 });
      demSource.setupMaplibre(maplibregl);
    }
    return demSource.contourProtocolUrl({
      multiplier: imperial() ? 3.28084 : 1,
      thresholds: imperial()
        ? { 10: [200, 1000], 11: [200, 1000], 12: [100, 500], 13: [40, 200], 14: [40, 200], 15: [20, 100] }
        : { 10: [100, 500], 11: [50, 250], 12: [50, 250], 13: [20, 100], 14: [10, 50], 15: [10, 50] },
      elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours', overzoom: 1
    });
  }

  // ------------------------------------------------------------------ Theme
  function computeDark() {
    if (S.appearance === 'dark') return true;
    if (S.appearance === 'light') return false;
    const ref = App.state.me && App.state.me.lat != null ? App.state.me : (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : { lat: S.view.center[1], lon: S.view.center[0] });
    return Sun.isDark(new Date(), ref.lat, ref.lon);
  }
  function applyTheme(force) {
    const dark = computeDark();
    if (!force && dark === App.state.dark) return;
    App.state.dark = dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    Native.setDark(dark);
    if (map) applyStyle();
  }

  // ------------------------------------------------------------------ Map
  let map = null, scaleCtl = null;
  /** The base map actually drawn: "satellite" resolves to US aerials or Sentinel-2 by location. */
  function effectiveBase() {
    if (S.base !== 'satellite') return S.base;
    const c = map ? map.getCenter() : { lng: S.view.center[0], lat: S.view.center[1] };
    return BcData.countryOf(c.lng, c.lat) === 'us' ? 'satNaip' : 'satS2';
  }
  let drawnBase = null;
  function styleOpts() {
    drawnBase = effectiveBase();
    return { dark: App.state.dark, units: S.units, lang: S.lang, base: drawnBase, layers: S.layers, data, contourUrl: contourUrl() };
  }
  function applyStyle() { map.setStyle(BcStyle.build(styleOpts())); }
  function setData(id) { const s = map && map.getSource(id); if (s) s.setData(data[id]); }

  function initMap() {
    map = new maplibregl.Map({
      container: 'map', style: BcStyle.build(styleOpts()), center: S.view.center, zoom: S.view.zoom,
      attributionControl: { compact: true }, maxPitch: 70, dragRotate: true, pitchWithRotate: true, fadeDuration: 150
    });
    scaleCtl = new maplibregl.ScaleControl({ unit: imperial() ? 'imperial' : 'metric', maxWidth: 90 });
    map.addControl(scaleCtl, 'bottom-left');
    map.on('styleimagemissing', (e) => {
      if (map.hasImage(e.id)) return;
      const ic = BcIcons.get(e.id);
      // Unknown ids get a blank pixel so MapLibre does not keep asking for them.
      if (ic) map.addImage(e.id, ic.img, { pixelRatio: ic.pixelRatio });
      else map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on('load', () => {
      splashDone(); refreshData();
      // Start with the credits collapsed; they open with a tap on the (i) button.
      const at = document.querySelector('.maplibregl-ctrl-attrib');
      if (at) at.classList.remove('maplibregl-compact-show');
    });
    map.on('moveend', () => {
      S.view = { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() };
      if (S.base === 'satellite' && effectiveBase() !== drawnBase) applyStyle();
      saveSettingsSoon();
      refreshDataSoon();
    });
    map.on('rotate', updateNorth);
    map.on('pitch', updateNorth);
    map.on('dragstart', () => { if (App.state.follow) setFollow(false); });
    map.on('click', onMapClick);
    map.on('contextmenu', (e) => openPlaceEditor({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    let lpTimer = null, lpStart = null;
    map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) { clearTimeout(lpTimer); return; }
      lpStart = e.point;
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => openPlaceEditor({ lon: e.lngLat.lng, lat: e.lngLat.lat }), 600);
    });
    map.on('touchmove', (e) => { if (lpStart && (Math.abs(e.point.x - lpStart.x) > 8 || Math.abs(e.point.y - lpStart.y) > 8)) clearTimeout(lpTimer); });
    ['touchend', 'touchcancel', 'movestart', 'zoomstart'].forEach(ev => map.on(ev, () => clearTimeout(lpTimer)));
    map.on('error', (e) => { if (e && e.error && !/(404|504|Failed to fetch|AbortError)/.test(String(e.error.message || e.error))) console.warn('map', e.error); });
  }
  let saveTimer;
  function saveSettingsSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSettings, 1500); }

  function updateNorth() {
    const b = map.getBearing(), p = map.getPitch();
    $('#btn-north').classList.toggle('hidden', Math.abs(b) < 1 && p < 1);
    $('#north-icon').style.transform = 'rotate(' + (-b) + 'deg)';
  }

  // ------------------------------------------------------------------ Data loading
  const trailCells = new Map(), landCells = new Map();
  const trailQueue = [];
  let trailRunning = false, dataTimer = null, lastFireKey = '', lastFireAt = 0, lastAvyAt = 0, lastCragKey = '';
  function refreshDataSoon() { clearTimeout(dataTimer); dataTimer = setTimeout(refreshData, 350); }

  function viewBbox() { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }

  function refreshData() {
    if (!map) return;
    const z = map.getZoom(), bbox = viewBbox();
    const anyTrail = ['hiking', 'ski', 'atv', 'bike', 'horse', 'climbing', 'trailheads'].some(k => S.layers[k]);
    if (z >= 10.5 && anyTrail) {
      const cells = BcData.tilesFor(bbox, BcData.TRAIL_Z);
      if (cells.length <= 16) {
        const c = map.getCenter();
        cells.sort((a, b) => dist2(a, c) - dist2(b, c));
        cells.forEach(([x, y, zz]) => {
          const k = x + '/' + y;
          const e = trailCells.get(k);
          if (e && !(e.state === 'failed' && Date.now() >= e.retryAt)) { e.used = Date.now(); return; }
          trailCells.set(k, { state: 'queued', used: Date.now(), trails: [], points: [] });
          trailQueue.push([x, y, zz]);
        });
        runTrailQueue();
      }
    }
    if ((S.layers.lands || S.layers.tribal) && z >= 6.5) {
      const cells = BcData.tilesFor(bbox, BcData.LAND_Z);
      if (cells.length <= 9) cells.forEach(([x, y, zz]) => {
        const k = x + '/' + y;
        if (landCells.has(k)) return;
        landCells.set(k, { state: 'loading', feats: [] });
        setBusy(1);
        BcData.loadLandCell(x, y, zz, S.lang).then(feats => { landCells.set(k, { state: 'done', feats }); rebuildLands(); })
          .catch(() => landCells.delete(k)).finally(() => setBusy(-1));
      });
    }
    if (S.layers.climbing && z >= 9) {
      const c = map.getCenter();
      const key = (Math.round(c.lat * 4) / 4) + ',' + (Math.round(c.lng * 4) / 4);
      if (key !== lastCragKey) {
        lastCragKey = key;
        BcData.loadCrags(c.lng, c.lat).then(fc => { data.crags = fc; setData('crags'); });
      }
    }
    if (S.layers.fire && z >= 5) {
      const key = bbox.map(v => Math.round(v)).join(',');
      if (key !== lastFireKey || Date.now() - lastFireAt > 15 * 60000) {
        lastFireKey = key; lastFireAt = Date.now();
        const pad = [bbox[0] - 1, bbox[1] - 1, bbox[2] + 1, bbox[3] + 1];
        BcData.loadFires(pad).then(r => { data.fire = r.fc; setData('fire'); }).catch(() => { });
      }
    }
    if (S.layers.avalanche && Date.now() - lastAvyAt > 30 * 60000) {
      lastAvyAt = Date.now();
      BcData.loadAvyUS().then(r => { data.avy = r.fc; setData('avy'); }).catch(() => { lastAvyAt = 0; });
    }
    pruneCells();
  }
  function dist2([x, y, z], c) {
    const b = BcData.tileBbox(x, y, z);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return (cx - c.lng) ** 2 + (cy - c.lat) ** 2;
  }
  async function runTrailQueue() {
    if (trailRunning) return;
    trailRunning = true;
    while (trailQueue.length) {
      const [x, y, z] = trailQueue.shift();
      const k = x + '/' + y;
      const e = trailCells.get(k);
      if (!e || e.state !== 'queued') continue;
      e.state = 'loading';
      setBusy(1);
      try {
        const r = await BcData.loadTrailCell(x, y, z);
        e.trails = r.trails; e.points = r.points; e.state = 'done'; e.meta = r.meta;
        rebuildTrails();
      } catch (err) {
        // Keep the cell as failed for a minute so a busy or rate-limited server is not hammered.
        e.state = 'failed'; e.retryAt = Date.now() + 60000;
      } finally { setBusy(-1); }
    }
    trailRunning = false;
  }
  function pruneCells() {
    if (trailCells.size <= 48) return;
    const arr = Array.from(trailCells.entries()).filter(([, v]) => v.state === 'done').sort((a, b) => a[1].used - b[1].used);
    arr.slice(0, trailCells.size - 40).forEach(([k]) => trailCells.delete(k));
    rebuildTrails();
  }
  function rebuildTrails() {
    const seenT = new Set(), seenP = new Set();
    const trails = [], points = [];
    trailCells.forEach(c => {
      c.trails.forEach(f => { if (!seenT.has(f.properties.id)) { seenT.add(f.properties.id); trails.push(f); } });
      c.points.forEach(f => { if (!seenP.has(f.properties.id)) { seenP.add(f.properties.id); points.push(f); } });
    });
    data.trails = { type: 'FeatureCollection', features: trails };
    data.points = { type: 'FeatureCollection', features: points };
    setData('trails'); setData('points');
  }
  function rebuildLands() {
    const seen = new Set(), feats = [];
    landCells.forEach(c => c.feats.forEach(f => { if (!seen.has(f.properties.fid)) { seen.add(f.properties.fid); feats.push(f); } }));
    data.lands = { type: 'FeatureCollection', features: feats };
    setData('lands');
  }

  // ------------------------------------------------------------------ Location
  function circle(lon, lat, r) {
    const pts = [];
    const R = 6371008.8, d = r / R, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
    for (let i = 0; i <= 48; i++) {
      const b = i / 48 * 2 * Math.PI;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      pts.push([l2 * 180 / Math.PI, p2 * 180 / Math.PI]);
    }
    return pts;
  }
  function nearestOnTrails(lon, lat, maxM) {
    let best = null;
    const kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
    data.trails.features.forEach(f => {
      const c = f.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const ax = (c[i - 1][0] - lon) * kx, ay = (c[i - 1][1] - lat) * ky, bx = (c[i][0] - lon) * kx, by = (c[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        let tt = L ? -(ax * dx + ay * dy) / L : 0; tt = Math.max(0, Math.min(1, tt));
        const px = ax + tt * dx, py = ay + tt * dy, dd = Math.hypot(px, py);
        if (dd < maxM && (!best || dd < best.d)) best = { d: dd, lon: lon + px / kx, lat: lat + py / ky, name: f.properties.name };
      }
    });
    return best;
  }
  function onLocation(fix) {
    App.state.me = fix;
    Native._webFix(fix);
    const chip = $('#loc-chip'), banner = $('#estimate-banner');
    if (fix.mode === 'none' || fix.lat == null) {
      chip.classList.remove('hidden', 'est'); chip.classList.add('off');
      $('#loc-chip-text').textContent = fix.gpsEnabled === false ? t('loc.gpsOff') : t('loc.searching');
      banner.classList.add('hidden');
      data.me = FC(); setData('me');
      return;
    }
    const est = fix.mode !== 'gps';
    chip.classList.remove('hidden', 'off');
    chip.classList.toggle('est', est);
    const label = fix.mode === 'gps' ? t('loc.gps') : fix.mode === 'network' ? t('loc.network') : t('loc.estimate');
    $('#loc-chip-text').textContent = label + ' ± ' + fmtLen(fix.acc);
    let dot = [fix.lon, fix.lat], snapped = null;
    if (est) {
      snapped = nearestOnTrails(fix.lon, fix.lat, Math.min(150, fix.acc * 0.6));
      if (snapped) dot = [snapped.lon, snapped.lat];
      banner.classList.remove('hidden');
      $('#est-title').innerHTML = esc(t('loc.estimateTitle')) + ' <span class="acc">± ' + esc(fmtLen(fix.acc)) + '</span>';
      $('#est-sub').textContent = t('loc.lookForLandmarks') + (snapped ? '. ' + t('loc.snapped') + (snapped.name ? ': ' + snapped.name : '') + '.' : '.');
    } else banner.classList.add('hidden');
    const pt = { type: 'Feature', properties: { mode: fix.mode }, geometry: { type: 'Point', coordinates: dot } };
    if (fix.heading != null) pt.properties.heading = fix.heading;
    data.me = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { mode: fix.mode }, geometry: { type: 'Polygon', coordinates: [circle(fix.lon, fix.lat, Math.max(fix.acc, 3))] } }, pt] };
    setData('me');
    if (!App.state.hadFix) {
      App.state.hadFix = true;
      map.flyTo({ center: dot, zoom: Math.max(map.getZoom(), 13.5), duration: 1200 });
      setFollow(true);
      applyTheme();
    } else if (App.state.follow) {
      map.easeTo({ center: dot, duration: 600 });
    }
  }
  function setFollow(on) {
    App.state.follow = on;
    $('#btn-locate').classList.toggle('following', on);
  }
  function locateTap() {
    const me = App.state.me;
    if (!me || me.lat == null) { toast(t('toast.locating')); Native.requestLocation(); return; }
    if (App.state.follow && me) { showLocationInfo(); return; }
    setFollow(true);
    map.flyTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  }
  function showLocationInfo() {
    const me = App.state.me || {};
    const est = me.mode && me.mode !== 'gps' && me.mode !== 'none';
    const inf = Native.info();
    let html = head(me.mode === 'gps' ? t('loc.gps') : me.mode === 'network' ? t('loc.network') : me.mode === 'estimate' ? t('loc.estimate') : t('loc.none'), me.acc ? '± ' + esc(fmtLen(me.acc)) : '');
    if (est) {
      html += '<div class="estimate-banner"><strong>' + esc(t('loc.estimateTitle')) + '</strong><span>' + esc(me.mode === 'network' ? t('loc.networkBody', { d: fmtLen(me.acc) }) : t('loc.estimateBody')) + '</span></div>';
      if (me.walked) html += '<p class="read muted">' + esc(t('loc.walked', { d: fmtLen(me.walked) })) + '</p>';
    }
    if (me.lat != null) {
      html += '<div class="card"><div class="kind-tag">' + esc(t('ft.coords')) + '</div><div class="coords" style="margin-top:6px">' + esc(coordText(me.lon, me.lat)) + '</div><div class="coords muted small">' + esc(dms(me.lat, 'N', 'S') + '  ' + dms(me.lon, 'E', 'W')) + '</div>';
      const ele = me.alt != null ? me.alt : null;
      if (ele != null) html += '<div class="small muted" style="margin-top:6px">' + esc(t('ft.elevation')) + ': ' + esc(fmtEle(ele)) + '</div>';
      html += '<div class="btns"><button class="btn small" id="li-copy">' + ICON.copy + esc(t('ft.copy')) + '</button><button class="btn small" id="li-share">' + ICON.share + esc(t('pl.share')) + '</button><button class="btn small" id="li-pin">' + ICON.pin + esc(t('pl.saveHere')) + '</button><button class="btn small" id="li-sms">' + ICON.share + esc(t('rec.textLocation')) + '</button></div></div>';
    }
    html += '<p class="small muted">' + esc(inf.strideSamples > 0 ? t('loc.stride', { n: inf.strideSamples }) : t('loc.strideNew')) + '</p>';
    html += '<h3 class="section">' + esc(t('about.estimates')) + '</h3><p class="read">' + esc(t('about.estimatesBody')) + '</p>';
    const body = openSheet(html);
    const b1 = $('#li-copy', body); if (b1) b1.onclick = () => { Native.copy(coordText(me.lon, me.lat)); toast(t('ft.copied')); };
    const b2 = $('#li-share', body); if (b2) b2.onclick = () => Native.share(coordText(me.lon, me.lat) + '\nhttps://www.openstreetmap.org/?mlat=' + me.lat.toFixed(5) + '&mlon=' + me.lon.toFixed(5) + '#map=15/' + me.lat.toFixed(5) + '/' + me.lon.toFixed(5));
    const b3 = $('#li-pin', body); if (b3) b3.onclick = () => openPlaceEditor({ lon: me.lon, lat: me.lat });
    const b4 = $('#li-sms', body); if (b4) b4.onclick = () => textLocation(me);
  }

  /** Opens the messaging app with your position, its accuracy and a map link. */
  function textLocation(me) {
    const est = me.mode && me.mode !== 'gps';
    const link = 'https://www.openstreetmap.org/?mlat=' + me.lat.toFixed(5) + '&mlon=' + me.lon.toFixed(5) + '#map=15/' + me.lat.toFixed(5) + '/' + me.lon.toFixed(5);
    Native.sms(t(est ? 'rec.smsEstimate' : 'rec.smsBody', { coords: coordText(me.lon, me.lat), acc: fmtLen(me.acc || 0), link, time: fmtTime(Date.now()) }));
  }

  // ------------------------------------------------------------------ Feature cards
  const INTERACTIVE = ['mine', 'trailheads', 'climb-points', 'crags', 'peak', 'trail-hiking', 'trail-alpine', 'trail-downhill', 'trail-nordic', 'trail-atv', 'trail-bike', 'trail-horse', 'trail-ferrata', 'trail-track', 'fire-fill', 'tribal-fill', 'lands-fill'];
  function onMapClick(e) {
    const layers = INTERACTIVE.filter(id => map.getLayer(id));
    const box = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
    const feats = map.queryRenderedFeatures(box, { layers });
    if (!feats.length) { if (!$('#sheet').classList.contains('hidden') && $('#sheet').classList.contains('peek')) closeSheet(); return; }
    feats.sort((a, b) => layers.indexOf(a.layer.id) - layers.indexOf(b.layer.id));
    showFeature(feats[0], e.lngLat);
  }
  function highlight(f) {
    if (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon' || f.geometry.type === 'MultiLineString') {
      let feats;
      if (f.geometry.type === 'MultiPolygon') feats = f.geometry.coordinates.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } }));
      else if (f.geometry.type === 'MultiLineString') feats = f.geometry.coordinates.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }));
      else feats = [{ type: 'Feature', properties: {}, geometry: f.geometry }];
      data.hl = { type: 'FeatureCollection', features: feats };
      setData('hl');
    }
  }
  function lineLength(coords) { let s = 0; for (let i = 1; i < coords.length; i++) s += BcData.haversine(coords[i - 1], coords[i]); return s; }
  function kvRows(rows) {
    const r = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
    return r.length ? '<dl class="kv">' + r.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '';
  }
  function coordBlock(lon, lat) {
    return '<div class="card"><div class="row between"><div><div class="kind-tag">' + esc(t('ft.coords')) + '</div><div class="coords" style="margin-top:4px">' + esc(coordText(lon, lat)) + '</div></div>' +
      '<button class="btn small" data-act="copy">' + ICON.copy + esc(t('ft.copy')) + '</button></div></div>';
  }
  function actions(list) {
    const m = { details: [ICON.route, 'td.open'], directions: [ICON.nav, 'ft.directions'], conditions: [ICON.cond, 'ft.conditions'], pin: [ICON.pin, 'ft.pin'], share: [ICON.share, 'pl.share'] };
    return '<div class="btns">' + list.map((a, i) => '<button class="btn small' + (i === 0 ? ' primary' : '') + '" data-act="' + a + '">' + m[a][0] + esc(t(m[a][1])) + '</button>').join('') + '</div>';
  }
  function bindActions(body, lon, lat, name) {
    $$('[data-act]', body).forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'details') return; // wired by the trail details module
      if (a === 'copy') { Native.copy(coordText(lon, lat)); toast(t('ft.copied')); }
      if (a === 'directions') Native.openExternal('geo:' + lat.toFixed(6) + ',' + lon.toFixed(6) + '?q=' + lat.toFixed(6) + ',' + lon.toFixed(6) + '(' + encodeURIComponent(name || 'Bristlecone') + ')');
      if (a === 'conditions') renderConditions({ lon, lat, label: name });
      if (a === 'pin') openPlaceEditor({ lon, lat, name });
      if (a === 'share') Native.share((name ? name + '\n' : '') + coordText(lon, lat) + '\nhttps://www.openstreetmap.org/?mlat=' + lat.toFixed(5) + '&mlon=' + lon.toFixed(5) + '#map=15/' + lat.toFixed(5) + '/' + lon.toFixed(5));
    }));
  }

  function showFeature(f, lngLat) {
    const p = f.properties || {};
    const L = f.layer.id;
    const at = f.geometry.type === 'Point' ? f.geometry.coordinates : [lngLat.lng, lngLat.lat];
    const [lon, lat] = at;
    let html = '', name = p.name;
    if (L === 'mine') {
      const place = App.state.places.find(x => x.id === p.id);
      if (place) { openPlaceEditor(place); return; }
    }
    if (L === 'trailheads') {
      html = '<div class="kind-tag">' + esc(t('ft.trailhead')) + '</div>' + head(name || t('ft.trailhead'));
      html += '<div class="card"><div class="kind-tag">' + esc(t(p.addr ? 'ft.address' : 'ft.nearestAddress')) + '</div><div id="addr" class="read" style="margin-top:4px">' + esc(p.addr || t('ft.lookingUp')) + '</div></div>';
      html += coordBlock(lon, lat);
      html += kvRows([[t('ft.elevation'), p.ele ? fmtEle(parseFloat(p.ele)) : ''], [t('ft.parking'), p.parking], [t('ft.fee'), p.fee === 'yes' ? t('ft.yes') : p.fee === 'no' ? t('ft.no') : p.fee], [t('ft.manager'), p.operator]]);
      html += actions(['directions', 'conditions', 'pin', 'share']);
    } else if (L === 'crags' || L === 'climb-points') {
      html = '<div class="kind-tag">' + esc(t(L === 'crags' ? 'kind.crag' : 'kind.climb')) + '</div>' + head(name || t('kind.climb'), p.climbs ? esc(t('ft.climbs', { n: p.climbs })) : '');
      html += kvRows([[t('ft.grade'), p.grade], [t('ft.source'), L === 'crags' ? 'OpenBeta' : 'OpenStreetMap']]);
      if (p.uuid) html += '<p class="small"><a href="#" data-ext="https://openbeta.io/area/' + esc(p.uuid) + '">openbeta.io</a></p>';
      html += coordBlock(lon, lat) + actions(['directions', 'conditions', 'pin']);
    } else if (L === 'peak') {
      const ele = p.ele != null ? Number(p.ele) : null;
      html = '<div class="kind-tag">' + esc(t('kind.peak')) + '</div>' + head(name || t('kind.peak'), ele ? esc(fmtEle(ele)) : '');
      html += coordBlock(lon, lat) + actions(['conditions', 'pin', 'share']);
    } else if (L.startsWith('trail-')) {
      const full = data.trails.features.find(x => x.properties.id === p.id) || f;
      highlight(full);
      const kindKey = 'kind.' + p.kind;
      html = '<div class="kind-tag">' + esc(t(kindKey)) + '</div>' + head(name || t('ft.unnamed'), p.routes && p.routes !== name ? esc(t('ft.partOf') + ': ' + p.routes) : '');
      const diff = p.kind === 'ski_downhill' || p.kind === 'ski_nordic' ? (p.difficulty ? t('piste.' + p.difficulty) : '') : (p.sac ? t('sac.' + p.sac) : (p.mtb ? 'MTB ' + p.mtb : ''));
      html += kvRows([
        [t('ft.difficulty'), diff], [t('ft.surface'), p.surface], [t('ft.visibility'), p.vis ? t('vis.' + p.vis) : ''],
        [t('ft.access'), p.access], [t('ft.length'), fmtLen(lineLength(full.geometry.coordinates))], [t('ft.width'), p.width],
        [t('ft.surveyed'), p.surveyed], [t('ft.source'), 'OpenStreetMap']
      ]);
      html += '<div id="td-peek"></div>';
      html += coordBlock(lon, lat) + actions(['details', 'conditions', 'pin', 'share']);
    } else if (L === 'fire-fill') {
      html = '<div class="kind-tag">' + esc(t('src.fire')) + '</div>' + head(t('fire.title', { name: p.name }), p.date ? esc(ageText(p.date)) : '');
      html += '<p class="read">' + esc(t('fire.body', { acres: p.acres != null ? Number(p.acres).toLocaleString(I18N.dateLocale()) : '?', contained: p.pct != null && p.pct !== 'null' ? t('fire.contained', { p: p.pct }) : '' })) + '</p>';
      html += actions(['conditions']);
    } else if (L === 'lands-fill' || L === 'tribal-fill') {
      const tribal = p.mgr === 'TRIB';
      html = '<div class="kind-tag">' + esc(t(tribal ? 'kind.tribal' : 'kind.land')) + '</div>' + head(name || t(tribal ? 'kind.tribal' : 'kind.land'));
      html += kvRows([[t('ft.manager'), t('mgr.' + (p.mgr || 'OTH'))], [t('ft.designation'), p.des], [t('ft.publicAccess'), p.access ? (t('access.' + ({ OA: 'open', RA: 'restricted', XA: 'closed', UK: 'unknown' }[p.access] || 'unknown'))) : ''], [t('ft.source'), p.src]]);
      const full = data.lands.features.find(x => x.properties.fid === p.fid);
      if (full) highlight(full);
      html += actions(['conditions', 'pin']);
    }
    if (!html) return;
    const body = openSheet(html, { peek: true });
    bindActions(body, lon, lat, name);
    $$('[data-ext]', body).forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); Native.openExternal(a.dataset.ext); }));
    if (L === 'trailheads' && !p.addr) lookupAddress(lon, lat, body);
    if (L === 'trailheads' && window.BcTrail) BcTrail.enrichTrailhead(body, lon, lat, p);
    if (L.startsWith('trail-') && window.BcTrail) {
      const full = data.trails.features.find(x => x.properties.id === p.id) || f;
      BcTrail.peek(body, full);
      const d = $('[data-act="details"]', body); if (d) d.onclick = () => BcTrail.open(full);
    }
  }

  async function lookupAddress(lon, lat, body) {
    const el = $('#addr', body);
    try {
      const r = await BcData.reverse(lon, lat, S.lang, 17);
      const addr = BcData.formatAddress(r);
      if (!el.isConnected) return;
      if (addr) {
        const d = r.lat ? BcData.haversine([lon, lat], [parseFloat(r.lon), parseFloat(r.lat)]) : 0;
        el.textContent = addr + (d > 400 ? ' (' + fmtLen(d) + ')' : '');
      } else el.textContent = t('ft.noAddress');
    } catch (e) {
      if (el.isConnected) el.textContent = t('ft.noAddress');
    }
  }

  // ------------------------------------------------------------------ Layers sheet
  function renderLayers() {
    const bases = ['bristlecone', 'satellite', 'usgsTopo', 'openTopo', 'canada'];
    const sw = (c, line) => '<span class="swatch' + (line ? ' line' : '') + '" style="background:' + c + '"></span>';
    let html = head(t('layers.title'), esc(t('layers.zoomHint')));
    html += '<h3 class="section">' + esc(t('layers.base')) + '</h3><div class="basegrid">' + bases.map(b => '<button data-base="' + b + '" class="' + (S.base === b ? 'on' : '') + '"><div class="b-name">' + esc(t('base.' + b)) + '</div><div class="b-desc">' + esc(t('base.' + b + '.d')) + '</div></button>').join('') + '</div>';
    html += '<h3 class="section">' + esc(t('layers.trails')) + '</h3>';
    html += toggleRow('hiking', t('trail.hiking'), '', S.layers.hiking, sw(BcStyle.TRAIL.hiking, 1));
    html += toggleRow('ski', t('trail.ski'), '', S.layers.ski, sw('#1F5FBF', 1));
    html += toggleRow('atv', t('trail.atv'), '', S.layers.atv, sw(BcStyle.TRAIL.atv, 1));
    html += toggleRow('bike', t('trail.bike'), '', S.layers.bike, sw(BcStyle.TRAIL.bike, 1));
    html += toggleRow('horse', t('trail.horse'), '', S.layers.horse, sw(BcStyle.TRAIL.horse, 1));
    html += toggleRow('climbing', t('trail.climbing'), '', S.layers.climbing, sw('#6B5A3E'));
    html += toggleRow('trailheads', t('trail.trailheads'), '', S.layers.trailheads, sw('#0F3D2E'));
    html += '<h3 class="section">' + esc(t('layers.terrain')) + '</h3>';
    html += toggleRow('hillshade', t('terrain.hillshade'), '', S.layers.hillshade);
    html += toggleRow('contours', t('terrain.contours'), '', S.layers.contours);
    html += toggleRow('terrain3d', t('terrain.3d'), '', S.layers.terrain3d);
    html += '<h3 class="section">' + esc(t('layers.lands')) + '</h3>';
    html += toggleRow('lands', t('lands.public'), t('lands.public.d'), S.layers.lands, sw(BcStyle.LAND_COLORS.USFS));
    html += toggleRow('tribal', t('lands.tribal'), t('lands.tribal.d'), S.layers.tribal, sw(BcStyle.LAND_COLORS.TRIB));
    html += toggleRow('admin', t('lands.admin'), '', S.layers.admin, sw('#5D3F66', 1));
    html += '<div class="legend">' + ['NPS', 'USFS', 'BLM', 'FWS', 'STAT', 'LOC', 'TRIB'].map(k => sw(BcStyle.LAND_COLORS[k]) + '<span>' + esc(t('mgr.' + k)) + '</span>').join('') + '</div>';
    html += '<h3 class="section">' + esc(t('layers.hazards')) + '</h3>';
    html += toggleRow('fire', t('hazard.fire'), '', S.layers.fire, sw('#D9412B'));
    html += toggleRow('avalanche', t('hazard.avalanche'), '', S.layers.avalanche, sw('#F2A93B'));
    const body = openSheet(html);
    $$('[data-base]', body).forEach(b => b.addEventListener('click', () => {
      S.base = b.dataset.base; saveSettings();
      $$('[data-base]', body).forEach(x => x.classList.toggle('on', x === b));
      applyStyle();
    }));
    $$('[data-toggle]', body).forEach(inp => inp.addEventListener('change', () => {
      S.layers[inp.dataset.toggle] = inp.checked; saveSettings();
      applyStyle();
      refreshData();
    }));
  }

  // ------------------------------------------------------------------ Conditions
  async function placeContext(lon, lat) {
    const key = (Math.round(lat * 10) / 10) + ',' + (Math.round(lon * 10) / 10) + ',' + S.lang;
    if (App.state.placeCache[key]) return App.state.placeCache[key];
    let ctx = { country: BcData.countryOf(lon, lat) };
    try {
      const r = await BcData.reverse(lon, lat, S.lang, 10);
      const a = (r && r.address) || {};
      const iso = a['ISO3166-2-lvl4'] || '';
      ctx = {
        country: a.country_code || ctx.country,
        stateCode: iso.split('-')[1] || null,
        label: a.city || a.town || a.village || a.hamlet || a.county || a.state_district || a.state || null,
        stateName: a.state || a.province || null
      };
    } catch (e) { /* offline: fall back to a rough country guess */ }
    App.state.placeCache[key] = ctx;
    return ctx;
  }

  let condSeq = 0;
  async function renderConditions(target) {
    setTab('conditions', true);
    const seq = ++condSeq;
    const c = target || (App.state.me && App.state.me.lat != null && !App.state.conditionsUseCenter ? { lon: App.state.me.lon, lat: App.state.me.lat } : { lon: map.getCenter().lng, lat: map.getCenter().lat });
    const html = head(t('cond.title'), esc(t('cond.near', { place: target && target.label ? target.label : t('cond.mapCenter') })) + ' · ' + esc(t('cond.newestFirst'))) +
      '<div id="cond-list"><p class="read muted">' + esc(t('cond.loading')) + '</p></div>';
    const body = openSheet(html);
    const ctx = await placeContext(c.lon, c.lat);
    if (seq !== condSeq) return;
    if (ctx.label && !(target && target.label)) $('.sheet-head .sub', body).textContent = t('cond.near', { place: ctx.label }) + ' · ' + t('cond.newestFirst');
    setBusy(1);
    let res;
    try { res = await BcReports.gather({ lon: c.lon, lat: c.lat, country: ctx.country, stateCode: ctx.stateCode, stateName: ctx.stateName, label: ctx.label, target: target && target.label, lang: S.lang, npsKey: S.npsKey, social: S.social }); }
    finally { setBusy(-1); }
    if (seq !== condSeq || !$('#cond-list')) return;
    const list = $('#cond-list');
    let out = '<div class="btns" style="margin:0 0 12px"><button class="btn small primary" id="c-refresh">' + esc(t('cond.refresh')) + '</button><button class="btn small" id="c-add">' + ICON.pin + esc(t('cond.addReport')) + '</button></div>';
    if (res.oldestSaved) out += '<div class="estimate-banner" style="margin-bottom:12px"><span>' + esc(t('cond.offline', { age: ageText(res.oldestSaved) })) + '</span></div>';
    if (!res.items.length) out += '<div class="empty-state"><img src="img/mark.svg" alt=""><p>' + esc(t('cond.none')) + '</p></div>';
    const now = Date.now();
    const groups = [['cond.recent', 2 * 86400000], ['cond.week', 7 * 86400000], ['cond.month', 31 * 86400000], ['cond.older', Infinity]];
    let gi = -1;
    res.items.forEach((it, idx) => {
      const age = it.time ? now - it.time : Infinity;
      const g = groups.findIndex(([, lim]) => age <= lim);
      if (g !== gi) { gi = g; out += '<div class="group-head">' + esc(t(groups[g][0])) + '</div>'; }
      const old = age > 7 * 86400000;
      out += '<article class="rep ' + esc(it.severity || '') + '" data-i="' + idx + '">' +
        '<div class="r-top"><span>' + esc(t('src.' + it.src)) + (it.stale ? '<span class="stale-tag">' + esc(t('cond.stale')) + '</span>' : '') + '</span><span class="age' + (old ? ' old' : '') + '">' + esc(it.time ? ageText(it.time) : '') + '</span></div>' +
        '<h4>' + esc(it.title || '') + '</h4>' + (it.sub ? '<div class="r-sub">' + esc(it.sub) + '</div>' : '') +
        (it.until ? '<div class="r-sub">' + esc(t('cond.until', { t: fmtTime(it.until) })) + '</div>' : '') +
        (it.body ? '<div class="r-body">' + esc(it.body) + '</div>' : '') +
        '<div class="r-actions">' + (it.body && it.body.length > 140 ? '<button data-more>' + esc(t('cond.read')) + '</button>' : '') + (safeHost(it.url) ? '<a href="#" data-ext="' + esc(it.url) + '">' + esc(safeHost(it.url)) + '</a>' : '') +
        (it.src === 'social' ? '<button data-fb="1">' + esc(t('soc.useful')) + '</button><button data-fb="0">' + esc(t('soc.notReport')) + '</button>' : '') + '</div></article>';
    });
    out += '<h3 class="section">' + esc(t('cond.sources')) + '</h3><div class="src-list">' + BcReports.SOURCES.map(id => {
      const s = res.status[id] || {};
      const st = s.na ? (id === 'social' ? t('soc.off') : t('cond.sourceNa')) : s.fail ? t('cond.sourceFail') : t('cond.sourceOk', { n: s.n || 0 });
      return '<div><b>' + esc(t('src.' + id)) + '</b> · ' + esc(st) + '</div>';
    }).join('') + '</div>';
    list.innerHTML = out;
    $$('[data-more]', list).forEach(b => b.addEventListener('click', () => { b.closest('.rep').classList.add('open'); b.remove(); }));
    $$('[data-fb]', list).forEach(b => b.addEventListener('click', () => {
      const card = b.closest('.rep'), it = res.items[+card.dataset.i], y = +b.dataset.fb;
      BcReportFilter.learn(it.body, y);
      if (!y) card.remove(); else { $$('[data-fb]', card).forEach(x => x.remove()); toast(t('soc.thanks')); }
    }));
    $$('[data-ext]', list).forEach(a => a.addEventListener('click', e => { e.preventDefault(); Native.openExternal(a.dataset.ext); }));
    $('#c-refresh', list).onclick = () => renderConditions(target);
    $('#c-add', list).onclick = () => openPlaceEditor({ lon: c.lon, lat: c.lat, type: 'report' });
  }

  // ------------------------------------------------------------------ Offline
  function renderOffline() {
    setTab('offline', true);
    const regions = Native.listRegions().sort((a, b) => b.created - a.created);
    const st = Native.storageStats();
    const c = map.getCenter();
    let html = head(t('off.title'));
    html += '<div class="band"><span class="eyebrow">' + esc(t('note.label')) + '</span><p>' + esc(t('off.intro')) + '</p></div>';
    html += '<div class="card"><label class="field">' + esc(t('off.name')) + '</label><input class="text" id="o-name" value="' + esc(t('off.defaultName', { place: (App.state.lastPlaceLabel || coordText(c.lng, c.lat)) })) + '">' +
      '<label class="field">' + esc(t('off.detail')) + '</label>' + seg('detail', [['standard', t('off.detail.standard')], ['high', t('off.detail.high')]], 'standard') +
      (S.base !== 'bristlecone' ? toggleRow('incbase', t('off.includeBase', { base: t('base.' + S.base) }), '', false) : '') +
      '<p id="o-est" class="small muted"></p><button class="btn primary block" id="o-go">' + ICON.down + esc(t('off.start')) + '</button></div>';
    html += '<div id="o-regions">' + (regions.length ? regions.map(regionCard).join('') : '<div class="empty-state"><img src="img/mark.svg" alt=""><p>' + esc(t('off.none')) + '</p></div>') + '</div>';
    html += '<h3 class="section">' + esc(t('off.export')) + '</h3><div class="btns"><button class="btn" id="o-img">' + ICON.image + esc(t('off.exportImage')) + '</button><button class="btn" id="o-gpx">' + ICON.route + esc(t('off.exportGpx')) + '</button></div>';
    html += '<h3 class="section">' + esc(t('off.storage')) + '</h3><p class="small muted">' + esc(t('off.used', { cache: fmtBytes(st.cacheBytes), data: fmtBytes(st.dataBytes), free: fmtBytes(st.freeBytes) })) + '</p>' +
      '<button class="btn small" id="o-clear">' + esc(t('off.clearCache')) + '</button> <span class="small muted">' + esc(t('off.clearCacheNote')) + '</span>';
    const body = openSheet(html);
    if (!App.state.lastPlaceLabel) placeContext(c.lng, c.lat).then(ctx => {
      const inp = $('#o-name', body);
      if (ctx.label && inp && inp.isConnected && !inp.dataset.touched) { App.state.lastPlaceLabel = ctx.label; inp.value = t('off.defaultName', { place: ctx.label }); }
    });
    $('#o-name', body).addEventListener('input', e => { e.target.dataset.touched = '1'; });
    const opts = { detail: 'standard', includeBase: false, base: effectiveBase() };
    const est = () => {
      const bbox = viewBbox();
      const e = BcOffline.estimateOnly(bbox, opts);
      const small = map.getZoom() > 14.5;
      $('#o-est', body).textContent = small ? t('off.tooSmall') : e.tooBig ? t('off.tooBig') : t('off.estimate', { tiles: e.tiles.toLocaleString(I18N.dateLocale()), size: fmtBytes(e.bytes) });
      $('#o-go', body).disabled = e.tooBig || small;
      $('#o-go', body).style.opacity = (e.tooBig || small) ? 0.5 : 1;
    };
    bindSeg(body, 'detail', v => { opts.detail = v; est(); });
    const inc = $('[data-toggle="incbase"]', body); if (inc) inc.addEventListener('change', () => { opts.includeBase = inc.checked; est(); });
    est();
    $('#o-go', body).onclick = () => startDownload($('#o-name', body).value.trim() || 'Bristlecone', opts);
    bindRegionCards(body);
    $('#o-clear', body).onclick = () => { Native.clearBrowseCache(); toast(t('off.saved')); };
    $('#o-img', body).onclick = async () => {
      try { const b64 = await BcOffline.mapImage(map, App.state.dark); Native.saveFile('bristlecone-map-' + new Date().toISOString().slice(0, 10) + '.png', 'image/png', b64); }
      catch (e) { toast(t('file.failed', { e: e.message })); }
    };
    $('#o-gpx', body).onclick = () => {
      const bb = viewBbox();
      const inView = (c) => c[0] >= bb[0] && c[0] <= bb[2] && c[1] >= bb[1] && c[1] <= bb[3];
      const trails = data.trails.features.filter(f => f.geometry.coordinates.some(inView));
      const pts = data.points.features.filter(f => inView(f.geometry.coordinates));
      if (!trails.length) { toast(t('off.noTrails')); return; }
      Native.saveFile('bristlecone-trails-' + new Date().toISOString().slice(0, 10) + '.gpx', 'application/gpx+xml', BcOffline.b64(BcOffline.toGpx(trails, pts)));
    };
  }
  function regionCard(r) {
    const prog = App.state.regionProgress[r.id];
    const state = prog ? prog.state : r.state;
    const done = prog ? prog.done : r.done, total = prog ? prog.total : r.total;
    const pct = total ? Math.floor(done / total * 100) : 0;
    const label = state === 'downloading' ? t('off.downloading', { p: pct }) : state === 'ready' ? t('off.ready') : state === 'cancelled' ? t('off.cancelled') : t('off.partial');
    return '<div class="card region" data-region="' + esc(r.id) + '"><div class="row between"><div class="grow"><div class="r-name">' + esc(r.name) + '</div>' +
      '<div class="small ' + (state === 'ready' ? 'status-ok' : 'muted') + '" data-rstate>' + esc(label) + ' · ' + esc(fmtBytes(prog ? prog.bytes : r.bytes)) + ' · ' + esc(new Date(r.created).toLocaleDateString(I18N.dateLocale())) + '</div></div></div>' +
      (state === 'downloading' ? '<div class="bar"><span style="width:' + pct + '%"></span></div>' : '') +
      '<div class="btns"><button class="btn small" data-rshow>' + esc(t('off.show')) + '</button>' +
      (state === 'downloading' ? '<button class="btn small danger" data-rcancel>' + esc(t('off.cancel')) + '</button>' : '<button class="btn small danger" data-rdel>' + esc(t('off.delete')) + '</button>') + '</div></div>';
  }
  function bindRegionCards(body) {
    const regions = Native.listRegions();
    $$('[data-region]', body).forEach(card => {
      const id = card.dataset.region;
      const r = regions.find(x => x.id === id) || {};
      const show = $('[data-rshow]', card); if (show) show.onclick = () => { if (r.bbox) { closeSheet(); map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 30 }); } };
      const cancel = $('[data-rcancel]', card); if (cancel) cancel.onclick = () => Native.cancelRegion(id);
      const del = $('[data-rdel]', card);
      if (del) del.onclick = () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = t('off.deleteConfirm', { name: r.name || '' }); return; }
        Native.deleteRegion(id);
        delete App.state.regionProgress[id];
        card.remove();
      };
    });
  }
  async function startDownload(name, opts) {
    if (!Native.isApp) { toast(t('common.needsApp')); return; }
    const bbox = viewBbox();
    setBusy(1);
    try {
      const plan = await BcOffline.plan(bbox, opts);
      const id = 'r' + Date.now();
      const res = Native.downloadRegion({ id, name, bbox, minZoom: 0, maxZoom: plan.maxZ, layers: Object.keys(S.layers).filter(k => S.layers[k]), urls: plan.urls });
      if (res !== 'ok') throw new Error(res);
      App.state.regionProgress[id] = { id, name, done: 0, total: plan.urls.length, state: 'downloading', bytes: 0 };
      toast(t('toast.downloadStarted'));
      // Seed the saved copies of reports and climbing areas for this area too.
      const c = map.getCenter();
      placeContext(c.lng, c.lat).then(ctx => BcReports.gather({ lon: c.lng, lat: c.lat, country: ctx.country, stateCode: ctx.stateCode, lang: S.lang, npsKey: S.npsKey })).catch(() => { });
      BcData.loadCrags(c.lng, c.lat).catch(() => { });
      if (currentTab === 'offline') renderOffline();
    } catch (e) {
      toast(t('file.failed', { e: e.message }));
    } finally { setBusy(-1); }
  }
  function onRegionProgress(s) {
    const prev = App.state.regionProgress[s.id];
    App.state.regionProgress[s.id] = s;
    if (s.state === 'ready' && (!prev || prev.state !== 'ready')) toast(t('toast.downloadDone', { name: s.name }));
    if (currentTab !== 'offline') return;
    const card = document.querySelector('[data-region="' + s.id + '"]');
    if (!card) return;
    if (s.state !== 'downloading') { renderOffline(); return; }
    const pct = s.total ? Math.floor(s.done / s.total * 100) : 0;
    const bar = $('.bar span', card); if (bar) bar.style.width = pct + '%';
    const st = $('[data-rstate]', card); if (st) st.textContent = t('off.downloading', { p: pct }) + ' · ' + fmtBytes(s.bytes);
  }

  // ------------------------------------------------------------------ Places
  function persistPlaces() {
    Native.kvPutJson('places', App.state.places);
    data.mine = { type: 'FeatureCollection', features: App.state.places.map(p => ({ type: 'Feature', properties: { id: p.id, type: p.type, name: p.name || (p.type === 'report' ? t('rep.' + (p.cat || 'other')) : '') }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
    setData('mine');
  }
  function renderPlaces() {
    setTab('places', true);
    const list = App.state.places.slice().sort((a, b) => b.time - a.time);
    let html = head(t('pl.title'));
    html += '<div class="btns" style="margin-top:0"><button class="btn small primary" id="p-center">' + ICON.pin + esc(t('pl.saveCenter')) + '</button>' +
      (App.state.me && App.state.me.lat != null ? '<button class="btn small" id="p-here">' + ICON.pin + esc(t('pl.saveHere')) + '</button>' : '') +
      '<button class="btn small" id="p-report">' + esc(t('cond.addReport')) + '</button></div>';
    html += '<div id="hikes"></div>';
    if (!list.length) html += '<div class="empty-state"><img src="img/mark.svg" alt=""><p>' + esc(t('pl.none')) + '</p></div>';
    list.forEach(p => {
      html += '<div class="card" data-pid="' + esc(p.id) + '"><div class="kind-tag">' + esc(p.type === 'report' ? t('pl.report') + ' · ' + t('rep.' + (p.cat || 'other')) : t('pl.pin')) + '</div>' +
        '<div style="font-weight:600;margin-top:4px">' + esc(p.name || coordText(p.lon, p.lat)) + '</div>' +
        (p.note ? '<div class="read" style="margin-top:4px">' + esc(p.note) + '</div>' : '') +
        '<div class="small muted" style="margin-top:4px">' + esc(fmtTime(p.time)) + ' · ' + esc(coordText(p.lon, p.lat)) + '</div>' +
        '<div class="btns"><button class="btn small" data-pshow>' + esc(t('pl.show')) + '</button><button class="btn small" data-pedit>' + esc(t('pl.edit')) + '</button><button class="btn small" data-pshare>' + ICON.share + esc(t('pl.share')) + '</button></div></div>';
    });
    const body = openSheet(html);
    if (window.BcRecord && BcRecord.renderHikes($('#hikes', body)) && !list.length) { const es = $('.empty-state', body); if (es) es.remove(); }
    const c = map.getCenter();
    $('#p-center', body).onclick = () => openPlaceEditor({ lon: c.lng, lat: c.lat });
    const here = $('#p-here', body); if (here) here.onclick = () => openPlaceEditor({ lon: App.state.me.lon, lat: App.state.me.lat });
    $('#p-report', body).onclick = () => { const m = App.state.me; openPlaceEditor({ lon: m && m.lat != null ? m.lon : c.lng, lat: m && m.lat != null ? m.lat : c.lat, type: 'report' }); };
    $$('[data-pid]', body).forEach(card => {
      const p = App.state.places.find(x => x.id === card.dataset.pid);
      $('[data-pshow]', card).onclick = () => { closeSheet(); map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14) }); };
      $('[data-pedit]', card).onclick = () => openPlaceEditor(p);
      $('[data-pshare]', card).onclick = () => Native.share((p.name ? p.name + '\n' : '') + (p.note ? p.note + '\n' : '') + coordText(p.lon, p.lat));
    });
  }
  function openPlaceEditor(p) {
    const existing = p.id ? App.state.places.find(x => x.id === p.id) : null;
    const it = Object.assign({ type: 'pin', cat: 'conditions', name: '', note: '' }, existing || p);
    let html = head(existing ? (it.name || t(it.type === 'report' ? 'pl.report' : 'pl.pin')) : t(it.type === 'report' ? 'pl.newReport' : 'pl.newPin'), esc(coordText(it.lon, it.lat)));
    html += seg('ptype', [['pin', t('pl.pin')], ['report', t('pl.report')]], it.type);
    html += '<div id="p-cat-wrap"' + (it.type === 'report' ? '' : ' class="hidden"') + '><label class="field">' + esc(t('pl.type')) + '</label><select class="text" id="p-cat">' +
      ['conditions', 'blowdown', 'water', 'snow', 'closure', 'wildlife', 'other'].map(c => '<option value="' + c + '"' + (c === it.cat ? ' selected' : '') + '>' + esc(t('rep.' + c)) + '</option>').join('') + '</select></div>';
    html += '<label class="field">' + esc(t('pl.name')) + '</label><input class="text" id="p-name" value="' + esc(it.name) + '">';
    html += '<label class="field">' + esc(t('pl.note')) + '</label><textarea class="text" id="p-note">' + esc(it.note) + '</textarea>';
    html += '<p class="small muted">' + esc(t('pl.reportNote')) + '</p>';
    html += '<div class="btns"><button class="btn primary" id="p-save">' + esc(t('pl.save')) + '</button>' + (existing ? '<button class="btn danger" id="p-del">' + esc(t('pl.delete')) + '</button>' : '') + '</div>';
    const body = openSheet(html);
    bindSeg(body, 'ptype', v => { it.type = v; $('#p-cat-wrap', body).classList.toggle('hidden', v !== 'report'); });
    $('#p-save', body).onclick = () => {
      it.name = $('#p-name', body).value.trim();
      it.note = $('#p-note', body).value.trim();
      it.cat = $('#p-cat', body).value;
      if (!existing) { it.id = 'p' + Date.now(); it.time = Date.now(); App.state.places.push(it); }
      else Object.assign(existing, it, { time: existing.type === 'report' && it.note !== existing.note ? Date.now() : existing.time });
      persistPlaces();
      toast(t(it.type === 'report' ? 'toast.reportSaved' : 'toast.pinSaved'));
      renderPlaces();
    };
    const del = $('#p-del', body);
    if (del) del.onclick = () => { App.state.places = App.state.places.filter(x => x.id !== existing.id); persistPlaces(); renderPlaces(); };
  }

  // ------------------------------------------------------------------ Settings
  function renderSettings() {
    setTab('more', true);
    const inf = Native.info();
    const ref = App.state.me && App.state.me.lat != null ? App.state.me : { lat: map.getCenter().lat, lon: map.getCenter().lng };
    const sun = Sun.times(new Date(), ref.lat, ref.lon);
    let html = head(t('set.title'));
    html += '<h3 class="section">' + esc(t('set.language')) + '</h3><select class="text" id="s-lang">' + Object.keys(I18N.LANGS).map(k => '<option value="' + k + '"' + (k === S.lang ? ' selected' : '') + '>' + esc(I18N.LANGS[k].label) + '</option>').join('') + '</select>';
    html += '<h3 class="section">' + esc(t('set.appearance')) + '</h3>' + seg('appear', [['auto', t('appear.auto')], ['light', t('appear.light')], ['dark', t('appear.dark')]], S.appearance);
    html += '<p class="small muted">' + esc(t('appear.auto.d')) + ' ' + esc(t('appear.now', { mode: t(App.state.dark ? 'appear.dark' : 'appear.light'), sunset: fmtClock(sun.sunset) || '·', sunrise: fmtClock(sun.sunrise) || '·' })) + '</p>';
    html += '<h3 class="section">' + esc(t('set.units')) + '</h3>' + seg('units', [['imperial', t('units.imperial')], ['metric', t('units.metric')]], S.units);
    html += '<div style="margin-top:10px">' + toggleRow('keepAwake', t('set.keepAwake'), '', S.keepAwake) + '</div>';
    html += '<h3 class="section">' + esc(t('set.backup')) + '</h3><div class="card"><p class="read" style="margin:0 0 8px">' + esc(t('backup.driveNote')) + '</p>' +
      toggleRow('bkmaps', t('backup.includeMaps'), '', false) +
      '<div class="btns"><button class="btn primary" id="s-backup">' + ICON.drive + esc(t('backup.drive')) + '</button><button class="btn" id="s-restore">' + esc(t('backup.restore')) + '</button></div></div>';
    html += '<h3 class="section">' + esc(t('about.estimates')) + '</h3><p class="read">' + esc(t('about.estimatesBody')) + '</p><p class="small muted">' + esc(inf.strideSamples > 0 ? t('loc.stride', { n: inf.strideSamples }) : t('loc.strideNew')) + '</p><button class="btn small" id="s-stride">' + esc(t('set.strideReset')) + '</button>';
    const soc = S.social || { enabled: true, instances: BcReports.DEFAULT_INSTANCES.map(x => Object.assign({}, x)) };
    html += '<h3 class="section">' + esc(t('soc.title')) + '</h3><div class="card"><p class="read" style="margin:0 0 6px">' + esc(t('soc.intro')) + '</p>' +
      toggleRow('soc-on', t('soc.enable'), '', soc.enabled !== false) +
      soc.instances.map((ins, i) => toggleRow('soc-i-' + i, ins.host, '', ins.on)).join('') +
      '<div class="row" style="margin-top:8px"><input class="text grow" id="soc-add" placeholder="example.social" autocomplete="off" autocapitalize="off"><button class="btn small" id="soc-add-btn">' + esc(t('soc.add')) + '</button></div>' +
      '<p class="small muted">' + esc(t('soc.learned', { n: BcReportFilter.feedbackCount ? BcReportFilter.feedbackCount() : 0 })) + '</p>' +
      '<button class="btn small" id="soc-reset">' + esc(t('soc.reset')) + '</button></div>';
    html += '<h3 class="section">' + esc(t('set.npsKey')) + '</h3><input class="text" id="s-nps" value="' + esc(S.npsKey) + '" placeholder="DEMO_KEY" autocomplete="off"><p class="small muted">' + esc(t('set.npsKeyNote')) + '</p>';
    html += '<h3 class="section">' + esc(t('about.title')) + '</h3><p class="read">' + esc(t('about.story')) + '</p><p class="small muted">' + esc(t('about.privacy')) + '</p>';
    html += '<h3 class="section">' + esc(t('about.credits')) + '</h3><div class="credits">' + CREDITS.map(([n, u, d]) => '<div><a href="#" data-ext="' + esc(u) + '">' + esc(n) + '</a> · ' + esc(d) + '</div>').join('') + '</div>';
    html += '<div class="maker"><img src="img/mark.svg" alt=""><div class="wm">Bristlecone</div><div class="tg">' + esc(t('app.tagline')) + '</div><div class="small muted" style="margin-top:6px">' + esc(t('about.maker')) + ' ' + esc(t('about.version', { v: inf.version })) + '</div></div>';
    const body = openSheet(html);
    $('#s-lang', body).onchange = (e) => {
      S.lang = e.target.value; I18N.lang = S.lang; saveSettings();
      I18N.apply(); landCells.clear(); App.state.placeCache = {};
      applyStyle(); refreshData(); persistPlaces(); renderSettings();
    };
    bindSeg(body, 'appear', v => { S.appearance = v; saveSettings(); applyTheme(true); renderSettings(); });
    bindSeg(body, 'units', v => { S.units = v; saveSettings(); scaleCtl.setUnit(imperial() ? 'imperial' : 'metric'); applyStyle(); if (App.state.me) onLocation(App.state.me); });
    $('[data-toggle="keepAwake"]', body).onchange = (e) => { S.keepAwake = e.target.checked; saveSettings(); Native.keepScreenOn(S.keepAwake); };
    $('#s-backup', body).onclick = () => Native.isApp ? Native.backup($('[data-toggle="bkmaps"]', body).checked, 'bristlecone-backup-' + new Date().toISOString().slice(0, 10) + '.zip') : toast(t('common.needsApp'));
    $('#s-restore', body).onclick = () => Native.restore();
    $('#s-stride', body).onclick = () => { Native.resetStride(); toast(t('off.saved')); };
    $('#s-nps', body).onchange = (e) => { S.npsKey = e.target.value.trim(); saveSettings(); };
    const saveSoc = () => { S.social = soc; saveSettings(); };
    $('[data-toggle="soc-on"]', body).onchange = (e) => { soc.enabled = e.target.checked; saveSoc(); };
    soc.instances.forEach((ins, i) => { $('[data-toggle="soc-i-' + i + '"]', body).onchange = (e) => { ins.on = e.target.checked; saveSoc(); }; });
    $('#soc-add-btn', body).onclick = () => {
      const h = $('#soc-add', body).value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || soc.instances.some(x => x.host === h)) return;
      soc.instances.push({ host: h, on: true }); saveSoc(); renderSettings();
    };
    $('#soc-reset', body).onclick = () => { BcReportFilter.reset(); toast(t('off.saved')); renderSettings(); };
    $$('[data-ext]', body).forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); Native.openExternal(a.dataset.ext); }));
  }
  const CREDITS = [
    ['OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright', 'trails, trailheads, roads, places (ODbL)'],
    ['OpenMapTiles', 'https://openmaptiles.org', 'vector tile schema'],
    ['OpenFreeMap', 'https://openfreemap.org', 'vector tile hosting'],
    ['Overpass API', 'https://overpass-api.de', 'trail data queries'],
    ['AWS Terrain Tiles', 'https://registry.opendata.aws/terrain-tiles/', 'elevation (USGS 3DEP, SRTM, GMTED2010, NRCan CDEM and others)'],
    ['USGS The National Map', 'https://www.usgs.gov/programs/national-geospatial-program/national-map', 'USGS Topo and Imagery base maps'],
    ['USGS PAD-US 4.1', 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview', 'US public and protected lands'],
    ['US Census Bureau TIGERweb', 'https://tigerweb.geo.census.gov', 'American Indian, Alaska Native and Native Hawaiian areas'],
    ['Natural Resources Canada', 'https://natural-resources.canada.ca', 'Canada Base Map, Aboriginal lands and national park boundaries (Open Government Licence Canada)'],
    ['ECCC CPCAD', 'https://www.canada.ca/en/environment-climate-change/services/national-wildlife-areas/protected-conserved-areas-database.html', 'Canadian protected and conserved areas'],
    ['OpenTopoMap', 'https://opentopomap.org', 'topographic base map (CC-BY-SA)'],
    ['USGS NAIP imagery', 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip', 'US satellite and aerial view (public domain)'],
    ['Sentinel-2 cloudless by EOX', 'https://s2maps.eu', 'satellite view outside the US (contains modified Copernicus Sentinel data 2016, CC BY-SA 4.0)'],
    ['Wikipedia and Wikidata', 'https://www.wikipedia.org', 'trail descriptions (CC BY-SA)'],
    ['Wikimedia Commons', 'https://commons.wikimedia.org', 'trail photos, each credited to its photographer'],
    ['Mastodon-compatible servers', 'https://joinmastodon.org', 'public trail reports, filtered on the phone'],
    ['National Weather Service', 'https://www.weather.gov', 'US alerts'],
    ['Environment and Climate Change Canada', 'https://weather.gc.ca', 'Canadian alerts'],
    ['National Park Service', 'https://www.nps.gov/subjects/developer/', 'park alerts and closures'],
    ['NIFC WFIGS', 'https://data-nifc.opendata.arcgis.com', 'current wildfire perimeters'],
    ['Avalanche.org', 'https://avalanche.org', 'US avalanche danger'],
    ['Avalanche Canada', 'https://avalanche.ca', 'Canadian avalanche forecasts'],
    ['OpenBeta', 'https://openbeta.io', 'climbing areas'],
    ['Nominatim', 'https://nominatim.org', 'search and addresses'],
    ['MapLibre GL JS', 'https://maplibre.org', 'map engine (BSD-3-Clause)'],
    ['maplibre-contour', 'https://github.com/onthegomap/maplibre-contour', 'contour lines (BSD-3-Clause)'],
    ['Overpass and Cormorant Garamond', 'https://overpassfont.org', 'typefaces (SIL Open Font License)']
  ];

  // ------------------------------------------------------------------ Search
  let searchSeq = 0;
  function initSearch() {
    const input = $('#search'), res = $('#search-results'), clr = $('#search-clear');
    // Nominatim's usage policy does not allow search-as-you-type, so search runs on Enter only.
    input.addEventListener('input', () => {
      clr.classList.toggle('hidden', !input.value);
      if (input.value.trim().length < 2) res.classList.add('hidden');
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = input.value.trim();
      if (q.length >= 2) { doSearch(q); input.blur(); }
    });
    clr.onclick = () => { input.value = ''; clr.classList.add('hidden'); res.classList.add('hidden'); };
  }
  async function doSearch(q) {
    const res = $('#search-results');
    const seq = ++searchSeq;
    res.classList.remove('hidden');
    // Hiking regions are matched on the phone, so they work offline too.
    const regions = window.BcRegions ? BcRegions.match(q, S.lang) : [];
    const regionHtml = regions.map((r, i) => '<button data-region="' + i + '" class="sr-region"><div class="r-name">' + esc(r.name) + '</div><div class="r-sub">' + esc(t('reg.trailsIn')) + '</div></button>').join('');
    const bindRegions = () => $$('[data-region]', res).forEach(b => b.onclick = () => { res.classList.add('hidden'); $('#search').blur(); setFollow(false); BcRegions.show(regions[+b.dataset.region]); });
    if (!Native.online()) { res.innerHTML = regionHtml + '<div class="empty">' + esc(t('search.offline')) + '</div>'; bindRegions(); return; }
    res.innerHTML = regionHtml + '<div class="empty">' + esc(t('search.searching')) + '</div>';
    bindRegions();
    try {
      const c = map.getCenter();
      const list = await BcData.search(q.replace(/^(trails?|hikes?|senderos?|sentiers?)\s+(in|near|en|dans|de|du|des)\s+/i, ''), S.lang, [c.lng, c.lat]);
      if (seq !== searchSeq) return;
      if (!list.length && !regions.length) { res.innerHTML = '<div class="empty">' + esc(t('search.none')) + '</div>'; return; }
      const isTrail = (r) => r.category === 'highway' && /path|footway|track|bridleway/.test(r.type) || r.category === 'route' || r.type === 'hiking';
      const isArea = (r) => {
        const bb = r.boundingbox && r.boundingbox.map(Number);
        if (!bb) return false;
        const area = (bb[1] - bb[0]) * (bb[3] - bb[2]);
        return area > 0.01 && area < 60 && /boundary|leisure|place/.test(r.category || r.class || '') && /administrative|national_park|protected_area|nature_reserve|park|state|province|county|region/.test(r.type || r.addresstype || '');
      };
      res.innerHTML = regionHtml + list.map((r, i) => {
        const parts = (r.display_name || '').split(', ');
        return '<button data-i="' + i + '"><div class="r-name">' + (isTrail(r) ? '<span class="tag-trail">' + esc(t('reg.trail')) + '</span> ' : '') + esc(r.name || parts[0]) + '</div><div class="r-sub">' + esc(parts.slice(1, 4).join(', ')) + '</div></button>' +
          (isArea(r) ? '<button data-area="' + i + '" class="sr-region"><div class="r-sub">' + esc(t('reg.trailsIn')) + ': ' + esc(r.name || parts[0]) + '</div></button>' : '');
      }).join('');
      bindRegions();
      $$('[data-area]', res).forEach(b => b.onclick = () => {
        const r = list[+b.dataset.area], bb = r.boundingbox.map(Number);
        res.classList.add('hidden'); $('#search').blur(); setFollow(false);
        BcRegions.show({ name: r.name || (r.display_name || '').split(', ')[0], boxes: [[bb[2], bb[0], bb[3], bb[1]]] });
      });
      $$('[data-i]', res).forEach(b => b.onclick = () => {
        const r = list[+b.dataset.i];
        res.classList.add('hidden'); $('#search').blur();
        setFollow(false);
        const lon = +r.lon, lat = +r.lat;
        const name = r.name || (r.display_name || '').split(', ')[0];
        App.state.lastPlaceLabel = name;
        if (isTrail(r) && window.BcRegions) { BcRegions.goToTrail({ name, center: [lon, lat] }); return; }
        const bb = r.boundingbox && r.boundingbox.map(Number);
        if (bb && (bb[1] - bb[0]) > 0.01) map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 40, maxZoom: 15 });
        else map.flyTo({ center: [lon, lat], zoom: 14 });
        const body = openSheet('<div class="kind-tag">' + esc(t('kind.place')) + '</div>' + head(name, esc((r.display_name || '').split(', ').slice(1, 4).join(', '))) + coordBlock(lon, lat) + actions(['conditions', 'directions', 'pin', 'share']), { peek: true });
        bindActions(body, lon, lat, r.name);
      });
    } catch (e) {
      if (seq === searchSeq) { res.innerHTML = regionHtml + '<div class="empty">' + esc(t('search.offline')) + '</div>'; bindRegions(); }
    }
  }

  // ------------------------------------------------------------------ Splash
  const splashStart = Date.now();
  let splashClosed = false;
  function splashDone() {
    if (splashClosed) return;
    splashClosed = true;
    setTimeout(() => { $('#splash').classList.add('fade'); setTimeout(() => $('#splash').remove(), 700); }, Math.max(0, 1500 - (Date.now() - splashStart)));
  }

  // ------------------------------------------------------------------ Native callbacks
  window.bcNative = {
    onLocation: (s) => { try { onLocation(JSON.parse(s)); } catch (e) { console.warn(e); } },
    onPermission: (s) => { const p = JSON.parse(s); if (!p.location) toast(t('loc.permission'), 6000); },
    onRegionProgress: (s) => onRegionProgress(JSON.parse(s)),
    onFileResult: (s) => {
      const r = JSON.parse(s);
      if (!r.ok) { toast(r.error === 'cancelled' ? t('file.cancelled') : t('file.failed', { e: r.error || '' }), 5000); return; }
      if (r.kind === 'backup') toast(t('backup.done', { n: r.count }));
      else if (r.kind === 'restore') { toast(t('restore.done', { n: r.count })); setTimeout(() => location.reload(), 1200); }
      else toast(t('off.saved'));
    },
    onResume: () => { applyTheme(); refreshDataSoon(); if (window.BcRecord) BcRecord.poll(); },
    onRecording: (s) => window.BcRecord && BcRecord.onRecording(JSON.parse(s)),
    onHealthPermission: (s) => window.BcRecord && BcRecord.onHealthPermission(JSON.parse(s)),
    onHealthResult: (s) => window.BcRecord && BcRecord.onHealthResult(JSON.parse(s)),
    onOpenedFor: (s) => { const o = JSON.parse(s); if (o.what === 'health-privacy' && window.BcRecord) BcRecord.healthPrivacy(); }
  };
  window.bc = {
    back() {
      if (!$('#search-results').classList.contains('hidden')) { $('#search-results').classList.add('hidden'); return true; }
      if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
      return false;
    }
  };

  // ------------------------------------------------------------------ Shared helpers for feature modules
  App.ui = {
    t, esc, $, $$, ICON, openSheet, closeSheet, head, toast, toggleRow, seg, bindSeg, setBusy, fmtLen, fmtEle, fmtBytes, fmtTime, ageText,
    coordText, dms, kvRows, coordBlock, actions, bindActions, highlight, lineLength, data, setData, renderConditions, openPlaceEditor, placeContext,
    textLocation, setTab, get map() { return map; }, get imperial() { return imperial(); }, settings: S, saveSettings, applyStyle
  };

  // ------------------------------------------------------------------ Boot
  function boot() {
    I18N.apply();
    const n = 1 + Math.floor(Math.random() * 6);
    $('#splash-note').textContent = t('note.' + n);
    App.state.dark = computeDark();
    document.documentElement.dataset.theme = App.state.dark ? 'dark' : 'light';
    Native.setDark(App.state.dark);
    persistPlacesData();
    initMap();
    initSearch();
    $$('.bottomnav button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#scrim').addEventListener('click', closeSheet);
    $('#btn-layers').onclick = renderLayers;
    $('#btn-locate').onclick = locateTap;
    $('#btn-north').onclick = () => map.easeTo({ bearing: 0, pitch: 0 });
    $('#loc-chip').onclick = showLocationInfo;
    $('#estimate-banner').onclick = showLocationInfo;
    if (S.keepAwake) Native.keepScreenOn(true);
    if (info.locationPermission || !Native.isApp) Native.requestLocation();
    else setTimeout(() => Native.requestLocation(), 1800);
    setInterval(() => applyTheme(), 60000);
    let wasOnline = Native.online();
    setInterval(() => {
      const on = Native.online();
      if (on !== wasOnline) { wasOnline = on; toast(t(on ? 'toast.online' : 'toast.offline')); if (on) refreshData(); }
    }, 8000);
    setTimeout(splashDone, 6000);
    if (info.openedFor === 'health-privacy') setTimeout(() => window.BcRecord && BcRecord.healthPrivacy(), 1800);
  }
  function persistPlacesData() {
    data.mine = { type: 'FeatureCollection', features: App.state.places.map(p => ({ type: 'Feature', properties: { id: p.id, type: p.type, name: p.name || '' }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
  }
  boot();
})();
