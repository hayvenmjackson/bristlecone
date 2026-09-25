/* Offline regions and exports. */
(function () {
  const MAX_TILES = 45000;
  // Latin glyphs ship with the app; save the Noto fallback for Canadian Aboriginal syllabics.
  const GLYPH_RANGES = ['5120-5375', '5376-5631', '5632-5887'];
  const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
  const AVG = { vector: 32000, dem: 70000, raster: 30000, trail: 250000, land: 400000 };

  let ofmTemplate = null;
  async function vectorTemplate() {
    if (ofmTemplate) return ofmTemplate;
    const { json } = await BcData.getJson(BcStyle.OFM);
    ofmTemplate = json.tiles[0];
    return ofmTemplate;
  }

  function countTiles(bbox, z0, z1) {
    let n = 0;
    for (let z = z0; z <= z1; z++) {
      const t = BcData.tilesFor(bbox, z);
      n += t.length;
    }
    return n;
  }

  /** Plan a region download: returns { urls, counts, bytes } without fetching anything big. */
  async function plan(bbox, opts) {
    const maxZ = opts.detail === 'high' ? 15 : 14;
    const urls = [];
    const counts = { vector: 0, dem: 0, raster: 0, trail: 0, land: 0 };
    const tpl = await vectorTemplate();
    const vecMax = 14;
    for (let z = 0; z <= vecMax; z++) BcData.tilesFor(bbox, z).forEach(([x, y]) => { urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y)); counts.vector++; });
    const demMax = 12;
    for (let z = 0; z <= demMax; z++) BcData.tilesFor(bbox, z).forEach(([x, y]) => { urls.push(BcStyle.DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y)); counts.dem++; });
    if (opts.includeBase && BcStyle.BASES[opts.base]) {
      const b = BcStyle.BASES[opts.base];
      const rMax = Math.min(maxZ, b.maxzoom || 15);
      for (let z = 0; z <= rMax; z++) BcData.tilesFor(bbox, z).forEach(([x, y], i) => {
        const tplR = b.tiles[i % b.tiles.length];
        urls.push(tplR.replace('{z}', z).replace('{x}', x).replace('{y}', y)); counts.raster++;
      });
    }
    FONTS.forEach(f => GLYPH_RANGES.forEach(r => urls.push('https://tiles.openfreemap.org/fonts/' + encodeURIComponent(f) + '/' + r + '.pbf')));
    urls.push(BcStyle.OFM);
    BcData.tilesFor(bbox, BcData.TRAIL_Z).forEach(([x, y, z]) => { urls.push(BcData.overpassUrls(x, y, z)[0]); counts.trail++; });
    BcData.tilesFor(bbox, BcData.LAND_Z).forEach(([x, y, z]) => { BcData.landUrls(x, y, z).forEach(u => { urls.push(u); }); counts.land++; });
    urls.push(BcData.AVY_US);
    urls.push(BcData.fireUrl(bbox));
    const bytes = counts.vector * AVG.vector + counts.dem * AVG.dem + counts.raster * AVG.raster + counts.trail * AVG.trail + counts.land * AVG.land;
    return { urls: Array.from(new Set(urls)), counts, bytes, maxZ, tiles: counts.vector + counts.dem + counts.raster };
  }

  function estimateOnly(bbox, opts) {
    const maxZ = opts.detail === 'high' ? 15 : 14;
    const v = countTiles(bbox, 0, 14), d = countTiles(bbox, 0, 12);
    const r = opts.includeBase && BcStyle.BASES[opts.base] ? countTiles(bbox, 0, Math.min(maxZ, BcStyle.BASES[opts.base].maxzoom || 15)) : 0;
    const trail = BcData.tilesFor(bbox, BcData.TRAIL_Z).length, land = BcData.tilesFor(bbox, BcData.LAND_Z).length;
    return { tiles: v + d + r, bytes: v * AVG.vector + d * AVG.dem + r * AVG.raster + trail * AVG.trail + land * AVG.land, tooBig: v + d + r > MAX_TILES };
  }

  // ------------------------------------------------------------------ Exports
  function toGpx(trails, points) {
    const esc = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Bristlecone" xmlns="http://www.topografix.com/GPX/1/1">',
      '<metadata><name>Bristlecone export</name><desc>Trail data © OpenStreetMap contributors (ODbL)</desc><time>' + new Date().toISOString() + '</time></metadata>'];
    points.forEach(p => {
      const [lon, lat] = p.geometry.coordinates;
      out.push('<wpt lat="' + lat + '" lon="' + lon + '"><name>' + esc(p.properties.name || I18N.t('ft.trailhead')) + '</name><type>' + esc(p.properties.kind) + '</type></wpt>');
    });
    trails.forEach(t => {
      out.push('<trk><name>' + esc(t.properties.name || I18N.t('ft.unnamed')) + '</name><type>' + esc(t.properties.kind) + '</type><trkseg>');
      t.geometry.coordinates.forEach(([lon, lat]) => out.push('<trkpt lat="' + lat + '" lon="' + lon + '"/>'));
      out.push('</trkseg></trk>');
    });
    out.push('</gpx>');
    return out.join('\n');
  }

  /** A recorded hike as GPX 1.1 with timestamps and elevation, for Strava, Garmin Connect, CalTopo and others. */
  function toGpxTrack(name, pts) {
    const esc = (x) => String(x || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Bristlecone" xmlns="http://www.topografix.com/GPX/1/1">',
      '<metadata><name>' + esc(name) + '</name>' + (pts.length ? '<time>' + new Date(pts[0][2]).toISOString() + '</time>' : '') + '</metadata>',
      '<trk><name>' + esc(name) + '</name><type>hiking</type><trkseg>'];
    pts.forEach(p => out.push('<trkpt lat="' + p[1] + '" lon="' + p[0] + '">' + (p[3] != null ? '<ele>' + Number(p[3]).toFixed(1) + '</ele>' : '') + (p[2] ? '<time>' + new Date(p[2]).toISOString() + '</time>' : '') + '</trkpt>'));
    out.push('</trkseg></trk></gpx>');
    return out.join('\n');
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** Render the current map with a Bristlecone brand strip and data credits. */
  function mapImage(map, dark) {
    return new Promise((resolve, reject) => {
      map.once('render', () => {
        try {
          const src = map.getCanvas();
          const w = src.width, h = src.height;
          const strip = Math.round(64 * (window.devicePixelRatio || 1));
          const c = document.createElement('canvas');
          c.width = w; c.height = h + strip;
          const g = c.getContext('2d');
          g.drawImage(src, 0, 0);
          const grad = g.createLinearGradient(0, h, w, h + strip);
          grad.addColorStop(0, '#0F3D2E'); grad.addColorStop(1, '#1F6B4A');
          g.fillStyle = grad; g.fillRect(0, h, w, strip);
          g.fillStyle = '#C9A227'; g.fillRect(0, h, w, Math.max(2, strip * 0.04));
          const dpr = window.devicePixelRatio || 1;
          g.fillStyle = '#F4EFDF';
          g.font = '600 ' + Math.round(15 * dpr) + 'px Overpass, sans-serif';
          g.fillText(I18N.t('export.watermark'), 16 * dpr, h + strip * 0.45);
          g.fillStyle = 'rgba(244,239,223,0.75)';
          g.font = Math.round(10 * dpr) + 'px Overpass, sans-serif';
          g.fillText('© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap · USGS · NRCan · ' + new Date().toLocaleDateString(I18N.dateLocale()), 16 * dpr, h + strip * 0.78);
          resolve(c.toDataURL('image/png').split(',')[1]);
        } catch (e) { reject(e); }
      });
      map.triggerRepaint();
    });
  }

  window.BcOffline = { plan, estimateOnly, toGpx, toGpxTrack, b64, mapImage, MAX_TILES };
})();
