/* Activity history: every recorded hike, ride and trip, with totals, filters and search.
   Everything here is read from files on this device; nothing is sent anywhere. */
(function () {
  const U = App.ui, t = U.t, esc = U.esc, $ = U.$, $$ = U.$$;
  const R = () => window.BcRecord;
  const state = { kind: 'all', period: 'year', q: '' };
  let list = [];
  const previewQueue = new Set();

  // ------------------------------------------------------------------ Periods and totals
  function periodStart(period, now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    if (period === 'week') {
      // Weeks start on Sunday in the US and on Monday elsewhere.
      const first = I18N.dateLocale() === 'en-US' || I18N.dateLocale() === 'es-US' ? 0 : 1;
      d.setDate(d.getDate() - ((d.getDay() - first + 7) % 7));
    } else if (period === 'month') d.setDate(1);
    else if (period === 'year') d.setMonth(0, 1);
    else return 0;
    return d.getTime();
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return list.filter(m => (state.kind === 'all' || R().act(m.activity).id === state.kind) &&
      (!q || (m.name || '').toLowerCase().includes(q) || (m.notes || '').toLowerCase().includes(q)));
  }

  function totals(items) {
    const from = periodStart(state.period, Date.now());
    const inPeriod = items.filter(m => m.start >= from);
    const sum = (f) => inPeriod.reduce((a, m) => a + (f(m) || 0), 0);
    return { n: inPeriod.length, dist: sum(m => m.distance), ms: sum(m => m.movingMs), gain: sum(m => m.gain || m.demGain) };
  }

  // ------------------------------------------------------------------ Route thumbnails
  /** A route squeezed into a 0..100 box as "x,y x,y ...", small enough to keep in the summary file. */
  function makePreview(pts) {
    if (pts.length < 2) return '';
    const k = Math.cos(pts[0][1] * Math.PI / 180);
    const xy = pts.map(p => [p[0] * k, -p[1]]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    xy.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const span = Math.max(x1 - x0, y1 - y0) || 1e-9, ox = (span - (x1 - x0)) / 2, oy = (span - (y1 - y0)) / 2;
    const step = Math.max(1, Math.floor(xy.length / 60));
    const out = [];
    for (let i = 0; i < xy.length; i += step) out.push(xy[i]);
    if (out[out.length - 1] !== xy[xy.length - 1]) out.push(xy[xy.length - 1]);
    return out.map(([x, y]) => Math.round((x - x0 + ox) / span * 100) + ',' + Math.round((y - y0 + oy) / span * 100)).join(' ');
  }

  function thumb(m) {
    if (!m.preview) return '<div class="hist-thumb" data-thumb="' + esc(m.id) + '">' + R().act(m.activity).icon + '</div>';
    return '<div class="hist-thumb"><svg viewBox="-6 -6 112 112" aria-hidden="true"><polyline points="' + esc(m.preview) + '"/></svg></div>';
  }

  /** Builds missing thumbnails one at a time and saves them, so the next visit is instant. */
  async function fillPreviews(root) {
    const ids = $$('[data-thumb]', root).map(el => el.dataset.thumb).filter(id => !previewQueue.has(id));
    for (const id of ids) {
      previewQueue.add(id);
      const pts = await R().readPoints(id);
      const preview = makePreview(pts);
      if (!preview) continue;
      const m = list.find(x => x.id === id);
      if (m) m.preview = preview;
      Native.trackUpdate(JSON.stringify({ id, preview }));
      const el = root.querySelector('[data-thumb="' + CSS.escape(id) + '"]');
      if (el) el.outerHTML = thumb(m || { id, preview });
    }
  }

  // ------------------------------------------------------------------ The sheet
  async function open() {
    if (!U.isUnlocked()) { U.whenUnlocked(open); return; }
    list = await R().listTracks();
    const kinds = R().ACTS.filter(a => list.some(m => R().act(m.activity).id === a.id));
    if (state.kind !== 'all' && !kinds.some(a => a.id === state.kind)) state.kind = 'all';
    let html = U.head(t('hist.title'), esc(t('hist.private')));
    if (!list.length) {
      html += '<div class="empty-state"><img src="img/mark.svg" alt=""><p>' + esc(t('hist.none')) + '</p></div>';
      U.openSheet(html);
      return;
    }
    html += U.seg('hist-period', [['week', t('hist.week')], ['month', t('hist.month')], ['year', t('hist.year')], ['all', t('hist.ever')]], state.period);
    html += '<div id="hist-totals" class="hist-totals"></div>';
    if (kinds.length > 1) {
      html += '<div class="chips" id="hist-kinds"><button class="chip' + (state.kind === 'all' ? ' on' : '') + '" data-kind="all">' + esc(t('hist.all')) + '</button>' +
        kinds.map(a => '<button class="chip' + (state.kind === a.id ? ' on' : '') + '" data-kind="' + a.id + '">' + a.icon + esc(R().actLabel(a.id)) + '</button>').join('') + '</div>';
    }
    html += '<input class="text" id="hist-q" type="search" placeholder="' + esc(t('hist.search')) + '" value="' + esc(state.q) + '">';
    html += '<div id="hist-list"></div>';
    html += '<div class="btns"><button class="btn" id="hist-gpx">' + U.ICON.route + esc(t('hist.export')) + '</button></div>';
    const body = U.openSheet(html);
    U.bindSeg(body, 'hist-period', (v) => { state.period = v; renderTotals(body); });
    $$('[data-kind]', body).forEach(b => b.onclick = () => {
      state.kind = b.dataset.kind;
      $$('[data-kind]', body).forEach(x => x.classList.toggle('on', x === b));
      renderTotals(body); renderList(body);
    });
    $('#hist-q', body).oninput = (e) => { state.q = e.target.value; renderTotals(body); renderList(body); };
    $('#hist-gpx', body).onclick = () => exportGpx(filtered());
    renderTotals(body);
    renderList(body);
  }

  /** The trips in view as one GPX file, with the same start and finish trimming as other shares. */
  async function exportGpx(items) {
    if (!items.length) return;
    U.setBusy(1);
    try {
      const tracks = [];
      for (const m of items) {
        const pts = R().trimEnds(await R().readPoints(m.id), R().trimMetres());
        if (pts.length > 1) tracks.push({ name: m.name || R().actLabel(m.activity), activity: R().act(m.activity).id, notes: m.notes || '', pts });
      }
      if (!tracks.length) { U.toast(t('trim.tooShort'), 6000); return; }
      const gpx = BcOffline.toGpxTracks(t('hist.title'), tracks);
      Native.shareFile(BcOffline.b64(gpx), 'bristlecone-activities-' + new Date().toISOString().slice(0, 10) + '.gpx', 'application/gpx+xml', t('hist.title'));
    } finally { U.setBusy(-1); }
  }

  function renderTotals(body) {
    const x = totals(filtered());
    const tile = (v, l) => '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>';
    $('#hist-totals', body).innerHTML = tile(String(x.n), t('hist.trips')) + tile(U.fmtLen(x.dist), t('rec.distance')) +
      tile(R().fmtDur(x.ms), t('rec.moving')) + tile(R().fmtGain(x.gain), t('rec.climb'));
  }

  function renderList(body) {
    const items = filtered();
    const el = $('#hist-list', body);
    if (!items.length) { el.innerHTML = '<p class="read muted">' + esc(t('hist.noMatch')) + '</p>'; return; }
    let html = '', month = '';
    items.forEach(m => {
      const mo = new Date(m.start).toLocaleDateString(I18N.dateLocale(), { month: 'long', year: 'numeric' });
      if (mo !== month) { month = mo; html += '<h3 class="section">' + esc(mo) + '</h3>'; }
      const sub = [new Date(m.start).toLocaleDateString(I18N.dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' }), U.fmtLen(m.distance), '↑ ' + R().fmtGain(m.gain || m.demGain || 0), R().fmtDur(m.movingMs)];
      html += '<button class="card hist-row" data-hike="' + esc(m.id) + '">' + thumb(m) +
        '<div class="grow"><div class="kind-tag">' + esc(R().actLabel(m.activity)) + '</div><div class="hist-name">' + esc(m.name || R().actLabel(m.activity)) + '</div>' +
        '<div class="small muted">' + esc(sub.join(' · ')) + '</div></div></button>';
    });
    el.innerHTML = html;
    $$('[data-hike]', el).forEach(b => b.onclick = () => R().openHike(b.dataset.hike));
    fillPreviews(el);
  }

  function forget(id) { list = list.filter(m => m.id !== id); }

  window.BcHistory = { open, forget, makePreview, periodStart };
})();
