/* Map icons, drawn on the phone: trail symbols, one-way arrows and highway route shields. */
(function () {
  const DPR = 2;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
    const g = c.getContext('2d');
    g.scale(DPR, DPR);
    return { c, g };
  }
  const out = ({ c, g }) => ({ img: g.getImageData(0, 0, c.width, c.height), pixelRatio: DPR });

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  // Classic US route shield outline: flat top with small ears, curving to a point at the bottom.
  function shieldPath(g, x, y, w, h) {
    g.beginPath();
    g.moveTo(x + w * 0.08, y);
    g.quadraticCurveTo(x + w * 0.25, y + h * 0.08, x + w * 0.5, y + h * 0.02);
    g.quadraticCurveTo(x + w * 0.75, y + h * 0.08, x + w * 0.92, y);
    g.quadraticCurveTo(x + w * 1.02, y + h * 0.35, x + w * 0.96, y + h * 0.55);
    g.quadraticCurveTo(x + w * 0.85, y + h * 0.88, x + w * 0.5, y + h);
    g.quadraticCurveTo(x + w * 0.15, y + h * 0.88, x + w * 0.04, y + h * 0.55);
    g.quadraticCurveTo(x - w * 0.02, y + h * 0.35, x + w * 0.08, y);
    g.closePath();
  }

  function label(g, text, cx, cy, color, size) {
    g.fillStyle = color;
    g.font = '700 ' + size + 'px Overpass, "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, cx, cy + size * 0.06);
  }

  function cleanRef(network, ref) {
    let r = String(ref || '').split(';')[0].trim();
    if (/^(us-|ca-)/.test(network)) r = r.replace(/^(I|US|SR|CR|[A-Z]{2}|TCH|Hwy|Highway|Route|Rte)[\s-]*/i, '');
    return r.slice(0, 5);
  }

  function shield(network, ref) {
    const r = cleanRef(network, ref);
    if (!r) return null;
    const n = r.length;
    const fs = n >= 4 ? 9 : 11;
    if (network === 'us-interstate') {
      const w = n >= 3 ? 30 : 25, h = 26;
      const k = canvas(w + 2, h + 2), g = k.g;
      shieldPath(g, 1, 1, w, h); g.fillStyle = '#FFFFFF'; g.fill();
      shieldPath(g, 2.2, 2.2, w - 2.4, h - 2.4); g.fillStyle = '#1B4C9C'; g.fill();
      g.save(); shieldPath(g, 2.2, 2.2, w - 2.4, h - 2.4); g.clip(); g.fillStyle = '#C8102E'; g.fillRect(0, 0, w + 2, 8.5); g.restore();
      label(g, r, 1 + w / 2, 1 + h * 0.58, '#FFFFFF', fs);
      return out(k);
    }
    if (network === 'us-highway') {
      const w = n >= 3 ? 28 : 24, h = 25;
      const k = canvas(w + 2, h + 2), g = k.g;
      shieldPath(g, 1, 1, w, h); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#1C1C1C'; g.stroke();
      label(g, r, 1 + w / 2, 1 + h * 0.45, '#1C1C1C', fs);
      return out(k);
    }
    if (network === 'ca-transcanada') {
      const w = n >= 3 ? 28 : 24, h = 25;
      const k = canvas(w + 2, h + 2), g = k.g;
      shieldPath(g, 1, 1, w, h); g.fillStyle = '#FFFFFF'; g.fill();
      shieldPath(g, 2.2, 2.2, w - 2.4, h - 2.4); g.fillStyle = '#2E7D32'; g.fill();
      label(g, r, 1 + w / 2, 1 + h * 0.5, '#FFFFFF', fs);
      return out(k);
    }
    // State, provincial and other numbered routes: white plate with a dark border.
    const w = Math.max(20, 8 + n * 7.5), h = 17;
    const k = canvas(w + 2, h + 2), g = k.g;
    const oval = network === 'us-state';
    roundRect(g, 1, 1, w, h, oval ? 8.5 : 3);
    g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 1.4;
    g.strokeStyle = /^ca-provincial/.test(network) ? '#1F3E78' : '#2A2A2A'; g.stroke();
    label(g, r, 1 + w / 2, 1 + h / 2, '#1C1C1C', fs - 1);
    return out(k);
  }

  function pinShape(g, fill, inner) {
    g.fillStyle = fill; g.strokeStyle = '#FFFFFF'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(14, 27); g.bezierCurveTo(4, 17, 4, 12, 4, 10); g.arc(14, 10, 10, Math.PI, 0); g.bezierCurveTo(24, 12, 24, 17, 14, 27); g.fill(); g.stroke();
    inner(g);
  }
  function fan(color) {
    const k = canvas(44, 44), g = k.g, s = 44;
    const grd = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    grd.addColorStop(0, color.replace('A', '0.55')); grd.addColorStop(1, color.replace('A', '0'));
    g.fillStyle = grd; g.beginPath(); g.moveTo(s / 2, s / 2); g.arc(s / 2, s / 2, s / 2, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
    return out(k);
  }

  const STATIC = {
    'bc-trailhead': () => { const k = canvas(26, 26), g = k.g; g.fillStyle = '#0F3D2E'; g.strokeStyle = '#C9A227'; g.lineWidth = 2; roundRect(g, 2, 2, 22, 22, 6); g.fill(); g.stroke(); g.strokeStyle = '#F4EFDF'; g.beginPath(); g.moveTo(9, 20); g.lineTo(9, 7); g.lineTo(18, 10); g.lineTo(9, 13); g.stroke(); return out(k); },
    'bc-crag': () => { const k = canvas(20, 20), g = k.g; g.fillStyle = '#6B5A3E'; g.strokeStyle = '#FFFFFF'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(10, 2); g.lineTo(18, 17); g.lineTo(2, 17); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#C9A227'; g.fillRect(8.5, 7, 3, 6); return out(k); },
    'bc-peak': () => { const k = canvas(14, 14), g = k.g; g.fillStyle = '#5A4632'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(7, 1); g.lineTo(13, 12); g.lineTo(1, 12); g.closePath(); g.fill(); g.stroke(); return out(k); },
    'bc-pin': () => { const k = canvas(28, 28); pinShape(k.g, '#1F6B4A', g => { g.fillStyle = '#C9A227'; g.beginPath(); g.arc(14, 10, 3.5, 0, Math.PI * 2); g.fill(); }); return out(k); },
    'bc-report': () => { const k = canvas(28, 28); pinShape(k.g, '#C9A227', g => { g.fillStyle = '#0F3D2E'; g.fillRect(12.8, 4.5, 2.4, 7); g.fillRect(12.8, 13, 2.4, 2.4); }); return out(k); },
    'bc-track-start': () => { const k = canvas(18, 18), g = k.g; g.fillStyle = '#1F6B4A'; g.strokeStyle = '#FFF'; g.lineWidth = 2.5; g.beginPath(); g.arc(9, 9, 6.5, 0, Math.PI * 2); g.fill(); g.stroke(); return out(k); },
    'bc-track-end': () => { const k = canvas(18, 18), g = k.g; g.fillStyle = '#B8412F'; g.strokeStyle = '#FFF'; g.lineWidth = 2.5; roundRect(g, 2.5, 2.5, 13, 13, 2); g.fill(); g.stroke(); return out(k); },
    'bc-heading': () => fan('rgba(31,107,74,A)'),
    'bc-heading-est': () => fan('rgba(217,144,26,A)'),
    'bc-oneway': () => { const k = canvas(14, 10), g = k.g; g.strokeStyle = 'rgba(90,85,75,0.75)'; g.lineWidth = 1.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(2, 5); g.lineTo(11, 5); g.moveTo(8, 2); g.lineTo(11.5, 5); g.lineTo(8, 8); g.stroke(); return out(k); }
  };

  /** Returns {img, pixelRatio} for a style image id, or null if unknown. */
  function get(id) {
    if (STATIC[id]) return STATIC[id]();
    if (id.startsWith('shield|')) {
      const parts = id.split('|');
      return shield(parts[1], parts.slice(2).join('|'));
    }
    return null;
  }

  window.BcIcons = { get, cleanRef };
})();
