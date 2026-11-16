// Lecteur EXIF minimal pour JPEG : position GPS, date de prise de vue, orientation.
export function readExif(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      const marker = view.getUint16(off);
      off += 2;
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      const len = view.getUint16(off);
      if (marker === 0xffe1 && view.getUint32(off + 2) === 0x45786966 && view.getUint16(off + 6) === 0) {
        return parseTiff(view, off + 8);
      }
      off += len;
    }
  } catch { /* EXIF illisible : on ignore */ }
  return null;
}

function parseTiff(view, start) {
  const le = view.getUint16(start) === 0x4949;
  const u16 = (o) => view.getUint16(start + o, le);
  const u32 = (o) => view.getUint32(start + o, le);
  const i32 = (o) => view.getInt32(start + o, le);
  if (u16(2) !== 42) return null;
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readIfd = (ifdOff) => {
    const tags = {};
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 };
    }
    return tags;
  };
  const val = (t) => {
    if (!t) return null;
    const size = SIZES[t.type] || 1;
    const dataOff = size * t.count > 4 ? u32(t.valOff) : t.valOff;
    if (t.type === 2) {
      let s = '';
      for (let i = 0; i < t.count; i++) { const c = view.getUint8(start + dataOff + i); if (!c) break; s += String.fromCharCode(c); }
      return s.trim();
    }
    const arr = [];
    for (let i = 0; i < Math.min(t.count, 16); i++) {
      const o = dataOff + i * size;
      if (t.type === 3) arr.push(u16(o));
      else if (t.type === 4) arr.push(u32(o));
      else if (t.type === 5) arr.push(u32(o) / (u32(o + 4) || 1));
      else if (t.type === 9) arr.push(i32(o));
      else if (t.type === 10) arr.push(i32(o) / (i32(o + 4) || 1));
      else arr.push(view.getUint8(start + o));
    }
    return arr.length === 1 ? arr[0] : arr;
  };

  const out = {};
  const ifd0 = readIfd(u32(4));
  if (ifd0[0x0112]) out.orientation = val(ifd0[0x0112]);
  if (ifd0[0x8769]) {
    const ex = readIfd(val(ifd0[0x8769]));
    out.dateTimeOriginal = val(ex[0x9003]) || val(ifd0[0x0132]) || null;
    out.offsetTime = val(ex[0x9011]) || null;
  }
  if (ifd0[0x8825]) {
    const g = readIfd(val(ifd0[0x8825]));
    const lat = val(g[2]), lon = val(g[4]);
    if (Array.isArray(lat) && Array.isArray(lon) && lat.length >= 3 && lon.length >= 3) {
      let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
      let lo = lon[0] + lon[1] / 60 + lon[2] / 3600;
      if (val(g[1]) === 'S') la = -la;
      if (val(g[3]) === 'W') lo = -lo;
      if ((la || lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { out.lat = la; out.lon = lo; }
    }
    const alt = val(g[6]);
    if (typeof alt === 'number') out.alt = val(g[5]) === 1 ? -alt : alt;
  }
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(out.dateTimeOriginal || '');
  if (m) {
    if (out.offsetTime && /^[+-]\d{2}:\d{2}$/.test(out.offsetTime)) {
      out.time = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${out.offsetTime}`);
    } else {
      out.time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    }
    if (!Number.isFinite(out.time)) delete out.time;
  }
  return out;
}
