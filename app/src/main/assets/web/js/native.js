/* Thin wrapper over the native bridge (Android or iOS), with browser fallbacks so the UI can be
   tested on a desktop.

   Android answers bridge calls immediately. iOS (WKWebView) always answers asynchronously, so on
   iOS: settings and saved places are handed to the page at startup and kept in memory, and the
   few calls that need the native side return Promises. Callers `await` those, which costs
   nothing on Android. */
(function () {
  const H = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bc;
  const IOS = H ? makeIos() : null;
  const N = window.BristleconeNative || IOS;
  const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();

  function makeIos() {
    // Stored under the same file-safe names as on Android.
    const sk = (k) => String(k).replace(/[^A-Za-z0-9_.-]/g, '_');
    const kv = Object.assign({}, window.BC_KV || {});
    const call = (m, ...a) => H.postMessage({ m, a }).then(r => (r === undefined ? null : r));
    const fire = (m, ...a) => { call(m, ...a).catch(() => { }); };
    const o = {
      info: () => JSON.stringify(window.BC_INFO || {}),
      online: () => navigator.onLine,
      kvGet: (k) => (Object.prototype.hasOwnProperty.call(kv, sk(k)) ? kv[sk(k)] : null),
      kvPut: (k, v) => { kv[sk(k)] = String(v); fire('kvPut', k, String(v)); return true; },
      kvRemove: (k) => { delete kv[sk(k)]; fire('kvRemove', k); },
      kvKeys: (p) => JSON.stringify(Object.keys(kv).filter(k => !p || k.startsWith(sk(p))))
    };
    // Calls whose answers the page waits for.
    ['downloadRegion', 'listRegions', 'storageStats', 'trackStatus', 'trackList', 'trackPoints', 'trackMeta', 'trackStop', 'trackUpdate', 'shareFile']
      .forEach(m => { o[m] = (...a) => call(m, ...a); });
    // Fire-and-forget calls.
    ['requestLocation', 'stopLocation', 'resetStride', 'cancelRegion', 'deleteRegion', 'clearBrowseCache', 'backup', 'restore', 'saveFile', 'openExternal',
      'setDark', 'keepScreenOn', 'copy', 'share', 'trackStart', 'trackPause', 'trackResume', 'trackDelete', 'sms', 'healthRequest', 'healthWrite']
      .forEach(m => { o[m] = (...a) => fire(m, ...a); });
    return o;
  }
  /** Applies f to a bridge answer whether it arrived now (Android) or later (iOS). */
  const lift = (v, f) => (v && typeof v.then === 'function' ? v.then(f) : f(v));
  const parse = (fallback) => (x) => { try { return x ? JSON.parse(x) : fallback; } catch (e) { return fallback; } };

  // Browser stand-in for the recording service, so the flow can be tried on a desktop.
  const web = { id: null, paused: false, pts: [], steps: 0, start: 0 };
  const hav = (a, b) => { const R = 6371008.8, r = Math.PI / 180, dp = (b[1] - a[1]) * r, dl = (b[0] - a[0]) * r; const h = Math.sin(dp / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function webStats() {
    let d = 0, gain = 0;
    for (let i = 1; i < web.pts.length; i++) { d += hav(web.pts[i - 1], web.pts[i]); const a = web.pts[i][3], b = web.pts[i - 1][3]; if (a != null && b != null && a > b) gain += a - b; }
    return { distance: d, gain, movingMs: web.pts.length > 1 ? web.pts[web.pts.length - 1][2] - web.pts[0][2] : 0 };
  }
  const lsGet = (k) => { try { return JSON.parse((ls && ls.getItem(k)) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };

  const Native = {
    _webFix(fix) { if (!N && web.id && !web.paused && fix.lat != null) web.pts.push([fix.lon, fix.lat, fix.time || Date.now(), fix.alt != null ? fix.alt : null]); },
    trackStart(title, text) { if (N) return N.trackStart(title, text); web.id = 't' + Date.now(); web.pts = []; web.paused = false; web.start = Date.now(); },
    trackPause() { if (N) return N.trackPause(); web.paused = true; },
    trackResume() { if (N) return N.trackResume(); web.paused = false; },
    trackStop() {
      if (N) return N.trackStop();
      const id = web.id; web.id = null;
      if (!id || web.pts.length < 2) return id || '';
      const st = webStats();
      const list = lsGet('bc_tracks') || {};
      list[id] = { meta: { id, name: null, start: web.pts[0][2], end: web.pts[web.pts.length - 1][2], distance: st.distance, gain: st.gain, loss: 0, barometer: false, movingMs: st.movingMs, elapsedMs: st.movingMs, points: web.pts.length, steps: 0, healthSynced: false }, pts: web.pts };
      lsSet('bc_tracks', list);
      return id;
    },
    trackStatus() {
      if (N) return N.trackStatus();
      if (!web.id) return JSON.stringify({ recording: false });
      return JSON.stringify(Object.assign({ recording: true, id: web.id, paused: web.paused, points: web.pts.length, steps: 0, elapsedMs: Date.now() - web.start }, webStats()));
    },
    trackList() { if (N) return N.trackList(); return JSON.stringify(Object.values(lsGet('bc_tracks') || {}).map(x => x.meta)); },
    trackPoints(id) { if (N) return N.trackPoints(id); if (web.id === id) return JSON.stringify(web.pts); const x = (lsGet('bc_tracks') || {})[id]; return JSON.stringify(x ? x.pts : []); },
    trackMeta(id) { if (N) return N.trackMeta(id); const x = (lsGet('bc_tracks') || {})[id]; return JSON.stringify(x ? x.meta : null); },
    trackUpdate(json) {
      if (N) return N.trackUpdate(json);
      const u = JSON.parse(json), all = lsGet('bc_tracks') || {};
      if (!all[u.id]) return false;
      Object.assign(all[u.id].meta, u); lsSet('bc_tracks', all); return true;
    },
    trackDelete(id) { if (N) return N.trackDelete(id); const all = lsGet('bc_tracks') || {}; delete all[id]; lsSet('bc_tracks', all); },
    shareFile(b64, name, mime, text) {
      if (N) return N.shareFile(b64, name, mime, text || '');
      window.__lastShare = { name, mime, text, bytes: b64.length, b64 };
      return true;
    },
    sms(body) { if (N) return N.sms(body); window.__lastSms = body; },
    healthRequest() { if (N) return N.healthRequest(); setTimeout(() => window.bcNative.onHealthPermission(JSON.stringify({ granted: false, unavailable: true })), 50); },
    healthWrite(id) { if (N) return N.healthWrite(id); },
    isApp: !!N,
    platform: window.BristleconeNative ? 'android' : IOS ? 'ios' : 'web',
    /** On iOS, remote https requests go through the app's own scheme so they are cached for offline use. */
    proxy(url) { return window.BC_PROXY && /^https:\/\//.test(url) ? window.BC_PROXY + url.slice(8) : url; },
    info() {
      if (N) { try { return JSON.parse(N.info()); } catch (e) { /* fall through */ } }
      return { locale: navigator.language, version: '1.0.0-web', barometer: false, stepDetector: false, locationPermission: false, online: navigator.onLine, strideSamples: 0 };
    },
    online() { return N ? N.online() : navigator.onLine; },
    kvGet(k) { return N ? N.kvGet(k) : (ls ? ls.getItem('bc_' + k) : null); },
    kvPut(k, v) { if (N) return N.kvPut(k, v); if (ls) ls.setItem('bc_' + k, v); return true; },
    kvGetJson(k) { try { const v = Native.kvGet(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    kvPutJson(k, v) { return Native.kvPut(k, JSON.stringify(v)); },
    requestLocation() {
      if (N) return N.requestLocation();
      if (!navigator.geolocation) return;
      navigator.geolocation.watchPosition(p => window.bcNative.onLocation(JSON.stringify({ mode: 'gps', lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, heading: p.coords.heading, time: p.timestamp, gpsEnabled: true })),
        () => window.bcNative.onPermission(JSON.stringify({ location: false })), { enableHighAccuracy: true });
    },
    resetStride() { if (N) N.resetStride(); },
    downloadRegion(spec) { return N ? N.downloadRegion(JSON.stringify(spec)) : 'unsupported'; },
    kvRemove(k) { if (N && N.kvRemove) N.kvRemove(k); else if (ls) ls.removeItem('bc_' + k); },
    cancelRegion(id) { if (N) N.cancelRegion(id); },
    deleteRegion(id) { if (N) N.deleteRegion(id); },
    listRegions() { return N ? lift(N.listRegions(), parse([])) : []; },
    storageStats() { return N ? lift(N.storageStats(), parse({})) : { cacheBytes: 0, dataBytes: 0, freeBytes: 0 }; },
    clearBrowseCache() { if (N) N.clearBrowseCache(); },
    backup(includeMaps, filename) { if (N) N.backup(!!includeMaps, filename); },
    restore() { if (N) N.restore(); },
    saveFile(name, mime, base64) {
      if (N) return N.saveFile(name, mime, base64);
      const a = document.createElement('a'); a.href = 'data:' + mime + ';base64,' + base64; a.download = name; a.click();
    },
    openExternal(url) { if (N) N.openExternal(url); else window.open(url, '_blank'); },
    setDark(d) { if (N) N.setDark(!!d); },
    keepScreenOn(on) { if (N) N.keepScreenOn(!!on); },
    copy(text) { if (N) N.copy(text); else if (navigator.clipboard) navigator.clipboard.writeText(text); },
    share(text) { if (N) N.share(text); else if (navigator.share) navigator.share({ text }); }
  };
  window.Native = Native;
})();
