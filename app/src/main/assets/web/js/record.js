/* Recording hikes, route cards for sharing, GPX, text-my-location and Health Connect. */
(function () {
  const U = App.ui, t = U.t, esc = U.esc, $ = U.$, $$ = U.$$;
  let status = { recording: false };
  let pollTimer = null, lastPointsAt = 0, pendingHealthId = null;

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
    const body = U.openSheet(U.head(t('rec.title')) +
      '<p class="read">' + esc(t('rec.intro')) + '</p>' +
      '<div class="btns"><button class="btn primary" id="rec-go">' + esc(t('rec.start')) + '</button></div>' +
      '<p class="small muted">' + esc(t('rec.battery')) + '</p>');
    $('#rec-go', body).onclick = () => {
      U.closeSheet();
      Native.trackStart(t('rec.notifTitle'), t('rec.notifText'));
      setTimeout(poll, 800);
    };
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
      meta.name = t('rec.defaultName', { place: place.label || t('cond.mapCenter'), date: new Date(meta.start).toLocaleDateString(I18N.dateLocale(), { month: 'short', day: 'numeric' }) });
      Native.trackUpdate(JSON.stringify({ id, name: meta.name }));
    }
    openHike(id);
  }

  // ------------------------------------------------------------------ A saved hike
  function statsRows(m) {
    const gain = m.gain || m.demGain || 0;
    return [[t('rec.distance'), U.fmtLen(m.distance)], [t('rec.moving'), fmtDur(m.movingMs)], [t('rec.elapsed'), fmtDur(m.elapsedMs)],
      [t('rec.climb'), fmtGain(gain)], [t('rec.steps'), m.steps ? Number(m.steps).toLocaleString(I18N.dateLocale()) : '']];
  }

  async function openHike(id) {
    const m = await readMeta(id);
    if (!m) return;
    const pts = await readPoints(id);
    drawTrack(pts);
    fit(pts.map(p => [p[0], p[1]]));
    const info = Native.info();
    let html = '<div class="kind-tag">' + esc(t('rec.hike')) + '</div>' + U.head(m.name || t('rec.hike'), esc(new Date(m.start).toLocaleString(I18N.dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })));
    html += U.kvRows(statsRows(m));
    if (!m.barometer) html += '<p class="small muted">' + esc(t('rec.gpsClimb')) + '</p>';
    html += '<label class="field">' + esc(t('pl.name')) + '</label><input class="text" id="h-name" value="' + esc(m.name || '') + '">';
    html += '<div class="btns"><button class="btn primary" id="h-card">' + U.ICON.image + esc(t('rec.shareCard')) + '</button>' +
      '<button class="btn" id="h-gpx">' + U.ICON.route + esc(t('rec.shareGpx')) + '</button>' +
      (info.health ? '<button class="btn" id="h-health">' + esc(m.healthSynced ? t('health.synced') : t('health.save')) + '</button>' : '') + '</div>';
    if (!info.health) html += '<p class="small muted">' + esc(t('health.needs14')) + '</p>';
    html += '<div class="btns"><button class="btn small danger" id="h-del">' + esc(t('pl.delete')) + '</button></div>';
    const body = U.openSheet(html, { peek: true, onClose: () => { if (!status.recording) { U.data.track = { type: 'FeatureCollection', features: [] }; U.setData('track'); } } });
    $('#h-name', body).onchange = (e) => Native.trackUpdate(JSON.stringify({ id, name: e.target.value.trim() }));
    $('#h-card', body).onclick = () => shareCard({
      title: $('#h-name', body).value.trim() || m.name, date: m.start, line: pts.map(p => [p[0], p[1]]),
      stats: [[t('rec.distance'), U.fmtLen(m.distance)], [t('rec.moving'), fmtDur(m.movingMs)], [t('rec.climb'), fmtGain(m.gain || m.demGain || 0)]],
      caption: t('rec.caption', { name: $('#h-name', body).value.trim() || m.name, dist: U.fmtLen(m.distance), gain: fmtGain(m.gain || 0), time: fmtDur(m.movingMs) }),
      filename: 'bristlecone-hike-' + new Date(m.start).toISOString().slice(0, 10) + '.png'
    });
    $('#h-gpx', body).onclick = () => {
      const gpx = BcOffline.toGpxTrack($('#h-name', body).value.trim() || m.name, pts);
      Native.shareFile(BcOffline.b64(gpx), 'bristlecone-hike-' + new Date(m.start).toISOString().slice(0, 10) + '.gpx', 'application/gpx+xml', m.name);
    };
    const hb = $('#h-health', body);
    if (hb) hb.onclick = () => { pendingHealthId = id; Native.healthRequest(); };
    $('#h-del', body).onclick = (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('rec.deleteConfirm'); return; }
      Native.trackDelete(id); U.closeSheet(); U.toast(t('off.saved'));
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

  async function renderHikes(el) {
    if (!el) return 0;
    let list = [];
    try { list = JSON.parse((await Native.trackList()) || '[]'); } catch (e) { list = []; }
    list.sort((a, b) => b.start - a.start);
    if (!list.length) { el.innerHTML = ''; return 0; }
    el.innerHTML = '<h3 class="section">' + esc(t('rec.hikes')) + '</h3>' + list.map(m =>
      '<div class="card" data-hike="' + esc(m.id) + '"><div class="row between"><div class="grow"><div style="font-weight:600">' + esc(m.name || t('rec.hike')) + '</div>' +
      '<div class="small muted">' + esc(new Date(m.start).toLocaleDateString(I18N.dateLocale(), { dateStyle: 'medium' })) + ' · ' + esc(U.fmtLen(m.distance)) + ' · ↑ ' + esc(fmtGain(m.gain || m.demGain || 0)) + ' · ' + esc(fmtDur(m.movingMs)) + '</div></div>' +
      '<button class="btn small" data-open>' + esc(t('pl.show')) + '</button></div></div>').join('');
    $$('[data-hike]', el).forEach(c => { $('[data-open]', c).onclick = () => openHike(c.dataset.hike); });
    return list.length;
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

  window.BcRecord = { init, poll, renderHikes, shareCard, onHealthPermission, onHealthResult, onRecording, healthPrivacy, fmtDur, fmtGain, fit };
  init();
})();
