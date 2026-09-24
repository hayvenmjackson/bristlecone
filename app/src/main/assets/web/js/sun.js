/* Sunrise and sunset for automatic light and dark appearance (NOAA solar position approximation). */
(function () {
  const rad = Math.PI / 180;

  function dayOfYear(d) {
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    return Math.floor((d.getTime() - start) / 86400000);
  }

  /** Returns { sunrise: Date|null, sunset: Date|null, polar: 'day'|'night'|null } for the local day of `date`. */
  function times(date, lat, lon) {
    // Solve for UTC minutes of sunrise and sunset using the NOAA general solar position equations.
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
    const n = dayOfYear(d);
    const g = 2 * Math.PI / 365 * (n - 1);
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const zenith = 90.833 * rad;
    const cosH = (Math.cos(zenith) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
    if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
    const ha = Math.acos(cosH) / rad;
    const riseMin = 720 - 4 * (lon + ha) - eqtime;
    const setMin = 720 - 4 * (lon - ha) - eqtime;
    const base = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    let sunrise = new Date(base + riseMin * 60000);
    let sunset = new Date(base + setMin * 60000);
    // Keep results on the local calendar day of `date`.
    const shift = (x) => {
      const diff = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
      return diff === 0 ? x : new Date(x.getTime() - diff * 86400000);
    };
    return { sunrise: shift(sunrise), sunset: shift(sunset), polar: null };
  }

  /** True when it is dark at this place and time. Falls back to 7:00 to 19:00 local time without a position. */
  function isDark(now, lat, lon) {
    if (lat === undefined || lat === null || isNaN(lat)) {
      const h = now.getHours() + now.getMinutes() / 60;
      return h < 7 || h >= 19;
    }
    const s = times(now, lat, lon);
    if (s.polar) return s.polar === 'night';
    const margin = 20 * 60000; // switch about 20 minutes into civil twilight
    return now.getTime() < s.sunrise.getTime() - margin || now.getTime() > s.sunset.getTime() + margin;
  }

  window.Sun = { times, isDark };
})();
