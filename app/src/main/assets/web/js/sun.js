/* Sunrise and sunset for automatic light and dark appearance (NOAA solar position approximation). */
(function () {
  const rad = Math.PI / 180;

  function dayOfYear(d) {
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    return Math.floor((d.getTime() - start) / 86400000);
  }

  /** Fractional-year terms from the NOAA general solar position equations. */
  function solar(dayOfYearFloat) {
    const g = 2 * Math.PI / 365 * (dayOfYearFloat - 1);
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return { eqtime, decl };
  }

  /**
   * Returns { sunrise: Date|null, sunset: Date|null, polar: 'day'|'night'|null } for the day at
   * this place that contains `date`. The day comes from the place's longitude, not the phone's
   * time zone, so a phone set to another zone still gets the right sunrise and sunset.
   */
  function times(date, lat, lon) {
    const local = new Date(date.getTime() + lon * 4 * 60000); // mean solar time at the place
    const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const { eqtime, decl } = solar(dayOfYear(new Date(base + 12 * 3600000)));
    const zenith = 90.833 * rad;
    const cosH = (Math.cos(zenith) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
    if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
    const ha = Math.acos(cosH) / rad;
    // Minutes after UTC midnight of the place's day; sunset can run past 1440 west of Greenwich.
    const riseMin = 720 - 4 * (lon + ha) - eqtime;
    const setMin = 720 - 4 * (lon - ha) - eqtime;
    return { sunrise: new Date(base + riseMin * 60000), sunset: new Date(base + setMin * 60000), polar: null };
  }

  /** Height of the sun above the horizon in degrees at this place and moment. */
  function elevation(now, lat, lon) {
    const d = new Date(now.getTime());
    const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const { eqtime, decl } = solar(dayOfYear(d) + (hours - 12) / 24);
    const ha = ((hours * 60 + eqtime + 4 * lon) / 4 - 180) * rad;
    const cosZ = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
    return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / rad;
  }

  /** True when it is dark at this place and time. Falls back to 7:00 to 19:00 local time without a position. */
  function isDark(now, lat, lon) {
    if (lat === undefined || lat === null || isNaN(lat)) {
      const h = now.getHours() + now.getMinutes() / 60;
      return h < 7 || h >= 19;
    }
    // About 20 minutes into civil twilight: the sun a few degrees below the horizon.
    return elevation(now, lat, lon) < -4;
  }

  window.Sun = { times, isDark, elevation };
})();
