"""Generate MapLibre SDF glyph PBFs from a TTF/OTF/WOFF2 font.

Matches the conventions of the reference (fontnik) glyph sets: 24 px em, 3 px buffer,
SDF radius 8 with cutoff 0.25, top = glyph top minus the font ascender, floored advance.
Usage: python3 make_glyphs.py FONT[,FALLBACK...] "Stack Name" OUT_DIR [ranges...]
"""
import math, os, sys, io
import numpy as np, freetype
from scipy.ndimage import distance_transform_edt
import glyphpbf

SIZE, BUF, RADIUS, CUTOFF, S = 24, 3, 8.0, 0.25, 8

def load_face(path):
    if path.endswith('.woff2'):
        from fontTools.ttLib import TTFont
        f = TTFont(path); f.flavor = None
        b = io.BytesIO(); f.save(b); data = b.getvalue()
        return freetype.Face(io.BytesIO(data))
    return freetype.Face(path)

def glyph(face_lo, face_hi, asc, cp):
    if face_lo.get_char_index(cp) == 0: return None
    face_lo.load_char(chr(cp), freetype.FT_LOAD_NO_HINTING)
    g = face_lo.glyph
    adv = int(math.floor(g.linearHoriAdvance / 65536.0))
    ol = g.outline
    if ol.n_points == 0:
        return {'id': cp, 'width': 0, 'height': 0, 'left': 0, 'top': -asc, 'advance': adv, 'bitmap': b''}
    bb = ol.get_bbox()
    xmin, ymin, xmax, ymax = bb.xMin / 64.0, bb.yMin / 64.0, bb.xMax / 64.0, bb.yMax / 64.0
    left, right, top, bottom = math.floor(xmin), math.ceil(xmax), math.ceil(ymax), math.floor(ymin)
    w, h = right - left, top - bottom
    W, H = w + 2 * BUF, h + 2 * BUF
    face_hi.load_char(chr(cp), freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_RENDER)
    gh = face_hi.glyph; bm = gh.bitmap
    hi = np.zeros((H * S, W * S), dtype=bool)
    if bm.width and bm.rows:
        arr = np.array(bm.buffer, dtype=np.uint8).reshape(bm.rows, bm.pitch)[:, :bm.width] > 127
        ox = gh.bitmap_left - (left - BUF) * S
        oy = (top + BUF) * S - gh.bitmap_top
        y0, x0 = max(0, oy), max(0, ox)
        y1, x1 = min(H * S, oy + bm.rows), min(W * S, ox + bm.width)
        if y1 > y0 and x1 > x0:
            hi[y0:y1, x0:x1] = arr[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    outside = distance_transform_edt(~hi)
    inside = distance_transform_edt(hi)
    d = (outside - inside) / S  # positive outside, in 24 px units
    c = S // 2
    samp = d[c::S, c::S][:H, :W]
    val = np.clip(np.round(255 - 255 * (samp / RADIUS + CUTOFF)), 0, 255).astype(np.uint8)
    return {'id': cp, 'width': w, 'height': h, 'left': left, 'top': top - asc, 'advance': adv, 'bitmap': val.tobytes()}

def build(fonts, stack, out, ranges):
    """fonts: comma-separated files tried in order per character (for subsetted web fonts)."""
    faces = []
    for font in fonts.split(','):
        lo = load_face(font); lo.set_char_size(SIZE * 64)
        hi = load_face(font); hi.set_char_size(SIZE * S * 64)
        faces.append((lo, hi))
    asc = int(round(faces[0][0].size.ascender / 64.0))
    os.makedirs(os.path.join(out, stack), exist_ok=True)
    def first(cp):
        for lo, hi in faces:
            g = glyph(lo, hi, asc, cp)
            if g: return g
        return None
    for r in ranges:
        a, b = map(int, r.split('-'))
        gs = [x for x in (first(cp) for cp in range(a, b + 1)) if x]
        with open(os.path.join(out, stack, r + '.pbf'), 'wb') as f:
            f.write(glyphpbf.encode(stack, r, gs))
        print(stack, r, len(gs), 'glyphs')

if __name__ == '__main__':
    font, stack, out = sys.argv[1:4]
    build(font, stack, out, sys.argv[4:] or ['0-255', '256-511', '8192-8447'])
