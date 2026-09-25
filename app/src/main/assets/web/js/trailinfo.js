/* Trail details: full length, elevation profile, a difficulty rating with its reasons, and
   published descriptions, photos and parking from public sources. Nothing is filled in when a
   source has nothing; the card says so instead. */
(function () {
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const NPS = 'https://developer.nps.gov/api/v1';
  const HIKING_KINDS = ['hiking', 'footway', 'steps', 'via_ferrata'];
  const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 5 };
  const LEVELS = ['', 'easy', 'moderate', 'hard', 'veryhard', 'expert'];

  // ------------------------------------------------------------------ Pure logic (tested in Node)
  const hav = (a, b) => { const R = 6371008.8, r = Math.PI / 180, dp = (b[1] - a[1]) * r, dl = (b[0] - a[0]) * r; const h = Math.sin(dp / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  const lineLen = (c) => { let s = 0; for (let i = 1; i < c.length; i++) s += hav(c[i - 1], c[i]); return s; };

  /** Joins segments into one ordered path by repeatedly attaching the nearest free end (5 m snap for shared nodes, up to 150 m gaps). */
  function chain(segments) {
    const segs = segments.filter(s => s.length > 1).map(s => s.slice());
    if (!segs.length) return [];
    // Start from a segment end that touches nothing else (a trail end), if there is one.
    const touches = (p, skip) => segs.some((s, i) => i !== skip && (hav(p, s[0]) < 5 || hav(p, s[s.length - 1]) < 5));
    let startIdx = 0, flip = false;
    for (let i = 0; i < segs.length; i++) {
      if (!touches(segs[i][0], i)) { startIdx = i; flip = false; break; }
      if (!touches(segs[i][segs[i].length - 1], i)) { startIdx = i; flip = true; break; }
    }
    let path = segs.splice(startIdx, 1)[0];
    if (flip) path.reverse();
    while (segs.length) {
      const end = path[path.length - 1];
      let best = -1, bestD = Infinity, rev = false;
      segs.forEach((s, i) => {
        const d0 = hav(end, s[0]), d1 = hav(end, s[s.length - 1]);
        if (d0 < bestD) { bestD = d0; best = i; rev = false; }
        if (d1 < bestD) { bestD = d1; best = i; rev = true; }
      });
      if (bestD > 150) break;
      const s = segs.splice(best, 1)[0];
      if (rev) s.reverse();
      path = path.concat(bestD < 5 ? s.slice(1) : s);
    }
    return path;
  }

  /** Points every `step` metres along a path: [[lon, lat, distanceFromStart], ...]. */
  function resample(path, step) {
    const out = [[path[0][0], path[0][1], 0]];
    let acc = 0, carry = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], d = hav(a, b);
      let pos = step - carry;
      while (pos <= d) {
        const f = pos / d;
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, acc + pos]);
        pos += step;
      }
      carry = d - (pos - step);
      acc += d;
    }
    const last = path[path.length - 1];
    if (out[out.length - 1][2] < acc - 1) out.push([last[0], last[1], acc]);
    return out;
  }

  /** Gain, loss, high and low points and steepest sustained grade from an elevation series (metres). */
  function profileStats(samples) {
    const ele = samples.map(s => s[3]);
    const sm = ele.map((_, i) => { let n = 0, t = 0; for (let k = Math.max(0, i - 2); k <= Math.min(ele.length - 1, i + 2); k++) { if (ele[k] != null) { t += ele[k]; n++; } } return n ? t / n : null; });
    let gain = 0, loss = 0, ref = null;
    sm.forEach(v => {
      if (v == null) return;
      if (ref == null) { ref = v; return; }
      if (v - ref >= 2) { gain += v - ref; ref = v; } else if (ref - v >= 2) { loss += ref - v; ref = v; }
    });
    const valid = sm.filter(v => v != null);
    let maxGrade = 0;
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const run = samples[j][2] - samples[i][2];
        if (run < 100) continue;
        if (sm[i] != null && sm[j] != null) maxGrade = Math.max(maxGrade, Math.abs(sm[j] - sm[i]) / run);
        break;
      }
    }
    return { gain, loss, high: valid.length ? Math.max(...valid) : null, low: valid.length ? Math.min(...valid) : null, maxGrade, smoothed: sm };
  }

  /** Words in official descriptions that mean the route needs a head for heights. */
  const TEXT_SIGNALS = [
    [/\biron (rungs?|ladders?|bars?)\b|\brungs?\b|\bvia ferrata\b|\bfear of heights\b|\bexposed (ledges?|cliffs?|sections?)\b|\bsheer (drop|cliff)s?\b/i, 5],
    [/\bladders?\b|\bhand[- ]over[- ]hand\b|\bscrambl(e|es|ing)\b|\bclass 3\b/i, 4],
    [/\bsteep\b|\bstrenuous\b|\brocky\b|\broots\b/i, 3]
  ];
  function textLevel(text) {
    if (!text) return null;
    for (const [re, lvl] of TEXT_SIGNALS) { const m = text.match(re); if (m) return { level: lvl, phrase: m[0] }; }
    return null;
  }

  /**
   * Rating from Easy (1) to Expert Only (5). Technical difficulty comes from OpenStreetMap tags and
   * warnings in published descriptions; physical effort uses the Shenandoah National Park formula
   * sqrt(gain in feet x 2 x round-trip miles), capped at Very Hard because effort alone never
   * makes a trail Expert Only.
   */
  function rate(o) {
    const reasons = [];
    let tech = 0;
    (o.ways || []).forEach(p => {
      const s = SAC[p.sac] || 0;
      if (s > tech) { tech = s; }
      if (p.kind === 'via_ferrata' || p.vf) { tech = Math.max(tech, 5); }
      if (p.ladder === 'yes' && (SAC[p.sac] || 0) >= 3) tech = Math.max(tech, 5);
      if (p.hazard && /cliff|fall|exposure/.test(p.hazard) && (SAC[p.sac] || 0) >= 3) tech = Math.max(tech, 5);
      if (p.scramble === 'yes') tech = Math.max(tech, 4);
      if (/^(bad|horrible|no)$/.test(p.vis || '')) tech = Math.max(tech, 3);
    });
    const worst = (o.ways || []).reduce((w, p) => (SAC[p.sac] || 0) > (SAC[w.sac] || 0) ? p : w, {});
    if (worst.sac) reasons.push({ key: 'td.why.sac', vars: { grade: worst.sac } });
    if ((o.ways || []).some(p => p.kind === 'via_ferrata' || p.vf)) reasons.push({ key: 'td.why.ferrata' });
    if ((o.ways || []).some(p => p.ladder === 'yes')) reasons.push({ key: 'td.why.ladder' });
    if ((o.ways || []).some(p => p.hazard)) reasons.push({ key: 'td.why.hazard', vars: { hazard: (o.ways.find(p => p.hazard) || {}).hazard } });
    if ((o.ways || []).some(p => /^(bad|horrible|no)$/.test(p.vis || ''))) reasons.push({ key: 'td.why.visibility' });
    (o.texts || []).forEach(tx => {
      const hit = textLevel(tx.text);
      if (hit && hit.level >= 4) { tech = Math.max(tech, hit.level); reasons.push({ key: 'td.why.text', vars: { source: tx.source, phrase: hit.phrase } }); }
    });
    let effort = null, phys = 0;
    if (o.lengthM > 0 && o.gainM != null) {
      const loop = o.loop;
      const miles = (loop ? o.lengthM : o.lengthM * 2) / 1609.344;
      const up = (loop ? o.gainM : Math.max(o.gainM, o.lossM || 0)) * 3.28084;
      effort = Math.sqrt(up * 2 * miles);
      phys = effort < 50 ? 1 : effort < 100 ? 2 : effort < 150 ? 3 : 4;
      reasons.push({ key: 'td.why.effort', vars: { score: Math.round(effort) } });
      if (o.maxGrade >= 0.4) { phys = Math.max(phys, 3); reasons.push({ key: 'td.why.grade', vars: { pct: Math.round(o.maxGrade * 100) } }); }
    }
    const level = Math.max(tech, phys);
    return { level, key: level ? 'td.level.' + LEVELS[level] : 'td.level.unknown', tech, phys, effort, reasons, techKnown: tech > 0 };
  }

  /** Naismith's rule: 3 mph on the flat plus an hour for every 2,000 ft of climbing. */
  function naismithMs(lengthM, gainM) { return ((lengthM / 1609.344) / 3 + (gainM * 3.28084) / 2000) * 3600000; }

  // ------------------------------------------------------------------ Elevation from terrain tiles
  const demCache = new Map();
  async function demTile(z, x, y) {
    const k = z + '/' + x + '/' + y;
    if (demCache.has(k)) return demCache.get(k);
    const p = (async () => {
      const r = await fetch(BcStyle.DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (!r.ok) throw new Error('dem ' + r.status);
      const bmp = await createImageBitmap(await r.blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
    })();
    demCache.set(k, p);
    if (demCache.size > 64) demCache.delete(demCache.keys().next().value);
    return p;
  }
  async function elevations(points, z) {
    z = z || 12;
    const n = 1 << z;
    const out = [];
    for (const [lon, lat] of points) {
      const fx = (lon + 180) / 360 * n;
      const r = lat * Math.PI / 180;
      const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
      const tx = Math.floor(fx), ty = Math.floor(fy);
      try {
        const tile = await demTile(z, tx, ty);
        const px = Math.min(tile.w - 1, Math.floor((fx - tx) * tile.w)), py = Math.min(tile.h - 1, Math.floor((fy - ty) * tile.h));
        const i = (py * tile.w + px) * 4;
        out.push(tile.d[i] * 256 + tile.d[i + 1] + tile.d[i + 2] / 256 - 32768);
      } catch (e) { out.push(null); }
    }
    return out;
  }

  // ------------------------------------------------------------------ Public sources
  async function j(url) { return (await BcData.getJson(url)).json; }
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function nameMatches(title, name) {
    const a = norm(title), b = norm(name).replace(/\b(trail|path|loop|route|the)\b/g, '').trim();
    return b.length >= 4 && a.includes(b);
  }

  async function relationGeometry(relId) {
    const q = '[out:json][timeout:60];rel(' + relId + ');out tags;way(r);out tags geom qt;';
    const js = await j(OVERPASS + '?data=' + encodeURIComponent(q));
    const rel = (js.elements || []).find(e => e.type === 'relation') || {};
    const ways = (js.elements || []).filter(e => e.type === 'way' && e.geometry).map(w => ({
      coords: w.geometry.map(g => [g.lon, g.lat]),
      props: { kind: BcData.classify(w.tags || {}), sac: (w.tags || {}).sac_scale, ladder: (w.tags || {}).ladder, hazard: (w.tags || {}).hazard, vf: (w.tags || {}).via_ferrata_scale, scramble: (w.tags || {}).scramble, vis: (w.tags || {}).trail_visibility }
    }));
    return { tags: rel.tags || {}, ways };
  }

  /** Connected ways with the same name from trail data already on the phone. */
  function localGeometry(f) {
    const all = App.ui.data.trails.features;
    const name = f.properties.name;
    if (!name) return { ways: [{ coords: f.geometry.coordinates, props: f.properties }] };
    const pool = all.filter(x => x.properties.name === name);
    const picked = [f], seen = new Set([f.properties.id]);
    let grew = true;
    while (grew) {
      grew = false;
      pool.forEach(x => {
        if (seen.has(x.properties.id)) return;
        const c = x.geometry.coordinates;
        const ends = [c[0], c[c.length - 1]];
        if (picked.some(p => { const pc = p.geometry.coordinates; return ends.some(e => hav(e, pc[0]) < 10 || hav(e, pc[pc.length - 1]) < 10); })) {
          picked.push(x); seen.add(x.properties.id); grew = true;
        }
      });
    }
    return { ways: picked.map(x => ({ coords: x.geometry.coordinates, props: x.properties })) };
  }

  async function wikipedia(p, mid, name, lang) {
    const wl = lang === 'fr-CA' ? 'fr' : lang === 'es-419' ? 'es' : 'en';
    let title = null, wiki = 'en';
    if (p.wikipedia) { const m = String(p.wikipedia).match(/^([a-z-]+):(.+)$/); if (m) { wiki = m[1]; title = m[2]; } }
    if (!title && p.wikidata) {
      try {
        const wd = await j('https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(p.wikidata) + '.json');
        const ent = wd.entities && Object.values(wd.entities)[0];
        const links = (ent && ent.sitelinks) || {};
        const pick = links[wl + 'wiki'] || links.enwiki;
        if (pick) { title = pick.title; wiki = pick.site.replace('wiki', ''); }
      } catch (e) { /* no Wikidata entry available */ }
    }
    if (!title && name) {
      try {
        const gs = await j('https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=' + mid[1].toFixed(5) + '%7C' + mid[0].toFixed(5) + '&gsradius=5000&gslimit=30&format=json&origin=*');
        const hit = ((gs.query && gs.query.geosearch) || []).find(x => nameMatches(x.title, name));
        if (hit) { title = hit.title; wiki = 'en'; }
      } catch (e) { /* offline or no match */ }
    }
    if (!title) return null;
    const sum = await j('https://' + wiki + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')));
    if (!sum || !sum.extract) return null;
    return { source: 'Wikipedia', title: sum.title, text: sum.extract, url: sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page, image: sum.thumbnail && sum.thumbnail.source };
  }

  async function npsParksNear(lon, lat) {
    const ctx = await App.ui.placeContext(lon, lat);
    if (!ctx.stateCode || ctx.country !== 'us') return [];
    const key = App.ui.settings.npsKey || 'DEMO_KEY';
    const parks = await j(NPS + '/parks?stateCode=' + ctx.stateCode + '&limit=100&fields=latitude,longitude&api_key=' + encodeURIComponent(key));
    return (parks.data || []).filter(p => p.latitude && hav([lon, lat], [parseFloat(p.longitude), parseFloat(p.latitude)]) < 60000).map(p => p.parkCode);
  }

  async function npsThingsToDo(codes, name) {
    if (!codes.length || !name) return null;
    const key = App.ui.settings.npsKey || 'DEMO_KEY';
    const q = norm(name).replace(/\b(trail|path|loop|route)\b/g, '').trim();
    const r = await j(NPS + '/thingstodo?parkCode=' + codes.join(',') + '&q=' + encodeURIComponent(q) + '&limit=20&api_key=' + encodeURIComponent(key));
    const hit = (r.data || []).find(x => nameMatches(x.title, name));
    if (!hit) return null;
    return {
      source: 'National Park Service', title: hit.title, text: BcReports.strip(hit.longDescription || hit.shortDescription || ''),
      short: BcReports.strip(hit.shortDescription || ''), duration: hit.duration, url: hit.url,
      images: (hit.images || []).slice(0, 4).map(i => ({ src: i.url, credit: i.credit, caption: i.altText || i.title, url: hit.url }))
    };
  }

  async function npsParking(codes, pts) {
    if (!codes.length) return [];
    const key = App.ui.settings.npsKey || 'DEMO_KEY';
    const r = await j(NPS + '/parkinglots?parkCode=' + codes.join(',') + '&limit=100&api_key=' + encodeURIComponent(key));
    return (r.data || []).filter(l => l.latitude && pts.some(p => hav(p, [parseFloat(l.longitude), parseFloat(l.latitude)]) < 1500)).map(l => ({
      name: l.name, text: BcReports.strip(l.description || ''), lon: parseFloat(l.longitude), lat: parseFloat(l.latitude), source: 'National Park Service', fee: l.fees && l.fees.length ? 'yes' : null
    }));
  }

  async function osmParking(pts) {
    const around = pts.map(p => 'nwr["amenity"="parking"](around:450,' + p[1].toFixed(5) + ',' + p[0].toFixed(5) + ');').join('');
    const q = '[out:json][timeout:30];(' + around + ');out tags center qt;';
    const r = await j(OVERPASS + '?data=' + encodeURIComponent(q));
    const seen = new Set();
    return (r.elements || []).map(e => {
      const c = e.center || { lon: e.lon, lat: e.lat }, t = e.tags || {};
      return { name: t.name, capacity: t.capacity, fee: t.fee, surface: t.surface, access: t.access, hours: t.opening_hours, lon: c.lon, lat: c.lat, source: 'OpenStreetMap', id: e.type + e.id };
    }).filter(x => x.lat && !seen.has(x.id) && seen.add(x.id) && x.access !== 'private');
  }

  async function commonsPhotos(pts) {
    const seen = new Set(), out = [];
    for (const p of pts) {
      try {
        const r = await j('https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=' + p[1].toFixed(5) + '%7C' + p[0].toFixed(5) +
          '&ggsradius=500&ggslimit=15&ggsnamespace=6&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=480&format=json&origin=*');
        Object.values((r.query && r.query.pages) || {}).forEach(pg => {
          const ii = pg.imageinfo && pg.imageinfo[0];
          if (!ii || seen.has(pg.title) || !/image\/(jpeg|png)/.test(ii.mime || '') || /\b(map|diagram|sign|plan|logo)\b/i.test(pg.title)) return;
          seen.add(pg.title);
          const md = ii.extmetadata || {};
          out.push({ src: ii.thumburl, url: ii.descriptionurl, credit: BcReports.strip((md.Artist && md.Artist.value) || ''), license: (md.LicenseShortName && md.LicenseShortName.value) || '', caption: pg.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '') });
        });
      } catch (e) { /* skip this sample point */ }
      if (out.length >= 9) break;
    }
    return out.slice(0, 9);
  }

  // ------------------------------------------------------------------ Assembling a profile
  async function build(f) {
    const p = f.properties;
    let geo = null, relTags = {};
    if (p.rel) { try { const r = await relationGeometry(p.rel); if (r.ways.length) { geo = r; relTags = r.tags; } } catch (e) { /* fall back to local data */ } }
    if (!geo) geo = localGeometry(f);
    const path = chain(geo.ways.map(w => w.coords));
    const lengthM = lineLen(path) || lineLen(f.geometry.coordinates);
    const loop = path.length > 2 && hav(path[0], path[path.length - 1]) < 120;
    const samples = path.length > 1 ? resample(path, Math.max(20, Math.min(60, lengthM / 250))) : [];
    const eles = samples.length ? await elevations(samples.map(s => [s[0], s[1]])) : [];
    samples.forEach((s, i) => { s[3] = eles[i]; });
    const prof = samples.length > 1 && eles.some(v => v != null) ? profileStats(samples) : null;
    return { f, name: p.name || relTags.name, relTags, ways: geo.ways.map(w => Object.assign({}, w.props)), path, lengthM, loop, samples, prof };
  }

  // ------------------------------------------------------------------ Full profile (geometry, profile, descriptions, rating), cached
  const profiles = new Map();
  function profileFor(f) {
    const key = f.properties.rel ? 'r' + f.properties.rel : f.properties.id;
    if (profiles.has(key)) return profiles.get(key);
    const p = f.properties;
    const job = (async () => {
      const b = await build(f);
      const mid = b.path.length ? b.path[Math.floor(b.path.length / 2)] : f.geometry.coordinates[0];
      const lang = App.ui.settings.lang;
      const [wiki, codes] = await Promise.all([
        wikipedia(Object.assign({}, p, b.relTags.wikidata ? { wikidata: b.relTags.wikidata } : {}, b.relTags.wikipedia ? { wikipedia: b.relTags.wikipedia } : {}), mid, b.name, lang).catch(() => null),
        npsParksNear(mid[0], mid[1]).catch(() => [])]);
      const nps = await npsThingsToDo(codes, b.name).catch(() => null);
      const osmDesc = p.desc || b.relTags.description;
      const texts = [];
      if (osmDesc) texts.push({ source: 'OpenStreetMap', text: osmDesc });
      if (nps) texts.push({ source: nps.source, text: nps.text });
      if (wiki) texts.push({ source: wiki.source, text: wiki.text });
      const r = rate({ ways: b.ways, texts, lengthM: b.lengthM, gainM: b.prof && b.prof.gain, lossM: b.prof && b.prof.loss, loop: b.loop, maxGrade: b.prof ? b.prof.maxGrade : 0 });
      return { b, r, wiki, nps, codes, mid, osmDesc };
    })();
    profiles.set(key, job);
    job.catch(() => profiles.delete(key));
    if (profiles.size > 40) profiles.delete(profiles.keys().next().value);
    return job;
  }

  // ------------------------------------------------------------------ UI
  const U = () => App.ui;
  const fmtPct = (x) => Math.round(x * 100) + '%';

  function levelBadge(r) {
    const cls = { 1: 'lv1', 2: 'lv2', 3: 'lv3', 4: 'lv4', 5: 'lv5' }[r.level] || 'lv0';
    return '<span class="level ' + cls + '">' + U().esc(U().t(r.key)) + '</span>';
  }

  function profileSvg(samples, sm, imperial) {
    const pts = samples.map((s, i) => [s[2], sm[i]]).filter(p => p[1] != null);
    if (pts.length < 2) return '';
    const W = 340, H = 110, pad = 4;
    const maxX = pts[pts.length - 1][0], minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
    const sx = (x) => pad + x / maxX * (W - pad * 2), sy = (y) => H - pad - (maxY === minY ? 0.5 : (y - minY) / (maxY - minY)) * (H - pad * 2 - 10);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' ');
    const area = d + ' L' + sx(maxX).toFixed(1) + ' ' + (H - pad) + ' L' + sx(0).toFixed(1) + ' ' + (H - pad) + ' Z';
    const u = U();
    return '<svg class="profile" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + u.esc(u.t('td.profile')) + '">' +
      '<path d="' + area + '" class="p-area"/><path d="' + d + '" class="p-line"/></svg>' +
      '<div class="row between small muted"><span>' + u.esc(u.fmtEle(minY)) + '</span><span>' + u.esc(u.fmtEle(maxY)) + '</span></div>';
  }

  async function peek(body, f) {
    const el = body.querySelector('#td-peek');
    if (!el || !HIKING_KINDS.includes(f.properties.kind)) return;
    const u = U();
    el.innerHTML = '<p class="small muted">' + u.esc(u.t('td.working')) + '</p>';
    try {
      const { b, r } = await profileFor(f);
      if (!el.isConnected) return;
      el.innerHTML = '<div class="row" style="gap:8px;flex-wrap:wrap;margin:6px 0">' + levelBadge(r) + '<span class="small">' + u.esc(u.fmtLen(b.lengthM)) + (b.loop ? '' : ' ' + u.esc(u.t('td.oneWay'))) +
        (b.prof ? ' · ↑ ' + u.esc(BcRecord.fmtGain(b.prof.gain)) : '') + '</span></div>';
    } catch (e) { if (el.isConnected) el.innerHTML = ''; }
  }

  async function open(f) {
    const u = U(), t = u.t, esc = u.esc;
    const p = f.properties;
    u.highlight(f);
    const body = u.openSheet('<div class="kind-tag">' + esc(t('kind.' + p.kind)) + '</div>' + u.head(p.name || t('ft.unnamed'), p.routes ? esc(t('ft.partOf') + ': ' + p.routes) : '') +
      '<div id="td-body"><p class="read muted">' + esc(t('td.working')) + '</p></div>');
    const target = () => body.querySelector('#td-body');
    let prof;
    try { prof = await profileFor(f); } catch (e) { if (target()) target().innerHTML = '<p class="read muted">' + esc(t('td.failed')) + '</p>'; return; }
    if (!target()) return;
    const { b, r, wiki, nps, codes, mid } = prof;
    if (b.path.length > 1) { u.data.hl = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: b.path } }] }; u.setData('hl'); }
    const ends = b.path.length ? [b.path[0], b.path[b.path.length - 1]] : [f.geometry.coordinates[0]];
    const hiking = HIKING_KINDS.includes(p.kind);

    let html = '';
    if (hiking) {
      html += '<div class="card"><div class="row between"><div>' + levelBadge(r) + '</div><button class="btn small" id="td-how">' + esc(t('td.how')) + '</button></div>' +
        '<ul class="why">' + r.reasons.map(x => '<li>' + esc(t(x.key, Object.assign({}, x.vars, x.vars && x.vars.grade ? { grade: t('sac.' + x.vars.grade) } : {}))) + '</li>').join('') + '</ul>' +
        (r.techKnown ? '' : '<p class="small muted">' + esc(t('td.noTech')) + '</p>') + '</div>';
    }
    const gain = b.prof ? b.prof.gain : null;
    const rt = b.loop ? b.lengthM : b.lengthM * 2;
    html += u.kvRows([
      [t('td.length'), u.fmtLen(b.lengthM) + (b.loop ? ' ' + t('td.loop') : ' ' + t('td.oneWay'))],
      [t('td.roundTrip'), b.loop ? '' : u.fmtLen(rt)],
      [t('rec.climb'), gain != null ? BcRecord.fmtGain(b.loop ? gain : Math.max(gain, b.prof.loss)) : ''],
      [t('td.high'), b.prof && b.prof.high != null ? u.fmtEle(b.prof.high) : ''],
      [t('td.steepest'), b.prof && b.prof.maxGrade ? fmtPct(b.prof.maxGrade) : ''],
      [t('td.time'), gain != null && hiking ? BcRecord.fmtDur(naismithMs(rt, b.loop ? gain : Math.max(gain, b.prof.loss))) + ' ' + t('td.timeNote') : '']
    ]);
    if (b.prof) html += '<h3 class="section">' + esc(t('td.profile')) + '</h3>' + profileSvg(b.samples, b.prof.smoothed, u.imperial);
    html += '<p class="small muted">' + esc(t('td.dataNote')) + '</p>';
    html += '<div class="btns"><button class="btn small primary" id="td-share">' + u.ICON.image + esc(t('rec.shareCard')) + '</button><button class="btn small" id="td-start">' + u.ICON.nav + esc(t('td.toStart')) + '</button><button class="btn small" id="td-cond">' + u.ICON.cond + esc(t('ft.conditions')) + '</button></div>';

    html += '<h3 class="section">' + esc(t('td.about')) + '</h3>';
    const descs = [nps, wiki].filter(Boolean);
    if (p.desc || b.relTags.description) descs.unshift({ source: 'OpenStreetMap', text: p.desc || b.relTags.description });
    if (!descs.length) html += '<p class="read muted">' + esc(t('td.noDesc')) + '</p>';
    descs.forEach(d => {
      html += '<div class="card"><div class="kind-tag">' + esc(d.source) + (d.duration ? ' · ' + esc(d.duration) : '') + '</div><div class="read r-body" style="max-height:9em;overflow:hidden">' + esc(d.text) + '</div>' +
        (d.url ? '<div class="r-actions" style="margin-top:6px"><a href="#" data-ext="' + esc(d.url) + '">' + esc(t('cond.read')) + '</a></div>' : '') + '</div>';
    });
    html += '<h3 class="section">' + esc(t('td.photos')) + '</h3><div id="td-photos" class="photos"><p class="small muted">' + esc(t('common.loading')) + '</p></div>';
    html += '<h3 class="section">' + esc(t('ft.parking')) + '</h3><div id="td-parking"><p class="small muted">' + esc(t('common.loading')) + '</p></div>';
    target().innerHTML = html;

    const q = (s) => body.querySelector(s);
    if (q('#td-how')) q('#td-how').onclick = () => u.openSheet(u.head(t('td.how')) + '<p class="read">' + esc(t('td.howBody')) + '</p>');
    q('#td-share').onclick = () => BcRecord.shareCard({
      title: b.name || t('ft.unnamed'), line: b.path, trail: true,
      stats: [[t('td.length'), u.fmtLen(b.loop ? b.lengthM : rt)], [t('rec.climb'), gain != null ? BcRecord.fmtGain(b.loop ? gain : Math.max(gain, b.prof.loss)) : '·'], [t('td.rating'), hiking ? t(r.key) : '·']],
      caption: t('td.caption', { name: b.name || t('ft.unnamed') }), filename: 'bristlecone-trail.png'
    });
    q('#td-start').onclick = () => Native.openExternal('geo:' + ends[0][1].toFixed(6) + ',' + ends[0][0].toFixed(6) + '?q=' + ends[0][1].toFixed(6) + ',' + ends[0][0].toFixed(6) + '(' + encodeURIComponent(b.name || 'Trail') + ')');
    q('#td-cond').onclick = () => u.renderConditions({ lon: mid[0], lat: mid[1], label: b.name });
    body.querySelectorAll('[data-ext]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); Native.openExternal(a.dataset.ext); }));

    // Photos: the Park Service's own first, then Wikimedia Commons photos taken near the trail.
    const sample = [ends[0], mid, ends[ends.length - 1]];
    commonsPhotos(sample).catch(() => []).then(photos => {
      const all = (nps ? nps.images : []).concat(photos);
      const el = q('#td-photos'); if (!el) return;
      el.innerHTML = all.length ? all.map(ph => '<a href="#" data-ext="' + esc(ph.url || ph.src) + '" class="photo"><img loading="lazy" src="' + esc(ph.src) + '" alt="' + esc(ph.caption || '') + '"><span>' + esc([ph.credit, ph.license].filter(Boolean).join(' · ')) + '</span></a>').join('') +
        '<p class="small muted" style="grid-column:1/-1">' + esc(t('td.photoNote')) + '</p>' : '<p class="read muted">' + esc(t('td.noPhotos')) + '</p>';
      el.querySelectorAll('[data-ext]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); Native.openExternal(a.dataset.ext); }));
    });
    Promise.all([osmParking(ends).catch(() => []), npsParking(codes, ends).catch(() => [])]).then(([osm, npsLots]) => {
      const el = q('#td-parking'); if (!el) return;
      el.innerHTML = renderParking(npsLots.concat(osm), ends[0]);
      el.querySelectorAll('[data-go]').forEach(bt => bt.onclick = () => { const [lo, la] = bt.dataset.go.split(',').map(Number); Native.openExternal('geo:' + la + ',' + lo + '?q=' + la + ',' + lo + '(' + encodeURIComponent(bt.dataset.name || 'Parking') + ')'); });
    });
  }

  function renderParking(lots, from) {
    const u = U(), t = u.t, esc = u.esc;
    if (!lots.length) return '<p class="read muted">' + esc(t('td.noParking')) + '</p>';
    lots.sort((a, b) => hav(from, [a.lon, a.lat]) - hav(from, [b.lon, b.lat]));
    return lots.slice(0, 5).map(l => '<div class="card"><div class="row between"><div class="grow"><div style="font-weight:600">' + esc(l.name || t('td.parkingLot')) + '</div>' +
      '<div class="small muted">' + esc([u.fmtLen(hav(from, [l.lon, l.lat])) + ' ' + t('td.fromStart'), l.capacity ? t('td.spaces', { n: l.capacity }) : '', l.fee === 'yes' ? t('ft.fee') : l.fee === 'no' ? t('td.free') : '', l.surface, l.hours, l.source].filter(Boolean).join(' · ')) + '</div>' +
      (l.text ? '<div class="read small" style="margin-top:4px;font-size:15px">' + esc(l.text.slice(0, 220)) + '</div>' : '') + '</div>' +
      '<button class="btn small" data-go="' + l.lon + ',' + l.lat + '" data-name="' + esc(l.name || '') + '">' + u.ICON.nav + '</button></div></div>').join('');
  }

  /** Adds nearby parking, photos and the trails that start here to a trailhead card. */
  async function enrichTrailhead(body, lon, lat, p) {
    const u = U(), t = u.t, esc = u.esc;
    const box = document.createElement('div');
    box.innerHTML = '<h3 class="section">' + esc(t('td.fromHere')) + '</h3><div id="th-trails"></div><h3 class="section">' + esc(t('ft.parking')) + '</h3><div id="th-parking"><p class="small muted">' + esc(t('common.loading')) + '</p></div>' +
      '<h3 class="section">' + esc(t('td.photos')) + '</h3><div id="th-photos" class="photos"><p class="small muted">' + esc(t('common.loading')) + '</p></div>';
    body.appendChild(box);
    const near = u.data.trails.features.filter(f => HIKING_KINDS.includes(f.properties.kind) && f.properties.name && f.geometry.coordinates.some(c => hav(c, [lon, lat]) < 150));
    const byName = new Map(); near.forEach(f => { if (!byName.has(f.properties.name)) byName.set(f.properties.name, f); });
    const tl = box.querySelector('#th-trails');
    tl.innerHTML = byName.size ? Array.from(byName.values()).map((f, i) => '<button class="btn small" data-trail="' + i + '" style="margin:0 6px 6px 0">' + esc(f.properties.name) + '</button>').join('') : '<p class="small muted">' + esc(t('td.noTrailsHere')) + '</p>';
    const arr = Array.from(byName.values());
    tl.querySelectorAll('[data-trail]').forEach(bt => bt.onclick = () => open(arr[+bt.dataset.trail]));
    const [osm, codes] = await Promise.all([osmParking([[lon, lat]]).catch(() => []), npsParksNear(lon, lat).catch(() => [])]);
    const npsLots = await npsParking(codes, [[lon, lat]]).catch(() => []);
    const pk = box.querySelector('#th-parking');
    if (pk) {
      pk.innerHTML = renderParking(npsLots.concat(osm), [lon, lat]);
      pk.querySelectorAll('[data-go]').forEach(bt => bt.onclick = () => { const [lo, la] = bt.dataset.go.split(',').map(Number); Native.openExternal('geo:' + la + ',' + lo + '?q=' + la + ',' + lo + '(' + encodeURIComponent(bt.dataset.name || 'Parking') + ')'); });
    }
    const photos = await commonsPhotos([[lon, lat]]).catch(() => []);
    const ph = box.querySelector('#th-photos');
    if (ph) {
      ph.innerHTML = photos.length ? photos.map(x => '<a href="#" data-ext="' + esc(x.url) + '" class="photo"><img loading="lazy" src="' + esc(x.src) + '" alt="' + esc(x.caption || '') + '"><span>' + esc([x.credit, x.license].filter(Boolean).join(' · ')) + '</span></a>').join('') + '<p class="small muted" style="grid-column:1/-1">' + esc(t('td.photoNote')) + '</p>' : '<p class="read muted">' + esc(t('td.noPhotos')) + '</p>';
      ph.querySelectorAll('[data-ext]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); Native.openExternal(a.dataset.ext); }));
    }
  }

  window.BcTrail = { open, peek, enrichTrailhead, rate, chain, resample, profileStats, textLevel, naismithMs, nameMatches, build };
})();
