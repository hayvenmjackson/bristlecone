/* Recording hikes, rides and other trips, route cards for sharing, GPX, text-my-location and Health Connect. */
(function () {
  const U = App.ui, t = U.t, esc = U.esc, $ = U.$, $$ = U.$$;
  let status = { recording: false };
  let pollTimer = null, lastPointsAt = 0, pendingHealthId = null;

  // ------------------------------------------------------------------ Activity kinds
  // The ids match Activities.java and Activities.swift. onFoot: steps mean something and the
  // learned stride model can estimate position from them; the native side applies the same rule.
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ACTS = [
    { id: 'hike', onFoot: true, icon: svg('<path d="M3 20l6-11 4 6 3-4 5 9z"/><path d="M9 9l1.5 2.5"/>') },
    { id: 'walk', onFoot: true, icon: svg('<circle cx="12" cy="4.5" r="1.8"/><path d="M12 7.5l-1 6 3 3 1 4.5M11 13.5l-2.5 7M11.5 9l-3 2.5M12.5 9l3 2"/>') },
    { id: 'run', onFoot: true, icon: svg('<circle cx="14" cy="4.5" r="1.8"/><path d="M13 8l-3 5 4 2-1 5.5M10 13l-4 1.5M13 8l-4 0.5-2 3M13.5 9l2.5 3 3 0"/>') },
    { id: 'snowshoe', onFoot: true, icon: svg('<ellipse cx="12" cy="12" rx="5" ry="8.5"/><path d="M7.5 9h9M7.5 15h9M12 3.5v17"/>') },
    { id: 'mtb', onFoot: false, icon: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h2.5"/><path d="M1.5 8l3-5 3 5"/>') },
    { id: 'bike', onFoot: false, icon: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h2.5"/>') },
    { id: 'horse', onFoot: false, icon: svg('<path d="M7 4v7a5 5 0 0010 0V4"/><path d="M5 4h4M15 4h4"/><circle cx="9.2" cy="13.5" r="0.6"/><circle cx="14.8" cy="13.5" r="0.6"/><circle cx="12" cy="15.6" r="0.6"/>') },
    { id: 'xcski', onFoot: false, icon: svg('<path d="M3 19l18-3M3 21l18-3M8 5l-2 13M16 4l2 12"/>') },
    { id: 'ski', onFoot: false, icon: svg('<circle cx="15" cy="4.5" r="1.8"/><path d="M4 14l16 7M13 8l-3 4 4 2-1 4M10 12l-3 1M13 8l3 2.5 3-0.5"/>') },
    { id: 'paddle', onFoot: false, icon: svg('<path d="M3 21L17 7"/><path d="M15 9l-1-3 4-4 4 4-4 4z"/><path d="M2 17c2 1.5 4 1.5 6 0s4-1.5 6 0"/>') },
    { id: 'ohv', onFoot: false, icon: svg('<circle cx="6.5" cy="16.5" r="3"/><circle cx="17.5" cy="16.5" r="3"/><path d="M3.5 13l3-5h7l2 3h3.5l1.5 2M9.5 16.5h5M11 8V5h3"/>') }
  ];
  const act = (id) => ACTS.find(a => a.id === id) || ACTS[0];
  const actLabel = (id) => t('act.' + act(id).id);
  function lastActivity() { try { return act(Native.kvGet('lastActivity') || 'hike').id; } catch (e) { return 'hike'; } }
  // ------------------------------------------------------------------ Privacy when sharing
  /** Metres left off each end of a shared route (Settings, Privacy). */
  const trimMetres = () => (U.settings.shareTrim == null ? 200 : Number(U.settings.shareTrim) || 0);

  /** The route without its first and last `m` metres, or [] when too little would be left. */
  function trimEnds(pts, m) {
    if (!m || pts.length < 2) return pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + BcData.haversine(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    if (total < m * 2 + Math.max(100, m)) return [];
    return pts.filter((_, i) => cum[i] >= m && cum[i] <= total - m);
  }

  /** The route as it may be shared, or null (with a note to the person) when trimming leaves nothing. */
  function sharedPoints(pts) {
    const out = trimEnds(pts, trimMetres());
    if (out.length < 2) { U.toast(t('trim.tooShort'), 6000); return null; }
    return out;
  }

  function fmtSpeed(mps) {
    if (!(mps > 0)) return '';
    return U.imperial ? (mps * 2.23694).toFixed(1) + ' ' + t('unit.mph') : (mps * 3.6).toFixed(1) + ' ' + t('unit.kmh');
  }

  // ------------------------------------------------------------------ Formatting
  function fmtDur(ms) {
    if (!ms || ms < 0) return '0:00';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h + ':' + String(m % 60).padStart(2, '0');
  }
  const fmtGain = (m) => U.imperial ? Math.round(m * 3.28084).toLocaleString(I18N.dateLocale()) + ' ' + t('unit.ft') : Math.round(m).toLocaleString(I18N.dateLocale()) + ' ' + t('unit.m');

  // ------------------------------------------------------------------ UI scaffolding
  function init() {
    const fab = document.createElement('button');
    fab.id = 'btn-record'; fab.className = 'fab'; fab.setAttribute('aria-label', t('rec.start'));
    fab.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" class="rec-dot"/></svg>';
    $('.fabs').insertBefore(fab, $('#btn-locate'));
    fab.onclick = () => status.recording ? showBar(true) : confirmStart();
    const bar = document.createElement('div');
    bar.id = 'rec-bar'; bar.className = 'rec-bar hidden';
    bar.innerHTML = '<span class="rec-live"></span><div class="rec-stats"><b id="rec-dist">0</b><span id="rec-time">0:00</span><span id="rec-gain"></span></div>' +
      '<button class="btn small" id="rec-pause"></button><button class="btn small danger" id="rec-stop"></button>';
    $('.topbar').appendChild(bar);
    $('#rec-pause').onclick = () => { status.paused ? Native.trackResume() : Native.trackPause(); setTimeout(poll, 300); };
    $('#rec-stop').onclick = stop;
    poll();
  }

  function confirmStart() {
    let chosen = lastActivity();
    const body = U.openSheet(U.head(t('rec.title')) +
      '<p class="read">' + esc(t('rec.intro')) + '</p>' +
      '<h3 class="section">' + esc(t('rec.pick')) + '</h3>' + actGrid(chosen) +
      '<div class="btns"><button class="btn primary" id="rec-go">' + esc(t('rec.start')) + '</button></div>' +
      '<p class="small muted">' + esc(t('rec.battery')) + '</p>');
    bindActGrid(body, (id) => { chosen = id; });
    $('#rec-go', body).onclick = () => {
      U.closeSheet();
      Native.kvPut('lastActivity', chosen);
      Native.trackStart(t('rec.notifTitle'), t('rec.notifText'), chosen);
      setTimeout(poll, 800);
    };
  }

  function actGrid(value) {
    return '<div class="act-grid" role="radiogroup">' + ACTS.map(a => '<button class="act' + (a.id === value ? ' on' : '') + '" role="radio" aria-checked="' + (a.id === value) + '" data-act="' + a.id + '">' +
      a.icon + '<span>' + esc(actLabel(a.id)) + '</span></button>').join('') + '</div>';
  }
  function bindActGrid(root, fn) {
    $$('[data-act]', root).forEach(b => b.onclick = () => {
      $$('[data-act]', root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      fn(b.dataset.act);
    });
  }

  function showBar(on) { $('#rec-bar').classList.toggle('hidden', !on); }

  async function poll() {
    clearTimeout(pollTimer);
    try { status = JSON.parse((await Native.trackStatus()) || '{}'); } catch (e) { status = { recording: false }; }
    const fab = $('#btn-record');
    if (fab) fab.classList.toggle('recording', !!status.recording);
    if (status.recording) {
      showBar(true);
      $('#rec-dist').textContent = U.fmtLen(status.distance || 0);
      $('#rec-time').textContent = fmtDur(status.movingMs || 0);
      $('#rec-gain').textContent = '↑ ' + fmtGain(status.gain || 0);
      $('#rec-pause').textContent = t(status.paused ? 'rec.resume' : 'rec.pause');
      $('#rec-stop').textContent = t('rec.stop');
      $('#rec-bar').classList.toggle('paused', !!status.paused);
      if (Date.now() - lastPointsAt > 8000) { lastPointsAt = Date.now(); drawTrack(await readPoints(status.id)); }
      pollTimer = setTimeout(poll, 2000);
    } else {
      showBar(false);
    }
  }

  async function readPoints(id) { try { return JSON.parse((await Native.trackPoints(id)) || '[]'); } catch (e) { return []; } }
  async function readMeta(id) { try { return JSON.parse((await Native.trackMeta(id)) || 'null'); } catch (e) { return null; } }

  function drawTrack(pts) {
    const line = pts.map(p => [p[0], p[1]]);
    const feats = [];
    if (line.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
    if (line.length) feats.push({ type: 'Feature', properties: { role: 'start' }, geometry: { type: 'Point', coordinates: line[0] } });
    if (line.length > 1 && !status.recording) feats.push({ type: 'Feature', properties: { role: 'end' }, geometry: { type: 'Point', coordinates: line[line.length - 1] } });
    U.data.track = { type: 'FeatureCollection', features: feats };
    U.setData('track');
  }

  async function stop() {
    clearTimeout(pollTimer);
    const id = await Native.trackStop();
    showBar(false);
    $('#btn-record').classList.remove('recording');
    status = { recording: false };
    if (!id) return;
    // The service writes the summary a moment after it stops.
    let meta = null;
    for (let i = 0; i < 15 && !meta; i++) { await new Promise(r => setTimeout(r, 250)); meta = await readMeta(id); }
    if (!meta) { U.toast(t('rec.tooShort')); U.data.track = { type: 'FeatureCollection', features: [] }; U.setData('track'); return; }
    const place = await U.placeContext(U.map.getCenter().lng, U.map.getCenter().lat).catch(() => ({}));
    if (!meta.name) {
      meta.name = t('rec.defaultName', { activity: actLabel(meta.activity), place: place.label || t('cond.mapCenter'), date: new Date(meta.start).toLocaleDateString(I18N.dateLocale(), { month: 'short', day: 'numeric' }) });
      Native.trackUpdate(JSON.stringify({ id, name: meta.name }));
    }
    openHike(id, true);
  }

  // ------------------------------------------------------------------ A saved hike
  function statsRows(m) {
    const gain = m.gain || m.demGain || 0;
    return [[t('rec.distance'), U.fmtLen(m.distance)], [t('rec.moving'), fmtDur(m.movingMs)], [t('rec.elapsed'), fmtDur(m.elapsedMs)],
      [t('rec.speed'), m.movingMs > 0 ? fmtSpeed(m.distance / (m.movingMs / 1000)) : ''],
      [t('rec.climb'), fmtGain(gain)], [t('rec.steps'), act(m.activity).onFoot && m.steps ? Number(m.steps).toLocaleString(I18N.dateLocale()) : '']];
  }

  /** Cumulative distance (m) for each point, with its time and altitude. */
  function series(pts) {
    const out = []; let d = 0;
    pts.forEach((p, i) => { if (i) d += BcData.haversine(pts[i - 1], p); out.push({ d, t: p[2], alt: p[3] }); });
    return out;
  }

  function profileHtml(ser) {
    const pts = ser.filter(p => p.alt != null);
    if (pts.length < 2 || pts[pts.length - 1].d < 50) return '';
    const sm = pts.map((_, i) => { let n = 0, tot = 0; for (let k = Math.max(0, i - 3); k <= Math.min(pts.length - 1, i + 3); k++) { tot += pts[k].alt; n++; } return tot / n; });
    const W = 340, H = 110, pad = 4, maxX = pts[pts.length - 1].d, minY = Math.min(...sm), maxY = Math.max(...sm);
    const sx = (x) => pad + x / maxX * (W - pad * 2), sy = (y) => H - pad - (maxY === minY ? 0.5 : (y - minY) / (maxY - minY)) * (H - pad * 2 - 10);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p.d).toFixed(1) + ' ' + sy(sm[i]).toFixed(1)).join(' ');
    const area = d + ' L' + sx(maxX).toFixed(1) + ' ' + (H - pad) + ' L' + sx(0).toFixed(1) + ' ' + (H - pad) + ' Z';
    return '<h3 class="section">' + esc(t('td.profile')) + '</h3><svg class="profile" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(t('td.profile')) + '">' +
      '<path d="' + area + '" class="p-area"/><path d="' + d + '" class="p-line"/></svg>' +
      '<div class="row between small muted"><span>' + esc(U.fmtEle(minY)) + '</span><span>' + esc(U.fmtEle(maxY)) + '</span></div>';
  }

  /** Time and climb for each mile or kilometre. */
  function splitsHtml(ser) {
    const unit = U.imperial ? 1609.344 : 1000;
    if (ser.length < 2 || ser[ser.length - 1].d < unit) return '';
    const rows = []; let start = ser[0], climb = 0, prevAlt = ser[0].alt, next = unit;
    for (let i = 1; i < ser.length; i++) {
      const p = ser[i];
      if (p.alt != null && prevAlt != null && p.alt > prevAlt) climb += p.alt - prevAlt;
      if (p.alt != null) prevAlt = p.alt;
      if (p.d >= next || i === ser.length - 1) {
        const len = p.d - start.d;
        if (len >= unit * 0.2) rows.push({ n: rows.length + 1, ms: p.t - start.t, climb, part: len < unit * 0.98 ? len / unit : 0 });
        start = p; climb = 0; next += unit;
      }
    }
    const lab = U.imperial ? t('unit.mi') : t('unit.km');
    return '<h3 class="section">' + esc(t('rec.splits')) + '</h3><table class="splits"><tr><th>' + esc(lab) + '</th><th>' + esc(t('rec.splitTime')) + '</th><th>' + esc(t('rec.climb')) + '</th></tr>' +
      rows.map(r => '<tr><td>' + (r.part ? r.part.toLocaleString(I18N.dateLocale(), { maximumFractionDigits: 2 }) : r.n) + '</td><td>' + esc(fmtDur(r.ms)) + '</td><td>' + esc(fmtGain(r.climb)) + '</td></tr>').join('') + '</table>';
  }

  /** fresh: just recorded, so no unlock is needed to see it. */
  async function openHike(id, fresh) {
    if (!fresh && !U.isUnlocked()) { U.whenUnlocked(() => openHike(id, true)); return; }
    const m = await readMeta(id);
    if (!m) return;
    const pts = await readPoints(id);
    drawTrack(pts);
    fit(pts.map(p => [p[0], p[1]]));
    const info = Native.info();
    const ser = series(pts);
    const healthOk = m.activity !== 'ohv';
    let html = '<div class="kind-tag">' + act(m.activity).icon + esc(actLabel(m.activity)) + '</div>' + U.head(m.name || t('rec.hike'), esc(new Date(m.start).toLocaleString(I18N.dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })));
    html += U.kvRows(statsRows(m));
    if (!m.barometer) html += '<p class="small muted">' + esc(t('rec.gpsClimb')) + '</p>';
    html += profileHtml(ser) + splitsHtml(ser);
    html += '<label class="field">' + esc(t('pl.name')) + '</label><input class="text" id="h-name" value="' + esc(m.name || '') + '">';
    html += '<label class="field">' + esc(t('rec.activity')) + '</label><select class="text" id="h-act">' + ACTS.map(a => '<option value="' + a.id + '"' + (a.id === act(m.activity).id ? ' selected' : '') + '>' + esc(actLabel(a.id)) + '</option>').join('') + '</select>';
    html += '<label class="field">' + esc(t('rec.notes')) + '</label><textarea class="text" id="h-notes" rows="3" placeholder="' + esc(t('rec.notesPh')) + '">' + esc(m.notes || '') + '</textarea>';
    if (trimMetres()) html += '<p class="small muted">' + esc(t('trim.note', { dist: U.fmtLen(trimMetres()) })) + '</p>';
    html += '<div class="btns"><button class="btn" id="h-replay">' + ICON_PLAY + esc(t('rec.replay')) + '</button></div>';
    html += '<div class="btns"><button class="btn primary" id="h-card">' + U.ICON.image + esc(t('rec.shareCard')) + '</button>' +
      '<button class="btn" id="h-gpx">' + U.ICON.route + esc(t('rec.shareGpx')) + '</button>' +
      (info.health && healthOk ? '<button class="btn" id="h-health">' + esc(m.healthSynced ? t('health.synced') : t('health.save')) + '</button>' : '') + '</div>';
    if (!info.health) html += '<p class="small muted">' + esc(t('health.needs14')) + '</p>';
    else if (!healthOk) html += '<p class="small muted">' + esc(t('rec.noHealth')) + '</p>';
    html += '<p class="small muted">' + esc(t('hist.private')) + '</p>';
    html += '<div class="btns"><button class="btn small danger" id="h-del">' + esc(t('pl.delete')) + '</button></div>';
    const body = U.openSheet(html, { peek: true, onClose: () => { if (!status.recording) { U.data.track = { type: 'FeatureCollection', features: [] }; U.setData('track'); } } });
    $('#h-name', body).onchange = (e) => Native.trackUpdate(JSON.stringify({ id, name: e.target.value.trim() }));
    $('#h-notes', body).onchange = (e) => Native.trackUpdate(JSON.stringify({ id, notes: e.target.value.trim() }));
    $('#h-act', body).onchange = async (e) => { await Native.trackUpdate(JSON.stringify({ id, activity: e.target.value })); openHike(id); };
    $('#h-replay', body).onclick = () => replay(id, m, pts);
    $('#h-card', body).onclick = () => {
      const shared = sharedPoints(pts);
      if (!shared) return;
      shareCard({
      title: $('#h-name', body).value.trim() || m.name, date: m.start, line: shared.map(p => [p[0], p[1]]),
      stats: [[t('rec.distance'), U.fmtLen(m.distance)], [t('rec.moving'), fmtDur(m.movingMs)], [t('rec.climb'), fmtGain(m.gain || m.demGain || 0)]],
      caption: t('rec.caption', { name: $('#h-name', body).value.trim() || m.name, dist: U.fmtLen(m.distance), gain: fmtGain(m.gain || 0), time: fmtDur(m.movingMs) }),
      filename: 'bristlecone-' + act(m.activity).id + '-' + new Date(m.start).toISOString().slice(0, 10) + '.png'
      });
    };
    $('#h-gpx', body).onclick = () => {
      const shared = sharedPoints(pts);
      if (!shared) return;
      const gpx = BcOffline.toGpxTrack($('#h-name', body).value.trim() || m.name, shared, act(m.activity).id, $('#h-notes', body).value.trim());
      Native.shareFile(BcOffline.b64(gpx), 'bristlecone-' + act(m.activity).id + '-' + new Date(m.start).toISOString().slice(0, 10) + '.gpx', 'application/gpx+xml', m.name);
    };
    const hb = $('#h-health', body);
    if (hb) hb.onclick = () => { pendingHealthId = id; Native.healthRequest(); };
    $('#h-del', body).onclick = (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('rec.deleteConfirm'); return; }
      Native.trackDelete(id); U.closeSheet(); U.toast(t('off.saved'));
      if (window.BcHistory) BcHistory.forget(id);
    };
  }

  function fit(line, padding, duration) {
    if (line.length < 2) { if (line.length) U.map.jumpTo({ center: line[0], zoom: 15 }); return; }
    let w = 180, s = 90, e = -180, n = -90;
    line.forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); });
    U.map.fitBounds([[w, s], [e, n]], { padding: padding || { top: 80, bottom: 320, left: 40, right: 40 }, duration: duration == null ? 600 : duration, maxZoom: 16 });
  }

  /** Padding that keeps the route inside the part of the screen the card keeps (a 1080 x 930 crop). */
  function cardPadding() {
    const c = U.map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    const keepW = Math.min(w, h * 1080 / 930), keepH = Math.min(h, w * 930 / 1080);
    const side = Math.max(24, (w - keepW) / 2 + keepW * 0.1), vert = Math.max(24, (h - keepH) / 2 + keepH * 0.1);
    return { top: vert, bottom: vert, left: side, right: side };
  }

  async function listTracks() {
    let list = [];
    try { list = JSON.parse((await Native.trackList()) || '[]'); } catch (e) { list = []; }
    return list.sort((a, b) => b.start - a.start);
  }

  /** The Places tab shows the latest three and a way into the full history. */
  async function renderHikes(el) {
    if (!el) return 0;
    const list = await listTracks();
    if (!list.length) { el.innerHTML = ''; return 0; }
    el.innerHTML = '<div class="row between"><h3 class="section">' + esc(t('rec.hikes')) + '</h3><button class="btn small" id="hist-all">' + esc(t('hist.open')) + '</button></div>' +
      list.slice(0, 3).map(itemHtml).join('');
    bindItems(el);
    $('#hist-all', el).onclick = () => window.BcHistory && BcHistory.open();
    return list.length;
  }
  function itemHtml(m) {
    return '<div class="card hist-item" data-hike="' + esc(m.id) + '"><div class="row between"><span class="act-icon">' + act(m.activity).icon + '</span><div class="grow"><div style="font-weight:600">' + esc(m.name || actLabel(m.activity)) + '</div>' +
      '<div class="small muted">' + esc(new Date(m.start).toLocaleDateString(I18N.dateLocale(), { dateStyle: 'medium' })) + ' · ' + esc(U.fmtLen(m.distance)) + ' · ↑ ' + esc(fmtGain(m.gain || m.demGain || 0)) + ' · ' + esc(fmtDur(m.movingMs)) + '</div></div>' +
      '<button class="btn small" data-open>' + esc(t('pl.show')) + '</button></div></div>';
  }
  function bindItems(el) { $$('[data-hike]', el).forEach(c => { $('[data-open]', c).onclick = () => openHike(c.dataset.hike); }); }

  // ------------------------------------------------------------------ Replay
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
  let rp = null;

  /** Moves a marker along the route by distance, so pauses in the recording do not stall it. */
  function replay(id, m, pts) {
    if (pts.length < 2) return;
    endReplay();
    U.closeSheet();
    drawTrack(pts);
    fit(pts.map(p => [p[0], p[1]]), { top: 90, bottom: 200, left: 40, right: 40 });
    const ser = series(pts), total = ser[ser.length - 1].d;
    const el = document.createElement('div'); el.className = 'replay-dot';
    const marker = new maplibregl.Marker({ element: el }).setLngLat([pts[0][0], pts[0][1]]).addTo(U.map);
    const bar = document.createElement('div');
    bar.className = 'replay-bar';
    bar.innerHTML = '<button class="btn small primary" id="rp-play" aria-label="' + esc(t('rec.replay')) + '">' + ICON_PAUSE + '</button>' +
      '<div class="grow"><input type="range" id="rp-pos" min="0" max="1000" value="0" aria-label="' + esc(t('rec.replay')) + '"><div class="row between small"><span id="rp-dist"></span><span id="rp-time"></span></div></div>' +
      '<button class="btn small" id="rp-speed">1×</button><button class="close" id="rp-close" aria-label="' + esc(t('common.close')) + '"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    document.body.appendChild(bar);
    document.body.classList.add('replaying');
    rp = { marker, bar, pos: 0, playing: true, speed: 1, last: 0, drawn: 0, raf: 0, id };
    const DURATION = 20000; // the whole route in 20 seconds at 1×
    const show = () => {
      const target = rp.pos * total;
      let i = 1; while (i < ser.length - 1 && ser[i].d < target) i++;
      const a = ser[i - 1], b = ser[i], f = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
      const lon = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, lat = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
      rp.marker.setLngLat([lon, lat]);
      $('#rp-pos').value = String(Math.round(rp.pos * 1000));
      $('#rp-dist').textContent = U.fmtLen(target) + ' / ' + U.fmtLen(total);
      $('#rp-time').textContent = fmtDur(a.t + (b.t - a.t) * f - ser[0].t);
      // The part already covered is drawn over the route, a few times a second.
      if (performance.now() - rp.drawn > 120) {
        rp.drawn = performance.now();
        const done = pts.slice(0, i).map(p => [p[0], p[1]]).concat([[lon, lat]]);
        U.data.hl = { type: 'FeatureCollection', features: done.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } }] : [] };
        U.setData('hl');
      }
    };
    const frame = (now) => {
      if (!rp) return;
      if (rp.playing) {
        if (rp.last) rp.pos = Math.min(1, rp.pos + (now - rp.last) * rp.speed / DURATION);
        show();
        if (rp.pos >= 1) { rp.playing = false; $('#rp-play').innerHTML = ICON_PLAY; }
      }
      rp.last = now;
      rp.raf = requestAnimationFrame(frame);
    };
    $('#rp-play').onclick = () => {
      if (rp.pos >= 1) rp.pos = 0;
      rp.playing = !rp.playing; rp.last = 0;
      $('#rp-play').innerHTML = rp.playing ? ICON_PAUSE : ICON_PLAY;
    };
    $('#rp-pos').oninput = (e) => { rp.pos = Number(e.target.value) / 1000; rp.drawn = 0; show(); };
    $('#rp-speed').onclick = () => { rp.speed = rp.speed >= 4 ? 1 : rp.speed * 2; $('#rp-speed').textContent = rp.speed + '×'; };
    $('#rp-close').onclick = () => { endReplay(); openHike(id, true); };
    show();
    rp.raf = requestAnimationFrame(frame);
  }

  function endReplay() {
    if (!rp) return;
    cancelAnimationFrame(rp.raf);
    rp.marker.remove(); rp.bar.remove();
    document.body.classList.remove('replaying');
    rp = null;
    U.data.hl = { type: 'FeatureCollection', features: [] }; U.setData('hl');
  }

  // ------------------------------------------------------------------ Route card image
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

  async function captureMap() {
    const map = U.map;
    await new Promise(res => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; map.once('idle', fin); setTimeout(fin, 6000); });
    return new Promise((resolve) => { map.once('render', () => resolve(map.getCanvas())); map.triggerRepaint(); })
      .then(src => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; });
  }

  /** A 1080 x 1350 image (the portrait size Instagram, TikTok and others favour): map on top, stats below. */
  async function shareCard(o) {
    U.setBusy(1);
    try {
      if (o.line && o.line.length) {
        U.closeSheet();
        if (o.trail) { U.data.hl = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: o.line } }] }; U.setData('hl'); }
        else drawTrack(o.line.map(p => [p[0], p[1], 0, null]));
        fit(o.line, cardPadding(), 0);
      }
      // Canvas text only uses fonts the page has loaded, so load them first.
      if (document.fonts && document.fonts.load) {
        await Promise.all(['600 64px "Cormorant Garamond"', 'italic 500 26px "Cormorant Garamond"', '700 50px Overpass', '600 24px Overpass'].map(f => document.fonts.load(f).catch(() => null)));
      }
      const mapCanvas = await captureMap();
      const W = 1080, H = 1350, MH = 930;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const sw = mapCanvas.width, sh = mapCanvas.height, scale = Math.max(W / sw, MH / sh);
      const dw = sw * scale, dh = sh * scale;
      g.drawImage(mapCanvas, (W - dw) / 2, (MH - dh) / 2, dw, dh);
      const grad = g.createLinearGradient(0, MH, W, H); grad.addColorStop(0, '#0F3D2E'); grad.addColorStop(1, '#1F6B4A');
      g.fillStyle = grad; g.fillRect(0, MH, W, H - MH);
      g.fillStyle = '#C9A227'; g.fillRect(0, MH, W, 8);
      g.fillStyle = '#F4EFDF'; g.font = '600 64px "Cormorant Garamond", Georgia, serif'; g.textBaseline = 'alphabetic';
      let title = o.title || 'Bristlecone';
      while (g.measureText(title).width > W - 120 && title.length > 4) title = title.slice(0, -2);
      if (title !== (o.title || 'Bristlecone')) title = title.trim() + '…';
      g.fillText(title, 60, MH + 104);
      const colW = (W - 120) / Math.max(1, o.stats.length);
      o.stats.forEach(([label, value], i) => {
        const x = 60 + i * colW;
        g.fillStyle = '#FFFFFF'; g.font = '700 50px Overpass, sans-serif'; g.fillText(value, x, MH + 214);
        g.fillStyle = '#E6CD7A'; g.font = '600 24px Overpass, sans-serif'; g.fillText(label.toUpperCase(), x, MH + 254);
      });
      try { const mark = await loadImage('img/mark.svg'); g.drawImage(mark, 60, H - 104, 56, 56); } catch (e) { /* the card still works without the mark */ }
      g.fillStyle = '#F4EFDF'; g.font = '700 26px Overpass, sans-serif'; g.fillText('BRISTLECONE', 130, H - 70);
      g.fillStyle = 'rgba(244,239,223,0.75)'; g.font = 'italic 500 26px "Cormorant Garamond", serif'; g.fillText(t('app.tagline'), 130, H - 40);
      g.textAlign = 'right'; g.fillStyle = 'rgba(244,239,223,0.6)'; g.font = '500 18px Overpass, sans-serif';
      if (o.date) g.fillText(new Date(o.date).toLocaleDateString(I18N.dateLocale(), { dateStyle: 'medium' }), W - 60, H - 70);
      g.fillText('© OpenStreetMap contributors', W - 60, H - 42);
      const b64 = c.toDataURL('image/png').split(',')[1];
      Native.shareFile(b64, o.filename || 'bristlecone.png', 'image/png', o.caption || '');
    } catch (e) {
      U.toast(t('file.failed', { e: e.message }));
    } finally { U.setBusy(-1); }
  }

  // ------------------------------------------------------------------ Health Connect
  function onHealthPermission(r) {
    if (r.unavailable) { U.toast(t('health.needs14')); return; }
    if (!r.granted) { U.toast(t('health.denied'), 5000); return; }
    if (pendingHealthId) { Native.healthWrite(pendingHealthId); }
  }
  function onHealthResult(r) {
    pendingHealthId = null;
    U.toast(r.ok ? t('health.done') : t('file.failed', { e: r.error || '' }), 4000);
    const b = document.getElementById('h-health'); if (b && r.ok) b.textContent = t('health.synced');
  }
  function healthPrivacy() {
    U.openSheet(U.head(t('health.privacyTitle')) + '<p class="read">' + esc(t('health.privacyBody')) + '</p><p class="small muted">' + esc(t('about.privacy')) + '</p>');
  }
  function onRecording(r) { if (!r.started) U.toast(t('loc.permission'), 5000); setTimeout(poll, 600); }

  window.BcRecord = { init, poll, renderHikes, openHike, listTracks, readPoints, trimEnds, trimMetres, sharedPoints, endReplay, ACTS, act, actLabel, fmtSpeed, shareCard, onHealthPermission, onHealthResult, onRecording, healthPrivacy, fmtDur, fmtGain, fit };
  init();
})();
