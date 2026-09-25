/* Separates first-hand trail condition reports from everything else in social posts.
   A small logistic regression over words, word pairs and condition cues, in English, French and
   Spanish. Weights come from tools/classifier/train.js; the phone then adjusts them from each
   "useful" or "not a report" tap. Runs entirely on the phone. */
(function (root) {
  const BUCKETS = 2048;
  const CUES = {
    cond: /\b(snow|snowed|snowfield|snowbridges?|ice|icy|iced|verglas|rime|mud|muddy|blowdowns?|downed|fallen trees?|trees? down|washout|washed out|flood|flooded|flooding|closed|closure|bridge (is )?out|crossing|ford|fording|high water|runoff|rockfall|avalanche|mosquito(es)?|black ?flies|ticks?|horse ?flies|smoke|fire closure|lot (was )?full|parking (lot )?(is |was )?full|reroute|rerouted|detour|cairns?|whiteout|postholing|microspikes|spikes|crampons|snowshoes?|groomed|corduroy|rungs|chains|cables|slick|slippery|eroded|erosion|boardwalk|water source|dry|glace|glacé|glacée|boue|neige|fermé|fermée|tombés|passerelle|gué|raquettes|stationnement|nieve|hielo|barro|cerrado|caídos|puente|cruce|crecido|crampones|estacionamiento|deslavado)\b/,
    time: /\b(today|this (morning|afternoon|evening|weekend)|yesterday|last night|as of|right now|currently|just got back|aujourd'hui|ce matin|hier|cet après-midi|hoy|esta mañana|ayer|esta tarde)\b/,
    first: /\b(hiked|summited|went up|got back|turned around|we bailed|did the|took the|skinned|snowshoed|crossed|subimos|fuimos|bajamos|sommes|avons fait)\b/,
    units: /\b\d[\d,.]*\s?(ft|feet|foot|mph|miles?|mi|km|m|inches|in|cfs|°f|°c)\b/,
    promo: /(\b(sale|discount|code|giveaway|sponsored|shop|tickets|book online|link in bio|subscribe|download|pdf|promo|rabais|vente|concours|oferta|descuento|sorteo)\b|%\s?off|\d+\s?%)/,
    politics: /\b(election|elections|congress|senator|president|governor|vote|voted|legislature|supreme court|protest|tax|budget|campaign|gouvernement|élections|congreso|elecciones|presidente|ley)\b/,
    question: /(\?\s*$|^(anyone|does anyone|what|which|who|how|can someone|quelqu'un|alguien|qué|cuál)\b)/
  };
  const CUE_NAMES = Object.keys(CUES);
  const DIM = BUCKETS + CUE_NAMES.length + 1;

  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h % BUCKETS;
  }

  /** Sparse feature vector: {index: value}. */
  function features(text) {
    const raw = String(text || '').toLowerCase();
    const n = normalize(text);
    const words = n.replace(/https?:\/\/\S+/g, ' url ').split(/[^a-z0-9']+/).filter(w => w.length > 1);
    const f = {};
    const add = (i, v) => { f[i] = (f[i] || 0) + v; };
    const scale = 1 / Math.sqrt(Math.max(1, words.length));
    words.forEach((w, i) => {
      add(fnv('u:' + w), scale);
      if (i) add(fnv('b:' + words[i - 1] + '_' + w), scale);
    });
    CUE_NAMES.forEach((k, j) => {
      const m = raw.match(new RegExp(CUES[k].source, 'g')) || n.match(new RegExp(CUES[k].source, 'g'));
      if (m) add(BUCKETS + j, Math.min(3, m.length) / 2);
    });
    add(BUCKETS + CUE_NAMES.length, Math.min(1, words.length / 40));
    return f;
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

  function Model(weights, bias) {
    this.w = weights ? Float64Array.from(weights) : new Float64Array(DIM);
    this.b = bias || 0;
  }
  Model.prototype.score = function (text, delta) {
    const f = features(text);
    let z = this.b + (delta ? delta.b || 0 : 0);
    for (const k in f) z += f[k] * (this.w[k] + (delta && delta.w[k] ? delta.w[k] : 0));
    return sigmoid(z);
  };
  /** One stochastic gradient step with L2 regularisation. */
  Model.prototype.step = function (text, y, lr, l2) {
    const f = features(text);
    const p = this.score(text);
    const g = y - p;
    for (const k in f) this.w[k] += lr * (g * f[k] - l2 * this.w[k]);
    this.b += lr * g;
    return p;
  };

  /** What made the model decide, for "why am I seeing this". */
  function cues(text) {
    const raw = String(text || '').toLowerCase();
    return CUE_NAMES.filter(k => CUES[k].test(raw));
  }

  const api = { features, Model, cues, DIM, BUCKETS, CUE_NAMES, sigmoid };

  // In the app: load shipped weights and this phone's own adjustments.
  if (root && root.document) {
    const shipped = root.BcReportModel ? new Model(root.BcReportModel.w, root.BcReportModel.b) : new Model();
    let delta = null;
    function loadDelta() {
      if (delta) return delta;
      const d = root.Native && root.Native.kvGetJson('filter_delta');
      delta = { w: (d && d.w) || {}, b: (d && d.b) || 0, n: (d && d.n) || 0 };
      return delta;
    }
    api.score = (text) => shipped.score(text, loadDelta());
    api.threshold = 0.6;
    /** Learn from a tap: y = 1 for a real trail report, 0 for noise. */
    api.learn = (text, y) => {
      const d = loadDelta();
      const f = features(text);
      const p = shipped.score(text, d);
      const g = y - p, lr = 0.5;
      for (const k in f) d.w[k] = (d.w[k] || 0) + lr * g * f[k];
      d.b += lr * g * 0.1;
      d.n++;
      root.Native.kvPutJson('filter_delta', d);
      return shipped.score(text, d);
    };
    api.feedbackCount = () => loadDelta().n;
    api.reset = () => { delta = { w: {}, b: 0, n: 0 }; root.Native.kvPutJson('filter_delta', delta); };
  }

  if (root) root.BcReportFilter = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : null);
