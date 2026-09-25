"""Minimal reader/writer for MapLibre glyph PBFs (glyphs.proto), no protobuf dependency."""

def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)

def _zz(n): return (n << 1) ^ (n >> 63)

def _field(num, wt, payload):
    return _varint((num << 3) | wt) + payload

def _len(num, data): return _field(num, 2, _varint(len(data)) + data)

def encode(stack_name, rng, glyphs):
    body = _len(1, stack_name.encode()) + _len(2, rng.encode())
    for g in glyphs:
        gb = _field(1, 0, _varint(g['id']))
        if g.get('bitmap'): gb += _len(2, g['bitmap'])
        gb += _field(3, 0, _varint(g['width'])) + _field(4, 0, _varint(g['height']))
        gb += _field(5, 0, _varint(_zz(g['left']) & 0xFFFFFFFFFFFFFFFF)) + _field(6, 0, _varint(_zz(g['top']) & 0xFFFFFFFFFFFFFFFF))
        gb += _field(7, 0, _varint(g['advance']))
        body += _len(3, gb)
    return _len(1, body)

def _read_varint(b, i):
    s = 0; r = 0
    while True:
        x = b[i]; i += 1; r |= (x & 0x7F) << s; s += 7
        if not x & 0x80: return r, i

def _msg(b):
    i = 0; out = []
    while i < len(b):
        k, i = _read_varint(b, i); num, wt = k >> 3, k & 7
        if wt == 0: v, i = _read_varint(b, i)
        elif wt == 2:
            l, i = _read_varint(b, i); v = b[i:i + l]; i += l
        else: raise ValueError('wire type %d' % wt)
        out.append((num, v))
    return out

def decode(data):
    res = []
    for num, stack in _msg(data):
        for n2, v in _msg(stack):
            if n2 == 3:
                g = {}
                for n3, v3 in _msg(v):
                    key = {1: 'id', 2: 'bitmap', 3: 'width', 4: 'height', 5: 'left', 6: 'top', 7: 'advance'}[n3]
                    if n3 in (5, 6): v3 = (v3 >> 1) ^ -(v3 & 1)
                    g[key] = v3
                res.append(g)
    return res
