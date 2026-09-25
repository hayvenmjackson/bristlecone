/* Search by hiking region ("Southern Utah", "Wyoming mountains", "coastal Maine", "North Maine Woods",
   "Grand Canyon area") and list the named trails in it. Regions are outlined with one or more
   boxes [west, south, east, north]; states, provinces and parks found by search work too. */
(function () {
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const R = (id, en, boxes, extra) => Object.assign({ id, en, boxes }, extra || {});

  const REGIONS = [
    // Utah
    R('n-utah', 'Northern Utah', [[-114.05, 40.3, -109.0, 42.0]], { es: 'Norte de Utah', fr: 'Nord de l’Utah', aka: ['north utah', 'northern ut'] }),
    R('s-utah', 'Southern Utah', [[-114.05, 37.0, -109.04, 38.6]], { es: 'Sur de Utah', fr: 'Sud de l’Utah', aka: ['south utah', 'southern ut', 'utah canyon country'] }),
    R('wasatch', 'Wasatch Range', [[-112.0, 40.2, -111.4, 41.9]], { aka: ['wasatch', 'wasatch front', 'salt lake mountains', 'cache valley mountains'] }),
    R('uintas', 'Uinta Mountains', [[-111.3, 40.45, -109.6, 41.0]], { aka: ['uintas', 'high uintas'] }),
    R('zion', 'Zion National Park', [[-113.25, 37.13, -112.85, 37.53]], { aka: ['zion'] }),
    R('bryce', 'Bryce Canyon', [[-112.3, 37.45, -112.07, 37.72]], { aka: ['bryce'] }),
    R('moab', 'Moab, Arches and Canyonlands', [[-110.3, 38.0, -109.3, 38.85]], { aka: ['moab', 'arches', 'canyonlands'] }),
    R('capreef', 'Capitol Reef', [[-111.4, 37.6, -110.9, 38.5]], { aka: ['capitol reef'] }),
    R('gsenm', 'Grand Staircase-Escalante', [[-112.1, 37.0, -110.9, 38.0]], { aka: ['escalante', 'grand staircase'] }),
    // Wyoming
    R('wy-mtns', 'Wyoming mountains', [[-111.0, 43.5, -110.6, 44.1], [-110.1, 42.4, -108.8, 43.5], [-110.3, 43.6, -109.2, 45.0], [-107.9, 43.9, -106.9, 45.0], [-106.6, 40.99, -105.9, 41.6], [-110.8, 43.2, -110.1, 43.6], [-111.0, 42.3, -110.4, 43.3], [-105.6, 41.0, -105.1, 42.5]],
      { es: 'Montañas de Wyoming', fr: 'Montagnes du Wyoming', aka: ['wyoming mountains', 'mountains of wyoming', 'wyoming ranges'] }),
    R('tetons', 'Grand Teton and the Tetons', [[-110.95, 43.6, -110.4, 44.15]], { aka: ['tetons', 'grand teton', 'jackson hole'] }),
    R('yellowstone', 'Yellowstone', [[-111.16, 44.13, -109.83, 45.11]], { aka: ['yellowstone national park'] }),
    R('windrivers', 'Wind River Range', [[-110.1, 42.4, -108.8, 43.5]], { aka: ['wind rivers', 'winds', 'cirque of the towers'] }),
    R('bighorns', 'Bighorn Mountains', [[-107.9, 43.9, -106.9, 45.0]], { aka: ['bighorns', 'cloud peak'] }),
    R('snowyrange', 'Snowy Range and Medicine Bow', [[-106.6, 40.99, -105.9, 41.6]], { aka: ['snowy range', 'medicine bow', 'medicine bow mountains'] }),
    R('laramie', 'Laramie Range and Vedauwoo', [[-105.6, 41.0, -105.1, 42.5]], { aka: ['vedauwoo', 'laramie peak', 'curt gowdy'] }),
    R('beartooth', 'Beartooth Mountains', [[-110.2, 44.95, -109.2, 45.4]], { aka: ['beartooths', 'beartooth plateau'] }),
    // Maine and New England
    R('me-coast', 'Coastal Maine', [[-70.8, 43.05, -69.8, 43.95], [-69.9, 43.7, -68.7, 44.5], [-68.8, 44.2, -66.95, 44.95]], { es: 'Costa de Maine', fr: 'Côte du Maine', aka: ['maine coast', 'coast of maine', 'downeast', 'down east', 'midcoast maine'] }),
    R('nmw', 'North Maine Woods', [[-70.3, 45.9, -68.6, 47.4]], { fr: 'Forêts du nord du Maine', aka: ['north woods', 'maine north woods', 'allagash'] }),
    R('acadia', 'Acadia and Mount Desert Island', [[-68.5, 44.2, -68.1, 44.45]], { aka: ['acadia', 'mount desert island', 'mdi', 'bar harbor'] }),
    R('baxter', 'Baxter State Park and Katahdin', [[-69.15, 45.8, -68.75, 46.3]], { aka: ['katahdin', 'baxter'] }),
    R('w-maine', 'Western Maine Mountains', [[-71.1, 44.3, -69.9, 45.5]], { aka: ['western maine', 'rangeley', 'bigelow', 'mahoosucs'] }),
    R('100mile', '100-Mile Wilderness', [[-69.9, 45.4, -68.9, 45.95]], { aka: ['hundred mile wilderness', '100 mile wilderness'] }),
    R('whites', 'White Mountains (New Hampshire)', [[-71.9, 43.9, -70.95, 44.5]], { aka: ['white mountains', 'whites', 'presidentials', 'franconia'] }),
    R('greens', 'Green Mountains (Vermont)', [[-73.3, 42.73, -72.5, 45.0]], { aka: ['green mountains', 'long trail'] }),
    R('adks', 'Adirondacks', [[-75.3, 43.3, -73.4, 44.8]], { aka: ['adirondack', 'adks', 'high peaks'] }),
    R('catskills', 'Catskills', [[-74.7, 41.85, -73.95, 42.4]], { aka: ['catskill mountains'] }),
    R('berkshires', 'Berkshires', [[-73.5, 42.0, -72.9, 42.75]], { aka: ['berkshire', 'mount greylock'] }),
    // Southwest
    R('gcanyon', 'Grand Canyon area', [[-113.4, 35.7, -111.5, 36.6]], { es: 'Región del Gran Cañón', fr: 'Région du Grand Canyon', aka: ['grand canyon', 'gran canon', 'grand canyon region'] }),
    R('sedona', 'Sedona and Red Rock Country', [[-111.95, 34.7, -111.6, 35.0]], { aka: ['sedona', 'red rock country'] }),
    R('superstitions', 'Superstition Mountains', [[-111.5, 33.3, -111.0, 33.6]], { aka: ['superstitions'] }),
    // Colorado
    R('rmnp', 'Rocky Mountain National Park', [[-105.95, 40.15, -105.48, 40.56]], { aka: ['rocky mountain national park', 'rmnp', 'estes park'] }),
    R('frontrange', 'Colorado Front Range', [[-106.0, 39.3, -105.0, 40.8]], { aka: ['front range', 'indian peaks', 'boulder mountains'] }),
    R('sanjuans', 'San Juan Mountains', [[-108.4, 37.3, -106.6, 38.3]], { aka: ['san juans', 'ouray', 'telluride', 'silverton'] }),
    R('sawatch', 'Sawatch Range and Collegiate Peaks', [[-106.7, 38.4, -106.1, 39.5]], { aka: ['sawatch', 'collegiate peaks'] }),
    R('elks', 'Elk Mountains and Maroon Bells', [[-107.3, 38.8, -106.7, 39.25]], { aka: ['maroon bells', 'elk mountains', 'aspen'] }),
    // California and the Pacific Northwest
    R('yosemite', 'Yosemite', [[-119.9, 37.49, -119.2, 38.19]], { aka: ['yosemite national park'] }),
    R('sierra', 'Sierra Nevada', [[-120.8, 35.6, -117.9, 39.9]], { es: 'Sierra Nevada', aka: ['high sierra', 'sierras'] }),
    R('tahoe', 'Lake Tahoe', [[-120.3, 38.75, -119.85, 39.3]], { aka: ['tahoe'] }),
    R('joshuatree', 'Joshua Tree', [[-116.5, 33.67, -115.25, 34.13]], { aka: ['joshua tree national park'] }),
    R('bigsur', 'Big Sur', [[-121.95, 35.8, -121.3, 36.45]]),
    R('ncascades', 'North Cascades', [[-121.9, 48.3, -120.5, 49.0]], { aka: ['north cascades national park'] }),
    R('rainier', 'Mount Rainier', [[-122.0, 46.7, -121.45, 47.0]], { aka: ['rainier'] }),
    R('olympic', 'Olympic Peninsula', [[-124.8, 47.3, -123.0, 48.4]], { aka: ['olympics', 'olympic national park'] }),
    R('gorge', 'Columbia River Gorge', [[-122.4, 45.5, -121.2, 45.8]], { aka: ['columbia gorge', 'the gorge'] }),
    R('or-cascades', 'Oregon Cascades', [[-122.3, 43.0, -121.5, 45.5]], { aka: ['central oregon cascades', 'three sisters', 'mount hood'] }),
    // Northern Rockies
    R('glacier', 'Glacier National Park (Montana)', [[-114.5, 48.2, -113.2, 49.0]], { aka: ['glacier national park', 'glacier np'] }),
    R('sawtooths', 'Sawtooth Mountains', [[-115.3, 43.7, -114.8, 44.35]], { aka: ['sawtooths', 'stanley idaho'] }),
    // East and South
    R('smokies', 'Great Smoky Mountains', [[-84.0, 35.43, -83.0, 35.8]], { aka: ['smokies', 'great smokies'] }),
    R('shenandoah', 'Shenandoah and the Blue Ridge', [[-78.9, 38.0, -78.0, 38.95]], { aka: ['shenandoah', 'blue ridge'] }),
    R('ozarks', 'Ozarks', [[-94.5, 35.5, -91.0, 37.3]], { aka: ['ozark mountains'] }),
    // Alaska
    R('kenai', 'Kenai and Chugach', [[-151.5, 59.5, -148.5, 61.5]], { aka: ['kenai peninsula', 'chugach'] }),
    R('denali', 'Denali', [[-152.0, 62.9, -149.3, 63.8]], { aka: ['denali national park'] }),
    // Canada
    R('banff', 'Banff', [[-116.6, 50.7, -115.4, 51.8]], { aka: ['banff national park', 'lake louise'] }),
    R('jasper', 'Jasper', [[-119.0, 52.1, -117.0, 53.5]], { aka: ['jasper national park'] }),
    R('canrockies', 'Canadian Rockies', [[-120.0, 49.0, -114.0, 54.0]], { fr: 'Rocheuses canadiennes', es: 'Rocosas canadienses', aka: ['rockies canada', 'rocheuses'] }),
    R('kananaskis', 'Kananaskis', [[-115.5, 50.5, -114.7, 51.1]], { aka: ['kananaskis country', 'k country'] }),
    R('yoho', 'Yoho and Kootenay', [[-116.7, 50.5, -115.8, 51.6]], { aka: ['yoho', 'kootenay'] }),
    R('waterton', 'Waterton Lakes', [[-114.2, 49.0, -113.7, 49.2]], { aka: ['waterton'] }),
    R('seatosky', 'Sea to Sky and Whistler', [[-123.3, 49.6, -122.7, 50.2]], { aka: ['whistler', 'squamish', 'garibaldi'] }),
    R('vanisland', 'Vancouver Island', [[-128.5, 48.3, -123.2, 50.8]], { fr: 'Île de Vancouver', aka: ['west coast trail', 'strathcona'] }),
    R('laurentides', 'Laurentians', [[-75.5, 45.8, -73.5, 46.9]], { fr: 'Laurentides', aka: ['laurentides', 'mont-tremblant', 'mont tremblant'] }),
    R('charlevoix', 'Charlevoix', [[-71.0, 47.3, -70.0, 48.1]], { aka: ['hautes-gorges'] }),
    R('gaspesie', 'Gaspé Peninsula', [[-67.5, 48.0, -64.2, 49.3]], { fr: 'Gaspésie', aka: ['gaspesie', 'chic-chocs', 'mont albert'] }),
    R('capebreton', 'Cape Breton Highlands', [[-61.2, 46.5, -60.2, 47.05]], { fr: 'Hautes-Terres-du-Cap-Breton', aka: ['cape breton', 'cabot trail'] }),
    R('grosmorne', 'Gros Morne', [[-58.2, 49.3, -57.4, 49.9]], { aka: ['gros morne national park'] }),
    R('algonquin', 'Algonquin', [[-79.0, 45.2, -77.7, 46.1]], { aka: ['algonquin park'] }),
    R('bruce', 'Bruce Peninsula', [[-81.8, 44.7, -81.1, 45.3]], { fr: 'Péninsule Bruce', aka: ['bruce trail', 'tobermory'] }),
    R('fundy', 'Fundy', [[-65.4, 45.5, -64.9, 45.75]], { aka: ['fundy national park', 'bay of fundy'] })
  ];

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const STRIP = /\b(trails?|hikes?|hiking|in|near|around|the|area|region|senderos?|rutas?|en|de|del|la|el|sentiers?|randonnees?|dans|du|des|le|les)\b/g;

  function nameFor(r, lang) {
    if (lang === 'fr-CA' && r.fr) return r.fr;
    if (lang === 'es-419' && r.es) return r.es;
    return r.en;
  }

  /** Regions matching a query, best first. "trails in southern utah" and "sur de utah" both work. */
  function match(q, lang) {
    const raw = norm(q), core = raw.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
    if (core.length < 3) return [];
    const scored = [];
    REGIONS.forEach(r => {
      const names = [r.en, r.fr, r.es].concat(r.aka || []).filter(Boolean).map(norm);
      let best = 0;
      names.forEach(n => {
        const nc = n.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
        if (nc === core) best = Math.max(best, 100);
        else if (nc.startsWith(core) || core.startsWith(nc)) best = Math.max(best, 80);
        else if (nc.includes(core) || core.includes(nc)) best = Math.max(best, 60);
        else {
          const a = new Set(core.split(' ')), b = nc.split(' ');
          const common = b.filter(w => a.has(w) && w.length > 2).length;
          if (common) best = Math.max(best, 30 * common / Math.max(a.size, b.length));
        }
      });
      if (best >= 30) scored.push({ r, score: best });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 4).map(x => ({ id: x.r.id, name: nameFor(x.r, lang), boxes: x.r.boxes }));
  }

  function bboxOf(boxes) {
    return boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [180, 90, -180, -90]);
  }

  function trailsQuery(boxes) {
    const bb = (b) => [b[1], b[0], b[3], b[2]].map(v => v.toFixed(3)).join(',');
    const rels = boxes.map(b => 'rel["route"~"^(hiking|foot)$"]["name"](' + bb(b) + ');').join('');
    const ways = boxes.map(b => 'way["highway"~"^(path|footway)$"]["name"~"Trail|Path|Loop|Sentier|Sendero|Notch|Ridge",i](' + bb(b) + ');').join('');
    return '[out:json][timeout:120];(' + rels + ');out tags center qt 300;(' + ways + ');out tags center qt 1500;';
  }

  /** Named trails in a region: route relations first (major and signed routes), then named paths. */
  async function trails(boxes) {
    const { json } = await BcData.getJson(OVERPASS + '?data=' + encodeURIComponent(trailsQuery(boxes)));
    const by = new Map();
    (json.elements || []).forEach(e => {
      const tg = e.tags || {};
      const name = tg.name;
      if (!name || !e.center) return;
      const key = name.toLowerCase();
      const cur = by.get(key) || { name, rel: null, ways: 0, center: [e.center.lon, e.center.lat], notable: false, sac: null, network: null };
      if (e.type === 'relation') { cur.rel = e.id; cur.center = [e.center.lon, e.center.lat]; cur.network = tg.network || cur.network; cur.distance = tg.distance; }
      else cur.ways++;
      if (tg.wikipedia || tg.wikidata) cur.notable = true;
      if (tg.sac_scale) cur.sac = tg.sac_scale;
      by.set(key, cur);
    });
    const rank = (x) => (x.notable ? 1000 : 0) + (x.network === 'nwn' ? 500 : x.network === 'rwn' ? 200 : 0) + (x.rel ? 100 : 0) + Math.min(90, x.ways);
    return Array.from(by.values()).sort((a, b) => rank(b) - rank(a)).slice(0, 150);
  }

  // ------------------------------------------------------------------ UI
  async function show(region) {
    const u = App.ui, t = u.t, esc = u.esc;
    const bbox = bboxOf(region.boxes);
    u.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, duration: 800 });
    u.data.hl = { type: 'FeatureCollection', features: region.boxes.map(b => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } })) };
    u.setData('hl');
    const body = u.openSheet('<div class="kind-tag">' + esc(t('reg.region')) + '</div>' + u.head(region.name, esc(t('reg.sub'))) + '<div id="reg-list"><p class="read muted">' + esc(t('reg.loading')) + '</p></div>', { peek: true });
    let list;
    try { list = await trails(region.boxes); } catch (e) { const el = body.querySelector('#reg-list'); if (el) el.innerHTML = '<p class="read muted">' + esc(t('reg.failed')) + '</p>'; return; }
    const el = body.querySelector('#reg-list'); if (!el) return;
    if (!list.length) { el.innerHTML = '<p class="read muted">' + esc(t('reg.none')) + '</p>'; return; }
    el.innerHTML = '<p class="small muted">' + esc(t('reg.count', { n: list.length })) + '</p>' + list.map((x, i) =>
      '<button class="reg-item" data-i="' + i + '"><div class="r-name">' + esc(x.name) + '</div><div class="r-sub">' +
      esc([x.notable ? t('reg.notable') : '', x.network === 'nwn' ? t('reg.national') : x.network === 'rwn' ? t('reg.regional') : '', x.sac ? t('sac.' + x.sac) : '', x.distance ? x.distance + ' km' : ''].filter(Boolean).join(' · ')) + '</div></button>').join('');
    el.querySelectorAll('.reg-item').forEach(b => b.onclick = () => goToTrail(list[+b.dataset.i]));
  }

  /** Fly to a trail, wait for its data to load, then open its details. */
  async function goToTrail(x) {
    const u = App.ui;
    u.closeSheet();
    u.map.flyTo({ center: x.center, zoom: 13.5, duration: 1200 });
    const key = x.name.toLowerCase();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const f = u.data.trails.features.find(f => (f.properties.name || '').toLowerCase() === key || (f.properties.routes || '').toLowerCase().split(' · ').includes(key));
      if (f) { BcTrail.open(f); return; }
    }
    u.toast(u.t('reg.zoomed', { name: x.name }));
  }

  window.BcRegions = { REGIONS, match, show, trails, trailsQuery, bboxOf, nameFor, goToTrail };
})();
