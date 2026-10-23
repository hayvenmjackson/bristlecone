/* Mountain weather model: estimates temperature, precipitation type and wind at a given
   elevation from a forecast grid point, nearby stations, trail reports and terrain.

   Everything here is plain math with no network or page access, so it runs the same on the
   phone and in the Node tests. Units inside are SI (degrees C, metres, m/s); the page converts
   for display.

   Structure: a physical core (lapse rate, wet-bulb temperature, a humidity-aware rain/snow
   split, terrain exposure for wind) plus a learned correction of the core's systematic error.
   The learned part is a small set of quantile regression trees whose weights ship in
   wxmodel-weights.js; until those are trained on station data it contributes nothing and the
   core stands alone. */
(function (root) {
  const KM = 1000;

  // ------------------------------------------------------------------ Moist thermodynamics
  /** Wet-bulb temperature (C) from air temperature (C) and relative humidity (%), Stull (2011). */
  function wetBulb(t, rh) {
    const r = Math.max(5, Math.min(99, rh));
    return t * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) + Math.atan(t + r) - Math.atan(r - 1.676331)
      + 0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) - 4.686035;
  }
  /** Saturation vapour pressure (hPa), Magnus form. */
  const esat = (t) => 6.1094 * Math.exp(17.625 * t / (t + 243.04));
  function dewpoint(t, rh) {
    const g = Math.log(Math.max(1, rh) / 100) + 17.625 * t / (t + 243.04);
    return 243.04 * g / (17.625 - g);
  }
  const rhFrom = (t, td) => Math.max(1, Math.min(100, 100 * esat(Math.min(td, t)) / esat(t)));

  /**
   * Probability that falling precipitation reaches the ground as snow, from air temperature and
   * relative humidity at that elevation. Logistic in both, the form of Jennings et al. (2018):
   * dry air lets snow survive above freezing, humid air turns it to rain sooner. Coefficients
   * start from that study and are refit with the rest of the model.
   */
  function pSnow(t, rh, k) {
    const c = k || W().precip;
    return 1 / (1 + Math.exp(c.a + c.b * t + c.c * rh));
  }

  // ------------------------------------------------------------------ Lapse rate
  const LAPSE = {
    saturated: -5.5,   // C per km, about 3.0 F per 1,000 ft: cloud, rain, snow
    standard: -6.5,    // about 3.5 F per 1,000 ft
    mixed: -8.0,       // sunny, dry afternoons
    inversion: -2.0    // clear calm nights: valleys pool cold air, so the drop with height is small or reversed
  };

  /**
   * Least-squares temperature change with height from paired readings at different elevations
   * ({z, t}). Needs at least 300 m of spread to mean anything. Returns C per km or null.
   */
  function pairedLapse(pts) {
    const p = pts.filter(x => x && isFinite(x.z) && isFinite(x.t));
    if (p.length < 2) return null;
    const zs = p.map(x => x.z);
    if (Math.max(...zs) - Math.min(...zs) < 300) return null;
    const mz = zs.reduce((a, b) => a + b, 0) / p.length, mt = p.reduce((a, x) => a + x.t, 0) / p.length;
    let num = 0, den = 0;
    p.forEach(x => { num += (x.z - mz) * (x.t - mt); den += (x.z - mz) ** 2; });
    const g = num / den * KM;
    return Math.max(-10, Math.min(8, g));
  }

  /** Picks the lapse rate and how sure we are of it (C per km, sigma in C per km). */
  function lapseFor(s) {
    const precip = s.precipChance >= 0.6;
    let base, sigma = 1.5, regime;
    if (s.rh >= 90 || precip) { base = LAPSE.saturated; sigma = 0.8; regime = 'saturated'; }
    else if (s.night && s.windMs < 2.5 && (s.sky == null || s.sky < 35)) { base = LAPSE.inversion; sigma = 3.0; regime = 'inversion'; }
    else if (!s.night && s.rh < 50 && s.hour >= 11 && s.hour <= 17) { base = LAPSE.mixed; sigma = 1.2; regime = 'mixed'; }
    else { base = LAPSE.standard; regime = 'standard'; }
    const g = pairedLapse(s.paired || []);
    if (g == null) return { g: base, sigma, regime, paired: false };
    // Measured lapse wins in proportion to how much elevation the stations span.
    const span = Math.max(...s.paired.map(x => x.z)) - Math.min(...s.paired.map(x => x.z));
    const w = Math.min(0.8, span / 1500);
    return { g: w * g + (1 - w) * base, sigma: Math.max(0.6, sigma * (1 - w * 0.6)), regime: g > -2 ? 'inversion' : regime, paired: true, measured: g };
  }

  // ------------------------------------------------------------------ Terrain and wind
  /**
   * Terrain shape from a square of elevations centred on the point: z[row][col], row 0 north,
   * spacing in metres. Returns slope (radians), aspect (degrees the slope faces), curvature and
   * topographic position, after Liston and Elder's MicroMet wind model.
   */
  function terrain(z, spacing) {
    const n = z.length, c = (n - 1) / 2, z0 = z[c][c];
    if (!isFinite(z0)) return null;
    const at = (r, k) => (isFinite(z[r] && z[r][k]) ? z[r][k] : z0);
    const dzdx = (at(c, c + 1) - at(c, c - 1)) / (2 * spacing);   // + when rising to the east
    const dzdy = (at(c - 1, c) - at(c + 1, c)) / (2 * spacing);   // + when rising to the north
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360; // downhill direction
    let ring = 0, cnt = 0;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
      if (r === 0 || k === 0 || r === n - 1 || k === n - 1) { ring += at(r, k); cnt++; }
    }
    const radius = c * spacing;
    const rise = (z0 - ring / cnt) / radius;          // + on summits and ridges, - in hollows
    return { z: z0, slope, aspect, curvature: 0.5 * Math.tanh(rise / 0.15), tpi: z0 - ring / cnt, radius };
  }

  /**
   * Wind at the target. Starts from the forecast wind at the grid point, raises it with height
   * above the grid's own terrain (winds strengthen away from the ground), then weights it by
   * exposure: ridges and windward slopes speed up, lee slopes and hollows slow down.
   */
  function wind(ref, zTarget, ter) {
    if (!isFinite(ref.windMs)) return null;
    const dz = (zTarget - ref.z) / KM;
    const fz = Math.max(0.6, Math.min(2.6, 1 + 0.35 * dz));
    let ww = 1, os = 0, oc = 0;
    if (ter) {
      if (isFinite(ref.windDir)) {
        // Wind direction is where it blows from; a slope facing into it is windward.
        const facing = Math.cos((ref.windDir - ter.aspect) * Math.PI / 180);
        os = 0.5 * Math.tanh(ter.slope * facing / 0.35);
      }
      oc = ter.curvature;
      ww = Math.max(0.3, 1 + 0.5 * os + 0.5 * oc);
    }
    const w = ref.windMs * fz * ww;
    const gf = isFinite(ref.gustMs) && ref.windMs > 1 ? Math.max(1.2, Math.min(2.2, ref.gustMs / ref.windMs)) : 1.4;
    const gust = w * (gf + (oc > 0.2 ? 0.15 : 0));
    return { p50: w, lo: w * 0.65, hi: w * 1.35, gust, exposure: oc > 0.2 ? 'exposed' : oc < -0.2 ? 'sheltered' : os > 0.15 ? 'windward' : os < -0.15 ? 'lee' : 'open' };
  }

  // ------------------------------------------------------------------ Learned correction
  /** Weights as shipped (see wxmodel-weights.js); an empty model adds nothing. */
  function W() { return root.BcWxWeights || { version: 'core', features: [], temp: { p10: [], p50: [], p90: [] }, precip: { a: -10.04, b: 1.41, c: 0.09 } }; }

  /** Trees as flat node arrays: [feature, threshold, left, right, value]; feature -1 is a leaf. */
  function trees(list, x) {
    let s = 0;
    for (const t of list || []) {
      let i = 0;
      for (let guard = 0; guard < 64 && t[i] && t[i][0] >= 0; guard++) i = x[t[i][0]] <= t[i][1] ? t[i][2] : t[i][3];
      if (t[i]) s += t[i][4];
    }
    return s;
  }

  function features(s, dzKm, lapse, ter) {
    const f = { dz_km: dzKm, lapse: lapse.g, paired: lapse.paired ? 1 : 0, rh: s.rh, wind: s.windMs || 0, sky: s.sky == null ? 50 : s.sky,
      hour_sin: Math.sin(s.hour / 24 * 2 * Math.PI), hour_cos: Math.cos(s.hour / 24 * 2 * Math.PI),
      month_sin: Math.sin(s.month / 12 * 2 * Math.PI), month_cos: Math.cos(s.month / 12 * 2 * Math.PI),
      curvature: ter ? ter.curvature : 0, tpi: ter ? ter.tpi : 0, slope: ter ? ter.slope : 0,
      south: ter ? Math.cos((ter.aspect - 180) * Math.PI / 180) * Math.sin(ter.slope) : 0, precip: s.precipChance || 0 };
    return W().features.map(k => (k in f ? f[k] : 0));
  }

  /** Apply a bundled correction only inside the training support. The pilot has
   * no station-bias or paired-station examples, so those richer physical estimates
   * keep their existing correction rather than counting a forecast bias twice. */
  function residuals(s, x, ter) {
    const w = W(), support = w.support;
    const empty = { p10: 0, p50: 0, p90: 0, applied: false };
    if (!w.temp || !w.temp.p50 || !w.temp.p50.length || !x.every(Number.isFinite)) return empty;
    if (support) {
      if (!support.sources.includes(s.ref.src) || (support.requiresTerrain && !ter)
        || (support.withoutStationAdjustment && ((s.paired || []).length || (s.bias && s.bias.w > 0)))) return empty;
      const targetElevation = s.ref.z + x[w.features.indexOf('dz_km')] * KM;
      for (const [value, range] of [[s.ref.t, support.referenceTemperatureC], [targetElevation, support.targetElevationM]]) {
        if (range && (!Number.isFinite(value) || value < range[0] - 1e-3 || value > range[1] + 1e-3)) return empty;
      }
      if (support.bounds.length !== x.length || x.some((v, i) => v < support.bounds[i][0] - 1e-6 || v > support.bounds[i][1] + 1e-6)) return empty;
    }
    const p50 = trees(w.temp.p50, x), low = trees(w.temp.p10, x), high = trees(w.temp.p90, x);
    if (![p50, low, high].every(Number.isFinite)) return empty;
    return { p10: Math.min(p50, low), p50, p90: Math.max(p50, high), applied: true };
  }

  // ------------------------------------------------------------------ The estimate
  /**
   * s: {
   *   ref: { z, t, rh, windMs, windDir, gustMs, sky, src }       forecast grid point (or best station)
   *   paired: [{ z, t }]                                          readings at other elevations, same hour
   *   bias: { t, w }                                              grid error seen at a nearby station, and its weight
   *   precipChance, gridType ('snow'|'rain'|'mix'|'freezing'|null), snowLevel (m or null)
   *   hour, month, night, ageH (hours since the forecast or reading)
   *   reports: [{ type, t, z, w }]                                trail report evidence, already weighted
   * }
   * zTarget: elevation in metres. ter: terrain() at the target, or null.
   */
  function estimate(s, zTarget, ter) {
    const ref = s.ref;
    const lapse = lapseFor({ rh: ref.rh, precipChance: s.precipChance || 0, night: s.night, windMs: ref.windMs || 0, sky: ref.sky, hour: s.hour, paired: s.paired });
    const dzKm = (zTarget - ref.z) / KM;
    let t = ref.t + lapse.g * dzKm;
    if (s.bias && isFinite(s.bias.t)) t += s.bias.t * Math.max(0, Math.min(0.8, s.bias.w));

    // Learned residual (median and spread).
    const x = features(Object.assign({}, s, { rh: ref.rh, windMs: ref.windMs, sky: ref.sky }), dzKm, lapse, ter);
    const correction = residuals(s, x, ter);
    const medianCorrection = correction.p50;
    t += medianCorrection;
    const columnTemperature = (z) => {
      const dz = (z - ref.z) / KM;
      const columnFeatures = features(Object.assign({}, s, { rh: ref.rh, windMs: ref.windMs, sky: ref.sky }), dz, lapse, ter);
      return ref.t + lapse.g * dz + (s.bias && isFinite(s.bias.t) ? s.bias.t * Math.max(0, Math.min(0.8, s.bias.w)) : 0)
        + residuals(s, columnFeatures, ter).p50;
    };

    // Trail reports that give a temperature at a known elevation pull the estimate toward them.
    const notes = [];
    let pull = 0, pullW = 0;
    (s.reports || []).forEach(r => {
      if (!Number.isFinite(r.t) || !Number.isFinite(r.z)) return;
      const modelAtR = columnTemperature(r.z);
      pull += (r.t - modelAtR) * r.w; pullW += r.w;
    });
    const reportAdjustment = pullW > 0 ? (pull / pullW) * Math.min(0.5, pullW) : 0;
    if (pullW > 0) { t += reportAdjustment; notes.push('wx.why.reportTemp'); }

    // Spread: base error, lapse uncertainty over the climb, forecast age; reports and paired
    // stations tighten it. Cold side wider: underestimating cold hurts more on a mountain.
    let sigma = Math.sqrt(1.1 ** 2 + (lapse.sigma * Math.abs(dzKm)) ** 2 + (0.25 * Math.max(0, s.ageH || 0)) ** 2);
    if (pullW > 0) sigma *= 0.85;
    // Each tree predicts an absolute residual from the physical core, not an offset
    // from the corrected median. Remove the median already included in t before
    // adding either tail, and guard against independently fitted quantiles crossing.
    const lo10 = correction.p10;
    const hi90 = correction.p90;
    const p10 = t - 1.2816 * sigma * 1.15 + lo10 - medianCorrection;
    const p90 = t + 1.2816 * sigma * 0.9 + hi90 - medianCorrection;

    // Humidity at the target: dewpoint drops more slowly than temperature with height; in
    // precipitation the air is near saturation regardless.
    const tdRef = dewpoint(ref.t, ref.rh);
    let rh = rhFrom(t, tdRef - 1.8 * dzKm);
    if ((s.precipChance || 0) >= 0.6) rh = Math.max(rh, 93);

    // Precipitation type.
    const k = W().precip;
    let ps = pSnow(t, rh, k);
    let type = ps >= 0.7 ? 'snow' : ps <= 0.3 ? 'rain' : 'mix';
    if (s.gridType === 'freezing' && t <= 0.5) { type = 'freezing'; notes.push('wx.why.freezing'); }
    // A first-hand report of the type near this elevation outweighs the formula.
    const typed = (s.reports || []).filter(r => r.type && (!isFinite(r.z) || Math.abs(r.z - zTarget) < 300));
    if (typed.length) {
      const vote = {}; typed.forEach(r => { vote[r.type] = (vote[r.type] || 0) + r.w; });
      const best = Object.entries(vote).sort((a, b) => b[1] - a[1])[0];
      if (best[1] >= 0.5 && best[0] !== type && ['snow', 'rain', 'mix', 'freezing'].includes(best[0])) { type = best[0]; notes.push('wx.why.reportType'); }
    }

    // Freezing level and snow level by search up and down the column.
    const tAt = (z) => columnTemperature(z) + reportAdjustment;
    const rhAt = (z) => { const tt = tAt(z); let r = rhFrom(tt, tdRef - 1.8 * (z - ref.z) / KM); if ((s.precipChance || 0) >= 0.6) r = Math.max(r, 93); return r; };
    const freezing = solve(z => tAt(z), 0, ref.z - 3000, ref.z + 6000);
    let snowLevel = solve(z => 0.5 - pSnow(tAt(z), rhAt(z), k), 0, ref.z - 3000, ref.z + 6000);
    if (Number.isFinite(s.snowLevel)) snowLevel = isFinite(snowLevel) ? 0.5 * snowLevel + 0.5 * s.snowLevel : s.snowLevel;

    return {
      z: zTarget, t, p10, p90, rh, wetBulb: wetBulb(t, rh), pSnow: ps, type,
      precipChance: s.precipChance || 0, freezingLevel: freezing, snowLevel,
      wind: wind(ref, zTarget, ter), lapse, notes, model: W().version,
      correctionApplied: correction.applied, temperatureCorrection: medianCorrection
    };
  }

  /** A verified root, not merely a sign change: tree/support boundaries can jump.
   * If the broad bisection lands on a discontinuity, try narrower brackets for a
   * genuine root. Return unavailable when no root is found, rather than inventing
   * a freezing/snow level at the edge of the learned model's support. */
  function solve(f, target, lo, hi) {
    const refine = (left, right, fl, fr) => {
      if (!Number.isFinite(fl) || !Number.isFinite(fr) || fl * fr > 0) return NaN;
      if (Math.abs(fl) < 1e-7) return left;
      if (Math.abs(fr) < 1e-7) return right;
      let a = left, b = right, fa = fl;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2, fm = f(m) - target;
        if (!Number.isFinite(fm)) return NaN;
        if (Math.abs(fm) < 1e-7) return m;
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const root = (a + b) / 2;
      return Math.abs(f(root) - target) < 1e-6 ? root : NaN;
    };
    const first = f(lo) - target, last = f(hi) - target;
    const direct = refine(lo, hi, first, last);
    if (Number.isFinite(direct)) return direct;
    const steps = Math.min(600, Math.max(1, Math.ceil((hi - lo) / 50)));
    let previous = lo, fp = first;
    for (let i = 1; i <= steps; i++) {
      const next = lo + (hi - lo) * i / steps, fn = f(next) - target;
      const root = refine(previous, next, fp, fn);
      if (Number.isFinite(root)) return root;
      previous = next; fp = fn;
    }
    return NaN;
  }

  // ------------------------------------------------------------------ Trail report text
  const NEG = /\b(no|not|without|zero|pas de|sans|sin|ningún|ninguna)\s+(\w+\s+)?$/i;
  const TYPES = [
    ['freezing', /\b(freezing rain|sleet|ice pellets|verglas|grésil|pluie verglaçante|aguanieve|lluvia helada)\b/i],
    ['snow', /\b(snow(ing|ed|fall|storm)?|flurries|graupel|whiteout|neige|neigeait|neiger|nieve|nevando|nevada)\b/i],
    ['rain', /\b(rain(ing|ed|y)?|drizzl(e|ing)|downpour|pluie|pleut|lluvia|lloviendo|llovizna)\b/i]
  ];
  /**
   * Weather a report describes first-hand: precipitation type and a temperature if one is
   * given. Returns null when it says nothing usable. "No snow above treeline" is not snow.
   */
  function readReport(text, defaultUnit) {
    const s = String(text || '');
    let type = null;
    for (const [k, re] of TYPES) {
      const m = re.exec(s);
      if (m && !NEG.test(s.slice(Math.max(0, m.index - 24), m.index))) { type = k; break; }
    }
    let t = null;
    const m = /(-?\d{1,3}(?:[.,]\d)?)\s*(?:°\s*([FC])\b|°|\s?degrees?\s*([FC])?\b|\s?degr[ée]s?\b|\s?grados?\b)/i.exec(s);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      const unit = (m[2] || m[3] || defaultUnit || 'F').toUpperCase();
      const c = unit === 'F' ? (v - 32) * 5 / 9 : v;
      if (c > -50 && c < 45) t = c;
    }
    return type || t != null ? { type, t } : null;
  }

  /** The core estimate (before the learned correction) and the feature vector, for training. */
  function explain(s, zTarget, ter) {
    const ref = s.ref;
    const lapse = lapseFor({ rh: ref.rh, precipChance: s.precipChance || 0, night: s.night, windMs: ref.windMs || 0, sky: ref.sky, hour: s.hour, paired: s.paired });
    const dzKm = (zTarget - ref.z) / KM;
    let core = ref.t + lapse.g * dzKm;
    if (s.bias && isFinite(s.bias.t)) core += s.bias.t * Math.max(0, Math.min(0.8, s.bias.w));
    return { core, x: features(Object.assign({}, s, { rh: ref.rh, windMs: ref.windMs, sky: ref.sky }), dzKm, lapse, ter), names: W().features };
  }

  const BcWx = { estimate, explain, wetBulb, dewpoint, pSnow, pairedLapse, lapseFor, terrain, wind, readReport, solve, LAPSE, trees, residuals };
  root.BcWx = BcWx;
})(typeof window !== 'undefined' ? window : globalThis);
