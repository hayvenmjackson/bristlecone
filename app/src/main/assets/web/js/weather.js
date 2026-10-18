/* Mountain weather estimates on the Conditions tab: temperature, precipitation type and wind at
   your elevation and up the nearest high ground, from public forecasts and stations (NWS and
   SNOTEL in the US, ECCC in Canada), trail reports and terrain. The math is in wxmodel.js.

   Every request is a plain GET through the same cache as the rest of the app, so the last
   estimate's inputs stay available offline (shown with their age and a wider range). Sources
   that fail are skipped; the card says which ones answered. */
(function () {
  const NWS = 'https://api.weather.gov';
  const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
  const GEOMET = 'https://geo.weather.gc.ca/geomet';
  const SWOB = 'https://api.weather.gc.ca/collections/swob-realtime/items';
  const KMH = 1 / 3.6, HOUR = 3600000;

  const U = () => App.ui;
  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

  // ------------------------------------------------------------------ Units from NWS JSON
  function toC(q) {
    if (!q || q.value == null) return null;
    const u = String(q.unitCode || q.uom || '');
    return /degF/.test(u) ? (q.value - 32) * 5 / 9 : /K$/.test(u) ? q.value - 273.15 : q.value;
  }
  function toMs(q) {
    if (!q || q.value == null) return null;
    const u = String(q.unitCode || q.uom || '');
    return /km_h/.test(u) ? q.value * KMH : /m_s/.test(u) ? q.value : /kt|knot/.test(u) ? q.value * 0.514444 : /mi_h|mph/.test(u) ? q.value * 0.44704 : q.value * KMH;
  }
  const toM = (q) => (!q || q.value == null ? null : /ft/.test(String(q.unitCode || q.uom || '')) ? q.value * 0.3048 : q.value);

  /** ISO 8601 "start/duration" as [start, end] in ms. */
  function span(validTime) {
    const [s, d] = String(validTime).split('/');
    const start = Date.parse(s);
    const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(d || '') || [];
    const len = ((+m[1] || 0) * 24 + (+m[2] || 0)) * HOUR + (+m[3] || 0) * 60000;
    return [start, start + (len || HOUR)];
  }
  /** The value of a gridded NWS element valid at time t (converted by conv). */
  function at(el, t, conv) {
    if (!el || !Array.isArray(el.values)) return null;
    const hit = el.values.find(v => { const [a, b] = span(v.validTime); return t >= a && t < b; }) || el.values[0];
    if (!hit) return null;
    return conv ? conv({ value: hit.value, uom: el.uom }) : hit.value;
  }

  const PRECIP_WORDS = /rain|drizzle|snow|sleet|freezing|showers|thunder|ice|hail|graupel|flurr/i;
  function typeOfWords(list) {
    const s = list.join(' ').toLowerCase();
    if (/freezing|sleet|ice_pellets|ice pellets/.test(s)) return 'freezing';
    const sn = /snow|flurr|graupel/.test(s), rn = /rain|drizzle/.test(s);
    return sn && rn ? 'mix' : sn ? 'snow' : rn ? 'rain' : null;
  }

  // ------------------------------------------------------------------ Terrain
  /** Elevations (m) on a square grid around a point, row 0 north. */
  async function grid(lon, lat, n, spacing) {
    const c = (n - 1) / 2, dLat = spacing / 111320, dLon = spacing / (111320 * Math.cos(lat * Math.PI / 180));
    const pts = [];
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) pts.push([lon + (k - c) * dLon, lat + (c - r) * dLat]);
    const z = await BcTrail.elevations(pts, 12);
    const rows = [];
    for (let r = 0; r < n; r++) rows.push(z.slice(r * n, r * n + n).map(v => (v == null ? NaN : v)));
    return { rows, pts };
  }

  /** The highest ground within about 2.5 miles, so the card can speak for the summit too. */
  async function highPoint(lon, lat) {
    const g = await grid(lon, lat, 9, 600);
    let best = null;
    g.rows.forEach((row, r) => row.forEach((z, k) => { if (isFinite(z) && (!best || z > best.z)) best = { z, lon: g.pts[r * 9 + k][0], lat: g.pts[r * 9 + k][1] }; }));
    return best;
  }

  // ------------------------------------------------------------------ United States: NWS and SNOTEL
  async function usSources(c, now, stateCode) {
    const out = { src: [], paired: [], obs: [] };
    const pt = (await BcData.getJson(NWS + '/points/' + c.lat.toFixed(4) + ',' + c.lon.toFixed(4))).json.properties || {};
    const g = await BcData.getJson(pt.forecastGridData);
    const p = g.json.properties || {};
    const wx = at(p.weather, now) || [];
    const words = (Array.isArray(wx) ? wx : []).map(w => (w && w.weather) || '').filter(Boolean);
    out.ref = {
      z: toM(p.elevation), t: at(p.temperature, now, toC), rh: at(p.relativeHumidity, now),
      windMs: at(p.windSpeed, now, toMs), gustMs: at(p.windGust, now, toMs), windDir: at(p.windDirection, now), sky: at(p.skyCover, now), src: 'nws'
    };
    if (out.ref.rh == null) { const td = at(p.dewpoint, now, toC); if (td != null && out.ref.t != null) out.ref.rh = Math.min(100, 100 * Math.exp(17.625 * td / (td + 243.04)) / Math.exp(17.625 * out.ref.t / (out.ref.t + 243.04))); }
    const pop = at(p.probabilityOfPrecipitation, now);
    const qpf = at(p.quantitativePrecipitation, now);
    out.precipChance = Math.max(pop != null ? pop / 100 : 0, qpf != null && qpf > 0.2 ? 0.7 : 0, words.some(w => PRECIP_WORDS.test(w)) ? 0.5 : 0);
    out.gridType = typeOfWords(words);
    out.snowLevel = at(p.snowLevel, now, toM);
    out.updated = Date.parse(p.updateTime) || g.meta.fetched;
    out.stale = g.meta.stale;
    out.src.push('nws');

    // Nearby stations: the nearest for a correction, all of them for the lapse rate.
    try {
      const st = (await BcData.getJson(pt.observationStations)).json.features || [];
      const near = st.map(f => ({ id: f.properties.stationIdentifier, name: f.properties.name, z: toM(f.properties.elevation), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
        .map(s => Object.assign(s, { d: BcData.haversine([c.lon, c.lat], [s.lon, s.lat]) })).filter(s => s.d < 60000).slice(0, 4);
      const obs = await Promise.allSettled(near.map(s => BcData.getJson(NWS + '/stations/' + encodeURIComponent(s.id) + '/observations/latest')));
      obs.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const o = r.value.json.properties || {};
        const time = Date.parse(o.timestamp);
        const t = toC(o.temperature);
        if (t == null || !(now - time < 2.5 * HOUR)) return;
        const pw = (o.presentWeather || []).map(w => w.weather || w.rawString || '').concat([o.textDescription || '']);
        out.obs.push(Object.assign({}, near[i], { t, time, precip: pw.some(w => PRECIP_WORDS.test(w)), type: typeOfWords(pw) }));
      });
      if (out.obs.length) out.src.push('stations');
    } catch (e) { /* stations are optional */ }

    // SNOTEL: high-elevation temperature, the best check on the lapse rate in the West.
    if (stateCode) {
      try {
        const list = (await BcData.getJson(AWDB + '/stations?stationTriplets=*:' + encodeURIComponent(stateCode) + ':SNTL&returnForecastPointMetadata=false&returnReservoirMetadata=false&returnStationElements=false&activeOnly=true')).json;
        const near = (Array.isArray(list) ? list : []).map(s => ({ id: s.stationTriplet, name: s.name, lat: num(s.latitude), lon: num(s.longitude), z: num(s.elevation) != null ? num(s.elevation) * 0.3048 : null }))
          .filter(s => s.lat != null && s.lon != null && s.z != null)
          .map(s => Object.assign(s, { d: BcData.haversine([c.lon, c.lat], [s.lon, s.lat]) })).filter(s => s.d < 50000).sort((a, b) => a.d - b.d).slice(0, 2);
        const day = (ms) => new Date(ms).toISOString().slice(0, 10);
        for (const s of near) {
          const r = (await BcData.getJson(AWDB + '/data?stationTriplets=' + encodeURIComponent(s.id) + '&elements=TOBS&duration=HOURLY&beginDate=' + day(now - 86400000) + '&endDate=' + day(now + 86400000))).json;
          const vals = [];
          (Array.isArray(r) ? r : [r]).forEach(x => (x && x.data || []).forEach(d => (d.values || []).forEach(v => { if (num(v.value) != null) vals.push(v); })));
          const last = vals[vals.length - 1];
          // SNOTEL reports in local standard time; accept a reading from the last few hours.
          if (last && Math.abs(now - Date.parse(String(last.date).replace(' ', 'T'))) < 14 * HOUR) out.obs.push(Object.assign({}, s, { t: (num(last.value) - 32) * 5 / 9, time: now, snotel: true }));
        }
        if (out.obs.some(o => o.snotel)) out.src.push('snotel');
      } catch (e) { /* SNOTEL is optional */ }
    }
    return out;
  }

  // ------------------------------------------------------------------ Canada: ECCC HRDPS and SWOB
  async function featureInfo(layer, c) {
    const b = [c.lat - 0.01, c.lon - 0.01, c.lat + 0.01, c.lon + 0.01].map(v => v.toFixed(3)).join(',');
    const url = GEOMET + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=' + layer + '&QUERY_LAYERS=' + layer +
      '&CRS=EPSG:4326&BBOX=' + b + '&WIDTH=3&HEIGHT=3&I=1&J=1&INFO_FORMAT=application/json';
    const r = await BcData.getJson(url);
    const f = (r.json.features || [])[0];
    return { v: f ? num(f.properties && (f.properties.value != null ? f.properties.value : f.properties.Value)) : null, meta: r.meta };
  }
  /** First property whose name matches, whether flat (air_temp) or suffixed (air_temp-value). */
  function pick(p, re) {
    for (const k of Object.keys(p)) if (re.test(k) && !/uom|qa|unit/i.test(k) && num(p[k]) != null) return num(p[k]);
    return null;
  }

  async function caSources(c, now) {
    const out = { src: [], paired: [], obs: [] };
    const [tt, hr, uu, wd] = await Promise.all(['HRDPS.CONTINENTAL_TT', 'HRDPS.CONTINENTAL_HR', 'HRDPS.CONTINENTAL_UU', 'HRDPS.CONTINENTAL_WD'].map(l => featureInfo(l, c).catch(() => ({ v: null }))));
    if (tt.v == null) throw new Error('hrdps unavailable');
    // The model's own ground is the average of its 2.5 km cell, not the spot under the point.
    const cell = await grid(c.lon, c.lat, 3, 1100);
    const zs = cell.rows.flat().filter(isFinite);
    out.ref = { z: zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0, t: tt.v, rh: hr.v != null ? hr.v : 75, windMs: uu.v != null ? uu.v * KMH : null, windDir: wd.v, src: 'hrdps' };
    out.updated = tt.meta && tt.meta.fetched;
    out.stale = tt.meta && tt.meta.stale;
    out.precipChance = 0;
    out.src.push('hrdps');
    try {
      const bbox = [c.lon - 0.5, c.lat - 0.35, c.lon + 0.5, c.lat + 0.35].map(v => v.toFixed(2)).join(',');
      const since = new Date(Math.floor((now - 3 * HOUR) / (10 * 60000)) * 10 * 60000).toISOString().replace('.000', '');
      const fc = (await BcData.getJson(SWOB + '?f=json&limit=300&bbox=' + bbox + '&datetime=' + since + '/..')).json;
      const latest = new Map();
      (fc.features || []).forEach(f => {
        const p = f.properties || {};
        const id = p['msc_id-value'] || p['stn_nam-value'] || p.msc_id || p.stn_nam || f.id;
        const time = Date.parse(p['date_tm-value'] || p.date_tm || p.obs_date_tm || '');
        if (!id || !isFinite(time) || (latest.has(id) && latest.get(id).time >= time)) return;
        const t = pick(p, /^air_temp(-value)?$/);
        const z = pick(p, /^stn_elev(-value)?$/);
        if (t == null || z == null || !f.geometry) return;
        const precip = (pick(p, /^pcpn_amt_pst1hr(-value)?$/) || 0) > 0.1 || (pick(p, /^rnfl_amt_pst1hr(-value)?$/) || 0) > 0.1;
        latest.set(id, { id, name: p['stn_nam-value'] || p.stn_nam || id, t, z, time, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], precip,
          windMs: (pick(p, /^avg_wnd_spd_10m_pst(2|10)mts(-value)?$/) || pick(p, /^wnd_spd/) || null) != null ? (pick(p, /^avg_wnd_spd_10m_pst(2|10)mts(-value)?$/) || pick(p, /^wnd_spd/)) * KMH : null });
      });
      latest.forEach(o => { o.d = BcData.haversine([c.lon, c.lat], [o.lon, o.lat]); out.obs.push(o); });
      out.obs.sort((a, b) => a.d - b.d);
      out.obs = out.obs.slice(0, 6);
      if (out.obs.length) out.src.push('swob');
      if (out.obs.some(o => o.precip && o.d < 30000)) out.precipChance = 0.85;
      if (out.ref.windMs == null) { const w = out.obs.find(o => o.windMs != null); if (w) out.ref.windMs = w.windMs; }
    } catch (e) { /* stations are optional */ }
    return out;
  }

  // ------------------------------------------------------------------ Trail reports as evidence
  async function evidence(items, now, lang, country) {
    const unit = country === 'us' && !String(lang).startsWith('fr') ? 'F' : 'C';
    const out = [];
    for (const it of items || []) {
      if (!it.time || now - it.time > 24 * HOUR || it.time > now + HOUR) continue;
      if (['nws', 'eccc', 'nps', 'avy', 'avcan', 'fire'].includes(it.src)) continue;   // official products, not first-hand
      let r = BcWx.readReport((it.title || '') + '. ' + (it.body || ''), unit);
      if (it.src === 'mine' && it.cat === 'snow' && !r) r = { type: 'snow', t: null };
      if (!r) continue;
      const ageH = (now - it.time) / HOUR;
      let w = Math.exp(-ageH / 4) * (it.src === 'mine' ? 1 : 0.7);
      let z = null;
      if (it.coords) { try { z = (await BcTrail.elevations([it.coords], 12))[0]; } catch (e) { z = null; } }
      if (z == null) w *= 0.5;
      if (w >= 0.08) out.push({ type: r.type, t: r.t, z: z == null ? NaN : z, w });
    }
    return out;
  }

  // ------------------------------------------------------------------ Putting it together
  async function compute(c, exact, ctx, items) {
    const now = Date.now();
    const country = ctx.country === 'ca' ? 'ca' : 'us';
    const data = country === 'ca' ? await caSources(c, now) : await usSources(c, now, ctx.stateCode);
    if (!data.ref || data.ref.t == null || data.ref.z == null) throw new Error('no forecast');

    const hereZ = (await BcTrail.elevations([[exact.lon, exact.lat]], 12))[0];
    const top = await highPoint(exact.lon, exact.lat).catch(() => null);
    const sunEl = window.Sun ? Sun.elevation(new Date(now), c.lat, c.lon) : 0;
    const hour = ((new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60 + c.lon / 15) % 24 + 24) % 24;
    const s = {
      ref: data.ref, paired: data.obs.map(o => ({ z: o.z, t: o.t })), precipChance: data.precipChance, gridType: data.gridType,
      snowLevel: data.snowLevel, hour, month: new Date(now).getUTCMonth() + 1, night: sunEl < -4,
      ageH: data.stale ? Math.max(1, (now - (data.updated || now)) / HOUR) : 0.5
    };
    if (data.obs.some(o => o.precip && o.d < 25000)) s.precipChance = Math.max(s.precipChance, 0.85);

    // How far off the forecast is at the nearest station right now, carried to the target.
    const lapse = BcWx.lapseFor({ rh: data.ref.rh, precipChance: s.precipChance, night: s.night, windMs: data.ref.windMs || 0, sky: data.ref.sky, hour, paired: s.paired });
    const nearest = data.obs.filter(o => !o.snotel).sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d < 25000) {
      s.bias = { t: nearest.t - (data.ref.t + lapse.g * (nearest.z - data.ref.z) / 1000), w: 0.7 * Math.exp(-nearest.d / 15000) };
    }
    s.reports = await evidence(await items, now, ctx.lang, country);

    const terr = async (p) => { try { return BcWx.terrain((await grid(p.lon, p.lat, 5, 150)).rows, 150); } catch (e) { return null; } };
    const here = hereZ == null ? null : BcWx.estimate(s, hereZ, await terr(exact));
    const summit = top && hereZ != null && top.z - hereZ > 120 ? BcWx.estimate(s, top.z, await terr(top)) : null;
    const official = BcWx.estimate(Object.assign({}, s, { reports: [] }), data.ref.z, null);
    return { data, s, here, summit, top, hereZ, official, now };
  }

  // ------------------------------------------------------------------ Display
  const fmtT = (c) => (U().imperial ? Math.round(c * 9 / 5 + 32) + '°F' : Math.round(c) + '°C');
  const fmtTn = (c) => String(U().imperial ? Math.round(c * 9 / 5 + 32) : Math.round(c));
  const fmtW = (ms) => (U().imperial ? Math.round(ms * 2.23694) + ' ' + U().t('unit.mph') : Math.round(ms * 3.6) + ' ' + U().t('unit.kmh'));
  const levelText = (m) => U().fmtEle(Math.round(m / (U().imperial ? 15.24 : 10)) * (U().imperial ? 15.24 : 10));

  function precipText(e) {
    const t = U().t, ch = e.precipChance;
    const kind = t('wx.type.' + e.type);
    if (ch >= 0.6) return t('wx.likely', { kind });
    if (ch >= 0.25) return t('wx.chance', { kind: kind.toLowerCase() });
    return t('wx.dry', { kind: kind.toLowerCase() });
  }

  function summary(label, e) {
    const u = U(), esc = u.esc, t = u.t;
    return '<div class="wx-row"><div class="wx-where">' + esc(label) + ' · ' + esc(u.fmtEle(e.z)) + '</div>' +
      '<div class="wx-main"><b>' + esc(fmtT(e.t)) + '</b> <span class="muted">' + esc(t('wx.range', { lo: fmtTn(e.p10), hi: fmtTn(e.p90) })) + '</span></div>' +
      '<div class="wx-sub">' + esc(precipText(e)) + (e.wind ? ' · ' + esc(t('wx.wind', { w: fmtW(e.wind.p50), g: fmtW(e.wind.gust) })) + (e.wind.exposure === 'exposed' ? ' · ' + esc(t('wx.exposed')) : '') : '') + '</div></div>';
  }

  /** Bands from here to the high point, so the snow line shows on the way up. */
  function ladder(r) {
    const u = U(), esc = u.esc, t = u.t;
    if (!r.summit) return '';
    const step0 = u.imperial ? 152.4 : 150;
    let step = step0;
    while ((r.top.z - r.hereZ) / step > 9) step += step0;
    const rows = [];
    for (let z = Math.ceil(r.hereZ / step) * step; z < r.top.z - step / 3; z += step) rows.push(BcWx.estimate(r.s, z, null));
    const all = [r.summit].concat(rows.reverse());
    return '<table class="wx-ladder"><thead><tr><th>' + esc(t('wx.col.ele')) + '</th><th>' + esc(t('wx.col.temp')) + '</th><th>' + esc(t('wx.col.precip')) + '</th></tr></thead><tbody>' +
      all.map(e => '<tr class="wx-' + esc(e.type) + '"><td>' + esc(u.fmtEle(e.z)) + '</td><td>' + esc(fmtT(e.t)) + '</td><td>' + esc(t('wx.type.' + e.type)) + '</td></tr>').join('') + '</tbody></table>';
  }

  function sourcesLine(r) {
    const u = U(), t = u.t, d = r.data;
    const parts = [];
    if (d.src.includes('nws')) parts.push(t('wx.src.nws'));
    if (d.src.includes('hrdps')) parts.push(t('wx.src.hrdps'));
    const st = d.obs.filter(o => !o.snotel).length, sn = d.obs.filter(o => o.snotel).length;
    if (st) parts.push(t('wx.src.stations', { n: st }));
    if (sn) parts.push(t('wx.src.snotel', { n: sn }));
    if (r.s.reports.length) parts.push(t('wx.src.reports', { n: r.s.reports.length }));
    const near = d.obs.filter(o => !o.snotel).sort((a, b) => a.d - b.d)[0];
    let s = t('wx.basedOn', { list: parts.join(', ') });
    if (near) s += ' ' + t('wx.nearest', { name: near.name, t: fmtT(near.t), ele: u.fmtEle(near.z) });
    if (d.updated) s += ' ' + t('wx.updated', { age: u.ageText(d.updated) });
    return s;
  }

  let seq = 0;
  /**
   * Fills `el` with the estimate for the conditions point. c: position rounded for public
   * services; exact: the true point (used only for terrain, read from map tiles on the phone).
   */
  async function render(el, c, exact, ctx, items) {
    const u = U(), esc = u.esc, t = u.t;
    if (!el || u.settings.wx === false) { if (el) el.innerHTML = ''; return; }
    const my = ++seq;
    el.innerHTML = '<div class="card wx"><div class="row between"><h3 class="section" style="margin:0">' + esc(t('wx.title')) + '</h3><span class="wx-badge">' + esc(t('wx.badge')) + '</span></div><p class="small muted">' + esc(t('wx.working')) + '</p></div>';
    let r;
    try { r = await compute(c, exact, ctx, items); } catch (e) {
      if (my === seq && el.isConnected) el.innerHTML = '<div class="card wx"><div class="row between"><h3 class="section" style="margin:0">' + esc(t('wx.title')) + '</h3></div><p class="small muted">' + esc(t('wx.unavailable')) + '</p></div>';
      return;
    }
    if (my !== seq || !el.isConnected || !r.here) return;
    const e = r.here, hi = r.summit;
    const lines = [];
    const lvl = [];
    // A level at or below sea level is real (coastal Maine in January), not an error. Near the
    // coast, say so plainly; well inland, a level far below the ground just means "everywhere here".
    const level = (m, key) => {
      if (!isFinite(m)) return;
      if (m > 0) lvl.push(t(key, { ele: levelText(m) }));
      else lvl.push(t(key + (r.hereZ != null && r.hereZ >= 600 ? 'Everywhere' : 'SeaLevel')));
    };
    level(e.snowLevel, 'wx.snowLevel');
    level(e.freezingLevel, 'wx.freezingLevel');
    // The official forecast is for its own grid elevation; disagreeing there is worth saying.
    const off = r.official, gt = r.data.gridType;
    const differs = gt && off.type !== gt && !(off.type === 'mix' || gt === 'mix');
    lines.push('<div class="card wx"><div class="row between"><h3 class="section" style="margin:0">' + esc(t('wx.title')) + '</h3><span class="wx-badge">' + esc(t('wx.badge')) + '</span></div>');
    if (r.data.stale) lines.push('<div class="estimate-banner" style="margin:8px 0"><span>' + esc(t('wx.offline', { age: u.ageText(r.data.updated || r.now) })) + '</span></div>');
    lines.push(summary(t('wx.here'), e));
    if (hi) lines.push(summary(t('wx.high'), hi));
    if (lvl.length) lines.push('<p class="read" style="margin:8px 0 4px">' + esc(lvl.join(' ')) + '</p>');
    lines.push(ladder(r));
    if (differs) lines.push('<p class="small wx-differs">' + esc(t('wx.differs', { kind: t('wx.type.' + gt).toLowerCase() })) + '</p>');
    lines.push('<p class="small muted">' + esc(sourcesLine(r)) + '</p>');
    lines.push('<p class="small wx-note">' + esc(t('wx.disclaimer')) + '</p></div>');
    el.innerHTML = lines.join('');
  }

  window.BcWeather = { render, compute, span, at, typeOfWords, evidence };
})();
