import {segmentBox} from './spatial-index.js';

const coincident = (a, b, c, d) => a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 0.001 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 8
  || a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 0.001 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 8;
export function packPointerPath(path, id, segments, valid, ignored = new Set()) {
  const conflict = (a, b) => segments.query(segmentBox(a, b, 0.01)).some(s => s.id !== id && !ignored.has(s.id) && coincident(a, b, s.a, s.b));
  if (!path.slice(1).some((b, i) => conflict(path[i], b))) return path;
  const build = shifts => {
    const lines = path.slice(1).map((b, i) => ({a: path[i], b, h: path[i].y === b.y, shift: shifts[i]}));
    const first = lines[0], last = lines.at(-1), out = [path[0]];
    const stub = (line, end) => {
      const p = end ? line.b : line.a, q = end ? line.a : line.b;
      const length = Math.abs(p.x - q.x) + Math.abs(p.y - q.y), d = Math.min(6, length / 3);
      return line.h ? {x: p.x + Math.sign(q.x - p.x) * d, y: p.y} : {x: p.x, y: p.y + Math.sign(q.y - p.y) * d};
    };
    const shifted = (p, line) => line.h ? {x: p.x, y: p.y + line.shift} : {x: p.x + line.shift, y: p.y};
    if (first.shift) { const p = stub(first, false); out.push(p, shifted(p, first)); }
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i];
      out.push(a.h ? {x: b.a.x + b.shift, y: a.b.y + a.shift} : {x: a.b.x + a.shift, y: b.a.y + b.shift});
    }
    if (last.shift) { const p = stub(last, true); out.push(shifted(p, last), p); }
    out.push(path.at(-1));
    return out.filter((p, i) => !i || p.x !== out[i - 1].x || p.y !== out[i - 1].y);
  };
  // Corridors retain their original centerline. Only the new/blocked route
  // takes a free lane, so inserting a pointer does not shuffle an old bundle.
  for (const spacing of [5, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
    const shifts = path.slice(1).map((b, i) => {
      const a = path[i], h = a.y === b.y;
      if (!conflict(a, b)) return 0;
      for (let slot = 1; slot * spacing <= 6; slot++) for (const sign of [1, -1]) {
        const delta = slot * spacing * sign;
        const c = h ? {x: a.x, y: a.y + delta} : {x: a.x + delta, y: a.y};
        const d = h ? {x: b.x, y: b.y + delta} : {x: b.x + delta, y: b.y};
        if (!conflict(c, d)) return delta;
      }
      return 0;
    });
    const result = build(shifts);
    if (valid(result) && !result.slice(1).some((b, i) => conflict(result[i], b))) return result;
  }
  return path;
}
