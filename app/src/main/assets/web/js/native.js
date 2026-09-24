/* Thin wrapper over the Android bridge, with browser fallbacks so the UI can be tested on a desktop. */
(function () {
  const N = window.BristleconeNative;
  const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();

  const Native = {
    isApp: !!N,
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
    cancelRegion(id) { if (N) N.cancelRegion(id); },
    deleteRegion(id) { if (N) N.deleteRegion(id); },
    listRegions() { try { return N ? JSON.parse(N.listRegions()) : []; } catch (e) { return []; } },
    storageStats() { try { return N ? JSON.parse(N.storageStats()) : { cacheBytes: 0, dataBytes: 0, freeBytes: 0 }; } catch (e) { return {}; } },
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
