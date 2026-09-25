/* Public data loaders. Every request is a plain GET with a deterministic URL so the native layer
   can store it, which is what makes downloaded regions work with no signal. */
(function () {
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0/query';
  const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/AIANNHA/MapServer/';
  const CLSS = 'https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/';
  const CPCAD = 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CPCAD/MapServer/0/query';
  const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
  const AVY_US = 'https://api.avalanche.org/v2/public/products/map-layer';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OPENBETA = 'https://api.openbeta.io';

  const TRAIL_Z = 11;   // trail data cell size (about 20 km)
  const LAND_Z = 8;     // land boundary cell size (about 150 km)

  // ------------------------------------------------------------------ Tile math
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * (1 << z));
  const lat2y = (lat, z) => {
    const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
  };
  const x2lon = (x, z) => x / (1 << z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (1 << z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  function tileBbox(x, y, z) { return [x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)]; }
  function tilesFor(bbox, z) {
    const [w, s, e, n] = bbox;
    const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, z]);
    return out;
  }
  const r5 = (v) => Math.round(v * 1e5) / 1e5;

  // Approximate outline of Canada (clockwise from the Alaska border), used to pick imagery and
  // report sources. Accurate to within about 20 miles, which is all those choices need.
  const CANADA = [[-141, 60.3], [-137.5, 59.2], [-135.5, 59.8], [-133.4, 58.4], [-131.6, 56.6], [-130.1, 55.9], [-130.6, 54.7],
    [-134.5, 54.5], [-133.5, 51.5], [-128.5, 48.3], [-123.2, 48.25], [-123.2, 49.0], [-95.15, 49.0], [-94.8, 49.35], [-94.6, 48.7],
    [-93.0, 48.6], [-91.0, 48.2], [-89.6, 48.0], [-88.4, 48.3], [-84.8, 46.9], [-84.1, 46.5], [-83.5, 46.0], [-82.4, 45.3],
    [-82.4, 43.0], [-82.93, 42.35], [-83.07, 42.305], [-83.13, 42.0], [-81.0, 42.2], [-79.1, 42.85], [-79.05, 43.25], [-79.2, 43.5], [-76.5, 43.6],
    [-76.3, 44.2], [-75.3, 44.9], [-74.7, 45.0], [-71.5, 45.0], [-70.8, 45.4], [-70.3, 46.0], [-70.0, 46.7], [-69.2, 47.45],
    [-68.2, 47.35], [-67.8, 47.07], [-67.78, 45.8], [-67.4, 45.6], [-66.9, 44.8], [-66.0, 43.3], [-50, 43.3], [-50, 84], [-141, 84]];
  function inRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function countryOf(lon, lat) { return inRing(lon, lat, CANADA) ? 'ca' : 'us'; }

  function haversine(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dp = (b[1] - a[1]) * rad, dl = (b[0] - a[0]) * rad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ------------------------------------------------------------------ Fetch helpers
  async function getJson(url, opts) {
    const r = await fetch(url, opts);
    const meta = { fetched: Number(r.headers.get('X-Bc-Fetched')) || Date.now(), stale: r.headers.get('X-Bc-Stale') === '1' };
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const j = await r.json();
    return { json: j, meta };
  }

  // ------------------------------------------------------------------ Trails (OpenStreetMap via Overpass)
  function overpassQuery(b) {
    const bb = [r5(b[1]), r5(b[0]), r5(b[3]), r5(b[2])].join(',');
    return '[out:json][timeout:90];(' +
      'way["highway"~"^(path|footway|bridleway|steps|cycleway|track|via_ferrata)$"]["footway"!~"^(sidewalk|crossing|traffic_island)$"]["area"!="yes"](' + bb + ');' +
      'way["piste:type"](' + bb + ');' +
      'way["atv"~"^(yes|designated)$"](' + bb + ');' +
      'node["highway"="trailhead"](' + bb + ');' +
      'node["sport"="climbing"](' + bb + ');' +
      'node["climbing"~"^(route|route_bottom|crag)$"](' + bb + ');' +
      ');out tags geom qt;' +
      'rel["route"~"^(hiking|foot|mtb|bicycle|horse|ski|piste)$"](' + bb + ');out body qt;';
  }

  function overpassUrls(x, y, z) {
    const q = encodeURIComponent(overpassQuery(tileBbox(x, y, z)));
    return OVERPASS.map(base => base + '?data=' + q);
  }

  function classify(t) {
    const hw = t.highway;
    const pt = t['piste:type'];
    if (pt) {
      if (pt === 'downhill') return 'ski_downhill';
      if (pt === 'nordic') return 'ski_nordic';
      return 'ski_other';
    }
    if (hw === 'via_ferrata' || t.via_ferrata_scale) return 'via_ferrata';
    const motor = /^(yes|designated|permissive)$/;
    if (motor.test(t.atv || '') || motor.test(t.ohv || '') || (hw === 'path' && motor.test(t.motorcycle || ''))) return 'atv';
    if (hw === 'track') return 'track';
    if (hw === 'cycleway' || ((t['mtb:scale'] || t.bicycle === 'designated') && t.foot !== 'designated' && hw === 'path')) return 'bike';
    if (hw === 'bridleway' || (t.horse === 'designated' && t.foot !== 'designated' && hw === 'path')) return 'horse';
    if (hw === 'steps') return 'steps';
    if (hw === 'footway') return 'footway';
    return 'hiking';
  }

  function addrOf(t) {
    const line1 = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const line2 = [t['addr:city'], t['addr:state'] || t['addr:province'], t['addr:postcode']].filter(Boolean).join(', ');
    return [line1, line2].filter(Boolean).join(', ') || null;
  }

  function parseOverpass(j) {
    const trails = [], points = [];
    const routeNames = {}, routeRel = {};
    (j.elements || []).forEach(el => {
      if (el.type === 'relation' && el.members) {
        const nm = el.tags && (el.tags.name || el.tags.ref);
        if (!nm) return;
        el.members.forEach(m => {
          if (m.type !== 'way') return;
          (routeNames[m.ref] = routeNames[m.ref] || []).push(nm);
          // Remember the most specific hiking route (smallest relation) for trail details.
          const cur = routeRel[m.ref];
          if (!cur || el.members.length < cur.n) routeRel[m.ref] = { id: el.id, n: el.members.length, wd: el.tags.wikidata, wp: el.tags.wikipedia };
        });
      }
    });
    (j.elements || []).forEach(el => {
      const t = el.tags || {};
      if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
        const kind = classify(t);
        const routes = routeNames[el.id] ? Array.from(new Set(routeNames[el.id])) : [];
        const props = {
          id: 'w' + el.id, kind, name: t.name || t['piste:name'] || routes[0] || undefined,
          sac: t.sac_scale, difficulty: t['piste:difficulty'], surface: t.surface, vis: t.trail_visibility,
          access: t.access, surveyed: t.check_date || t['survey:date'] || t['check_date:surface'], mtb: t['mtb:scale'],
          width: t.width, lit: t.lit, oneway: t.oneway, routes: routes.join(' · ') || undefined,
          ref: t.ref, grooming: t['piste:grooming'], seasonal: t.seasonal, fee: t.fee,
          rel: routeRel[el.id] ? routeRel[el.id].id : undefined,
          wikidata: t.wikidata || (routeRel[el.id] && routeRel[el.id].wd), wikipedia: t.wikipedia || (routeRel[el.id] && routeRel[el.id].wp),
          ladder: t.ladder, hazard: t.hazard, vf: t.via_ferrata_scale, scramble: t.scramble, desc: t.description
        };
        Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
        trails.push({ type: 'Feature', id: el.id, properties: props, geometry: { type: 'LineString', coordinates: el.geometry.map(g => [r5(g.lon), r5(g.lat)]) } });
      } else if (el.type === 'node') {
        let kind = null;
        if (t.highway === 'trailhead') kind = 'trailhead';
        else if (t.sport === 'climbing' || t.climbing) kind = 'climb';
        if (!kind) return;
        const props = { id: 'n' + el.id, kind, name: t.name, addr: addrOf(t), ele: t.ele, parking: t.parking, fee: t.fee, operator: t.operator,
          grade: t['climbing:grade:yds_class'] || t['climbing:grade:uiaa'] || t['climbing:grade:french'], routes: t['climbing:routes'], website: t.website };
        Object.keys(props).forEach(k => (props[k] === undefined || props[k] === null) && delete props[k]);
        points.push({ type: 'Feature', id: el.id, properties: props, geometry: { type: 'Point', coordinates: [r5(el.lon), r5(el.lat)] } });
      }
    });
    return { trails, points };
  }

  async function loadTrailCell(x, y, z) {
    let lastErr;
    for (const url of overpassUrls(x, y, z)) {
      try {
        const { json, meta } = await getJson(url);
        if (json.remark && /runtime error|timed out/i.test(json.remark) && !(json.elements || []).length) throw new Error(json.remark);
        return Object.assign(parseOverpass(json), { meta });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('overpass');
  }

  // ------------------------------------------------------------------ ArcGIS helpers (lands, fire)
  function arcgisUrl(base, bbox, fields, where, extra) {
    const p = new URLSearchParams({
      where: where || '1=1', geometry: bbox.map(r5).join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'true', outSR: '4326',
      maxAllowableOffset: '0.0006', geometryPrecision: '5', resultRecordCount: '1000', f: 'geojson'
    });
    if (extra) Object.keys(extra).forEach(k => p.set(k, extra[k]));
    return base + '?' + p.toString();
  }

  // Signed area: positive for counter-clockwise rings. Esri outer rings are clockwise, holes counter-clockwise.
  function ringArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
  function esriToGeoJson(j) {
    return {
      type: 'FeatureCollection', features: (j.features || []).filter(f => f.geometry && f.geometry.rings).map(f => {
        const polys = [];
        f.geometry.rings.forEach(r => { if (ringArea(r) <= 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r); });
        return { type: 'Feature', properties: f.attributes || {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
      })
    };
  }

  async function arcgis(url) {
    const { json, meta } = await getJson(url);
    if (json && json.type === 'FeatureCollection') return { fc: json, meta };
    if (json && json.error) {
      const alt = url.replace('f=geojson', 'f=json');
      const r = await getJson(alt);
      if (r.json.error) throw new Error(r.json.error.message || 'arcgis');
      return { fc: esriToGeoJson(r.json), meta: r.meta };
    }
    if (json && json.features) return { fc: esriToGeoJson(json), meta };
    throw new Error('arcgis format');
  }

  function padusMgr(p) {
    const n = (p.Mang_Name || '').toUpperCase(), t = (p.Mang_Type || '').toUpperCase();
    if (['NPS', 'USFS', 'BLM', 'FWS'].includes(n)) return n;
    if (['STAT', 'LOC', 'TRIB', 'FED', 'NGO'].includes(t)) return t;
    return 'OTH';
  }
  function cpcadMgr(p) {
    const s = [p.MGMT_E, p.OWNER_TYPE, p.GOV_TYPE, p.TYPE_E].map(v => String(v || '').toLowerCase()).join(' ');
    if (s.includes('parks canada')) return 'PC';
    if (/indigenous|first nation|inuit|métis|metis/.test(s)) return 'TRIB';
    if (s.includes('municipal') || s.includes('regional')) return 'LOC';
    if (s.includes('federal')) return 'FED';
    if (/non-governmental|ngo|trust|conservancy/.test(s)) return 'NGO';
    return 'STAT';
  }

  function landSources(bbox) {
    const [w, s, e, n] = bbox;
    const usLike = s < 49.6 || (w < -129 && n > 51);
    const caLike = n > 41.6 && !(e < -141.1 && s > 51);
    const list = [];
    if (usLike) {
      list.push({ id: 'padus', url: arcgisUrl(PADUS, bbox, 'Unit_Nm,Mang_Name,Mang_Type,Des_Tp,Pub_Access', "Mang_Type<>'PVT'"),
        map: p => ({ name: p.Unit_Nm, mgr: padusMgr(p), des: p.Des_Tp, access: p.Pub_Access, src: 'PAD-US' }) });
      [2, 3, 4].forEach(id => list.push({ id: 'tiger' + id, url: arcgisUrl(TIGER + id + '/query', bbox, 'NAME,BASENAME'),
        map: p => ({ name: p.NAME || p.BASENAME, mgr: 'TRIB', src: 'US Census TIGER' }) }));
    }
    if (caLike) {
      list.push({ id: 'clss0', url: arcgisUrl(CLSS + '0/query', bbox, 'adminAreaNameEng,adminAreaNameAlt1'),
        map: p => ({ name: p.adminAreaNameEng, nameFr: p.adminAreaNameAlt1, mgr: 'TRIB', src: 'NRCan CLSS' }) });
      list.push({ id: 'clss1', url: arcgisUrl(CLSS + '1/query', bbox, 'adminAreaNameEng,adminAreaNameAlt1'),
        map: p => ({ name: p.adminAreaNameEng, nameFr: p.adminAreaNameAlt1, mgr: 'PC', src: 'NRCan CLSS' }) });
      list.push({ id: 'cpcad', url: arcgisUrl(CPCAD, bbox, 'NAME_E,NAME_F,TYPE_E,MGMT_E,OWNER_TYPE,GOV_TYPE'),
        map: p => ({ name: p.NAME_E, nameFr: p.NAME_F, mgr: cpcadMgr(p), des: p.TYPE_E, src: 'ECCC CPCAD' }) });
    }
    return list;
  }

  function landUrls(x, y, z) { return landSources(tileBbox(x, y, z)).map(s => s.url); }

  async function loadLandCell(x, y, z, lang) {
    const out = [];
    const srcs = landSources(tileBbox(x, y, z));
    await Promise.all(srcs.map(async s => {
      try {
        const { fc } = await arcgis(s.url);
        fc.features.forEach((f, i) => {
          if (!f.geometry) return;
          const p = s.map(f.properties || {});
          if (lang === 'fr-CA' && p.nameFr) p.name = p.nameFr;
          p.fid = s.id + ':' + (f.id !== undefined ? f.id : i) + ':' + (p.name || '');
          Object.keys(p).forEach(k => (p[k] === undefined || p[k] === null) && delete p[k]);
          out.push({ type: 'Feature', properties: p, geometry: f.geometry });
        });
      } catch (e) { /* one source failing should not hide the others */ }
    }));
    return out;
  }

  // ------------------------------------------------------------------ Hazards
  function fireUrl(bbox) {
    return arcgisUrl(WFIGS, bbox, '*', '1=1', { maxAllowableOffset: '0.001' });
  }
  function fireProps(p) {
    const name = p.poly_IncidentName || p.attr_IncidentName || p.IncidentName || 'Fire';
    const acres = p.poly_GISAcres || p.attr_IncidentSize || p.GISAcres;
    const pct = p.attr_PercentContained;
    const date = p.poly_DateCurrent || p.attr_ModifiedOnDateTime_dt || p.poly_PolygonDateTime || p.attr_FireDiscoveryDateTime;
    return { name, acres: acres ? Math.round(acres) : null, pct: pct === undefined ? null : pct, date: typeof date === 'number' ? date : Date.parse(date) || null };
  }
  async function loadFires(bbox) {
    const { fc, meta } = await arcgis(fireUrl(bbox));
    fc.features.forEach(f => { f.properties = fireProps(f.properties || {}); });
    return { fc, meta };
  }
  async function loadAvyUS() {
    const { json, meta } = await getJson(AVY_US);
    return { fc: json, meta };
  }

  // ------------------------------------------------------------------ Climbing crags (OpenBeta)
  async function loadCrags(lon, lat) {
    const key = 'crags_' + (Math.round(lat * 4) / 4) + '_' + (Math.round(lon * 4) / 4);
    const cached = Native.kvGetJson(key);
    const fresh = cached && Date.now() - cached.t < 14 * 86400000;
    if (fresh || (cached && !navigator.onLine)) return cached.fc;
    const query = 'query Near($lat: Float!, $lng: Float!) { cragsNear(lnglat: {lat: $lat, lng: $lng}, maxDistance: 45000, includeCrags: true) { count crags { areaName uuid totalClimbs metadata { lat lng } } } }';
    try {
      const r = await fetch(OPENBETA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { lat: Math.round(lat * 4) / 4, lng: Math.round(lon * 4) / 4 } }) });
      const j = await r.json();
      const groups = (j.data && j.data.cragsNear) || [];
      const seen = new Set();
      const feats = [];
      groups.forEach(g => (g.crags || []).forEach(c => {
        if (!c.metadata || seen.has(c.uuid)) return;
        seen.add(c.uuid);
        feats.push({ type: 'Feature', properties: { kind: 'crag', name: c.areaName, climbs: c.totalClimbs, uuid: c.uuid }, geometry: { type: 'Point', coordinates: [c.metadata.lng, c.metadata.lat] } });
      }));
      const fc = { type: 'FeatureCollection', features: feats };
      Native.kvPutJson(key, { t: Date.now(), fc });
      return fc;
    } catch (e) {
      return cached ? cached.fc : { type: 'FeatureCollection', features: [] };
    }
  }

  // ------------------------------------------------------------------ Geocoding (Nominatim)
  async function search(q, lang, near) {
    const p = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'us,ca', limit: '8', 'accept-language': lang });
    if (near) p.set('viewbox', [near[0] - 3, near[1] + 3, near[0] + 3, near[1] - 3].join(','));
    const { json } = await getJson(NOMINATIM + '/search?' + p.toString());
    return json;
  }
  function reverseUrl(lon, lat, lang, zoom) {
    const p = new URLSearchParams({ format: 'jsonv2', lat: r5(lat), lon: r5(lon), zoom: String(zoom || 17), addressdetails: '1', 'accept-language': lang });
    return NOMINATIM + '/reverse?' + p.toString();
  }
  async function reverse(lon, lat, lang, zoom) {
    const { json } = await getJson(reverseUrl(lon, lat, lang, zoom));
    return json;
  }
  function formatAddress(r) {
    if (!r || !r.address) return null;
    const a = r.address;
    const road = a.road || a.highway || a.track || a.path;
    if (!road) return null;
    const line1 = [a.house_number, road].filter(Boolean).join(' ');
    const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
    const line2 = [town, a.state || a.province, a.postcode].filter(Boolean).join(', ');
    return [line1, line2].filter(Boolean).join(', ');
  }

  window.BcData = {
    countryOf, TRAIL_Z, LAND_Z, tilesFor, tileBbox, lon2x, lat2y, haversine,
    loadTrailCell, overpassUrls, loadLandCell, landUrls, loadFires, fireUrl, loadAvyUS, AVY_US,
    loadCrags, search, reverse, reverseUrl, formatAddress, getJson, classify, parseOverpass, esriToGeoJson
  };
})();
