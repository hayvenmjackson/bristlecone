/* Trail reports and conditions from public sources, always sorted newest first. */
(function () {
  const NPS_API = 'https://developer.nps.gov/api/v1';
  const NWS = 'https://api.weather.gov/alerts/active';
  const ECCC = 'https://api.weather.gc.ca/collections/weather-alerts/items';
  const AVCAN = 'https://api.avalanche.ca/forecasts';
  const OSM_NOTES = 'https://api.openstreetmap.org/api/0.6/notes.json';

  const strip = (html) => {
    if (!html) return '';
    // DOMParser builds an inert document: no scripts run and no images load, unlike
    // assigning remote HTML to an element's innerHTML (which fires onerror handlers).
    const src = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
    const doc = new DOMParser().parseFromString(src, 'text/html');
    return ((doc.body && doc.body.textContent) || '').replace(/\n{3,}/g, '\n\n').trim();
  };
  const toTime = (v) => { if (!v) return null; if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; const t = Date.parse(v); return isNaN(t) ? null : t; };

  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pointInGeom(pt, g) {
    if (!g) return false;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(p => pointInRing(pt, p[0]) && !p.slice(1).some(h => pointInRing(pt, h)));
  }

  // --------------------------------------------------------------- Sources
  async function nws(ctx) {
    if (ctx.country && ctx.country !== 'us') return { na: true };
    const { json, meta } = await BcData.getJson(NWS + '?point=' + ctx.lat.toFixed(4) + ',' + ctx.lon.toFixed(4));
    return { meta, items: (json.features || []).map(f => {
      const p = f.properties || {};
      return { src: 'nws', title: p.headline || p.event, body: [p.description, p.instruction].filter(Boolean).join('\n\n'),
        time: toTime(p.sent || p.effective), until: toTime(p.ends || p.expires), severity: (p.severity || '').toLowerCase(), url: p['@id'] || null };
    }) };
  }

  async function eccc(ctx) {
    if (ctx.country && ctx.country !== 'ca') return { na: true };
    const lang = ctx.lang === 'fr-CA' ? 'fr' : 'en';
    const bbox = [ctx.lon - 0.05, ctx.lat - 0.05, ctx.lon + 0.05, ctx.lat + 0.05].map(v => v.toFixed(3)).join(',');
    const { json, meta } = await BcData.getJson(ECCC + '?f=json&lang=' + lang + '&limit=50&bbox=' + bbox);
    const pick = (p, base) => p[base + '_' + lang] || p[base + '_en'] || p[base];
    const items = (json.features || []).map(f => {
      const p = f.properties || {};
      const title = pick(p, 'alert_name') || pick(p, 'alert_short_name') || pick(p, 'headline') || pick(p, 'event') || p.alert_type;
      const area = pick(p, 'feature_name') || pick(p, 'area_desc');
      return { src: 'eccc', title: [title, area].filter(Boolean).join(' · '), body: strip(pick(p, 'alert_text') || pick(p, 'description') || ''),
        time: toTime(p.publication_datetime || p.validity_datetime || p.effective_datetime || p.sent),
        until: toTime(p.expiration_datetime || p.event_end_datetime || p.expires), severity: String(p.risk_colour_en || p.alert_type || '').toLowerCase(), url: null };
    });
    // One alert is published per forecast region; keep the newest copy of each title.
    const seen = new Map();
    items.forEach(i => { const k = i.title; if (!seen.has(k) || (i.time || 0) > (seen.get(k).time || 0)) seen.set(k, i); });
    return { meta, items: Array.from(seen.values()) };
  }

  async function nps(ctx) {
    if (!ctx.stateCode || ctx.country !== 'us') return { na: true };
    const key = ctx.npsKey || 'DEMO_KEY';
    const parks = await BcData.getJson(NPS_API + '/parks?stateCode=' + ctx.stateCode + '&limit=100&fields=latitude,longitude&api_key=' + encodeURIComponent(key));
    const near = {};
    (parks.json.data || []).forEach(p => {
      const lat = parseFloat(p.latitude), lon = parseFloat(p.longitude);
      if (!isNaN(lat) && BcData.haversine([ctx.lon, ctx.lat], [lon, lat]) < 160000) near[p.parkCode] = p.fullName;
    });
    const codes = Object.keys(near);
    if (!codes.length) return { na: true };
    const { json, meta } = await BcData.getJson(NPS_API + '/alerts?parkCode=' + codes.join(',') + '&limit=100&api_key=' + encodeURIComponent(key));
    return { meta, items: (json.data || []).map(a => ({
      src: 'nps', title: a.title, body: strip(a.description), sub: near[a.parkCode] || a.parkCode,
      time: toTime(a.lastIndexedDate), severity: (a.category || '').toLowerCase() === 'danger' ? 'severe' : (a.category || '').toLowerCase() === 'park closure' ? 'closure' : '',
      category: a.category, url: a.url || null
    })) };
  }

  async function avyUS(ctx) {
    if (ctx.country && ctx.country !== 'us') return { na: true };
    const { fc, meta } = await BcData.loadAvyUS();
    const hit = (fc.features || []).filter(f => pointInGeom([ctx.lon, ctx.lat], f.geometry));
    if (!hit.length) return { na: true };
    return { meta, items: hit.filter(f => !f.properties.off_season).map(f => {
      const p = f.properties;
      const level = Number(p.danger_level) > 0 ? Number(p.danger_level) : 0;
      return { src: 'avy', title: I18N.t('avy.title', { level: I18N.t('danger.' + level) }), sub: [p.name, p.center].filter(Boolean).join(' · '),
        body: p.travel_advice || '', time: toTime(p.start_date), until: toTime(p.end_date), severity: level >= 4 ? 'severe' : level >= 3 ? 'moderate' : '', url: p.link || null, danger: level };
    }) };
  }

  async function avyCA(ctx) {
    if (ctx.country && ctx.country !== 'ca') return { na: true };
    const lang = ctx.lang === 'fr-CA' ? 'fr' : 'en';
    const { json, meta } = await BcData.getJson(AVCAN + '/' + lang + '/products/point?lat=' + ctx.lat.toFixed(4) + '&long=' + ctx.lon.toFixed(4));
    const rep = (json && (json.report || (json.data && json.data.report))) || json;
    if (!rep || (!rep.title && !rep.highlights)) return { na: true };
    let level = 0;
    try {
      const r = rep.dangerRatings && rep.dangerRatings[0] && rep.dangerRatings[0].ratings;
      const v = r && (r.alp || r.alpine || Object.values(r)[0]);
      const val = v && (v.rating ? v.rating.value : v.value);
      const map = { low: 1, moderate: 2, considerable: 3, high: 4, extreme: 5 };
      level = map[String(val || '').toLowerCase()] || 0;
    } catch (e) { level = 0; }
    return { meta, items: [{ src: 'avcan', title: I18N.t('avy.title', { level: I18N.t('danger.' + level) }), sub: rep.title || '',
      body: strip(rep.highlights || rep.summary || ''), time: toTime(rep.dateIssued), until: toTime(rep.validUntil), severity: level >= 4 ? 'severe' : level >= 3 ? 'moderate' : '',
      url: json.url || 'https://avalanche.ca/map', danger: level }] };
  }

  async function osmNotes(ctx) {
    const d = 0.06;
    const bbox = [ctx.lon - d, ctx.lat - d, ctx.lon + d, ctx.lat + d].map(v => v.toFixed(4)).join(',');
    const { json, meta } = await BcData.getJson(OSM_NOTES + '?bbox=' + bbox + '&limit=60&closed=30');
    return { meta, items: (json.features || []).map(f => {
      const p = f.properties || {};
      const c = p.comments || [];
      const last = c[c.length - 1] || {};
      const title = (c[0] && c[0].text || '').split('\n')[0].slice(0, 110) || 'Map note';
      const body = c.map(x => x.text).filter(Boolean).join('\n\n');
      return { src: 'osm', title, body: body.trim() === title.trim() ? '' : body,
        time: toTime((last.date || p.date_created || '').replace(' UTC', 'Z').replace(' ', 'T')), severity: p.status === 'closed' ? 'resolved' : '',
        url: 'https://www.openstreetmap.org/note/' + p.id, coords: f.geometry && f.geometry.coordinates };
    }) };
  }

  async function fires(ctx) {
    if (ctx.country && ctx.country !== 'us') return { na: true };
    const d = 0.6;
    const { fc, meta } = await BcData.loadFires([ctx.lon - d, ctx.lat - d, ctx.lon + d, ctx.lat + d]);
    return { meta, items: fc.features.map(f => {
      const p = f.properties;
      return { src: 'fire', title: I18N.t('fire.title', { name: p.name }), body: I18N.t('fire.body', { acres: p.acres != null ? p.acres.toLocaleString(I18N.dateLocale()) : '?', contained: p.pct != null ? I18N.t('fire.contained', { p: p.pct }) : '' }),
        time: p.date, severity: 'severe', url: null };
    }) };
  }

  function mine(ctx) {
    const list = (App.state.places || []).filter(p => p.type === 'report' && BcData.haversine([ctx.lon, ctx.lat], [p.lon, p.lat]) < 30000);
    return { items: list.map(p => ({ src: 'mine', title: I18N.t('rep.' + (p.cat || 'other')) + (p.name ? ' · ' + p.name : ''), body: p.note || '', time: p.time, severity: p.cat === 'closure' ? 'closure' : '', coords: [p.lon, p.lat] })) };
  }

  // ------------------------------------------------------------------ Social: Mastodon-compatible servers
  // Hashtag timelines are public on most servers. Posts only appear if the on-phone filter judges
  // them to be first-hand trail condition reports, so ordinary chatter (political or otherwise) is dropped.
  const DEFAULT_INSTANCES = [
    { host: 'mastodon.social', on: true },
    { host: 'noagendasocial.com', on: true },
    { host: 'gab.com', on: true }
  ];
  const toTag = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  function socialTags(ctx) {
    const names = [ctx.target, ctx.target && String(ctx.target).replace(/\b(Trail|Loop|Path|Trailhead)\b/gi, '').trim(), ctx.label, ctx.stateName].filter(x => x && x.length > 2);
    return Array.from(new Set(names.map(toTag).filter(x => x.length > 2))).slice(0, 4);
  }
  function tagUrl(host, tags) {
    return 'https://' + host + '/api/v1/timelines/tag/' + encodeURIComponent(tags[0]) + '?limit=40' + tags.slice(1).map(x => '&any%5B%5D=' + encodeURIComponent(x)).join('');
  }
  async function social(ctx) {
    const cfg = ctx.social || {};
    if (cfg.enabled === false || !window.BcReportFilter) return { na: true };
    const hosts = (cfg.instances || DEFAULT_INSTANCES).filter(i => i.on).map(i => i.host);
    if (!hosts.length) return { na: true };
    const place = socialTags(ctx);
    const generic = ['TrailConditions', 'TrailReport', 'TrailUpdate', 'Hiking'];
    const words = [ctx.target, ctx.label, ctx.stateName].filter(Boolean).map(x => String(x).toLowerCase().replace(/\b(trail|loop|path)\b/g, '').trim()).filter(x => x.length > 3);
    const seen = new Set(), items = [], perHost = {};
    let meta = null, anyOk = false;
    await Promise.all(hosts.map(async host => {
      const urls = (place.length ? [tagUrl(host, place)] : []).concat([tagUrl(host, generic)]);
      for (const [qi, url] of urls.entries()) {
        try {
          const r = await BcData.getJson(url);
          anyOk = true; meta = meta || r.meta;
          (Array.isArray(r.json) ? r.json : []).forEach(st => {
            const s = st.reblog || st;
            if (!s || !s.content || seen.has(s.url || s.uri)) return;
            const text = strip(s.content);
            const lower = text.toLowerCase();
            // Generic hashtags must also name this place to count as relevant.
            if (qi === urls.length - 1 && place.length && !words.some(w => lower.includes(w))) return;
            if (!place.length && !words.some(w => lower.includes(w))) return;
            const p = BcReportFilter.score(text);
            if (p < BcReportFilter.threshold) return;
            const time = toTime(s.created_at);
            if (time && Date.now() - time > 45 * 86400000) return;
            seen.add(s.url || s.uri);
            perHost[host] = (perHost[host] || 0) + 1;
            const acct = (s.account && (s.account.acct || s.account.username)) || '';
            items.push({ src: 'social', title: text.split(/(?<=[.!?])\s/)[0].slice(0, 110), body: text, time, url: s.url || s.uri || null,
              sub: '@' + acct.split('@')[0] + ' · ' + host, host, score: p, severity: /\b(closed|closure|washed out|bridge out|avalanche|rockfall|fermé|cerrado)\b/i.test(text) ? 'closure' : '' });
          });
        } catch (e) { perHost[host] = perHost[host] || 0; }
      }
    }));
    if (!anyOk) throw new Error('social unavailable');
    return { meta, items, perHost };
  }

  const SOURCES = [['mine', mine], ['nws', nws], ['eccc', eccc], ['nps', nps], ['avy', avyUS], ['avcan', avyCA], ['fire', fires], ['osm', osmNotes], ['social', social]];

  async function gather(ctx) {
    const status = {};
    const all = [];
    let oldestSaved = null;
    await Promise.all(SOURCES.map(async ([id, fn]) => {
      try {
        const r = await fn(ctx);
        if (r.na) { status[id] = { na: true }; return; }
        (r.items || []).forEach(i => { if (r.meta && r.meta.stale) i.stale = r.meta.fetched; all.push(i); });
        status[id] = { ok: true, n: (r.items || []).length, stale: r.meta && r.meta.stale };
        if (r.meta && r.meta.stale) oldestSaved = Math.min(oldestSaved || Infinity, r.meta.fetched);
      } catch (e) {
        status[id] = { fail: true };
      }
    }));
    // Newest first, always. Undated items sink to the bottom rather than posing as current.
    all.sort((a, b) => (b.time || 0) - (a.time || 0));
    return { items: all, status, oldestSaved };
  }

  window.BcReports = { gather, SOURCES: SOURCES.map(s => s[0]), pointInGeom, strip, DEFAULT_INSTANCES, socialTags, toTag };
})();
