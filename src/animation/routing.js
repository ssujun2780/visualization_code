// Rectilinear visibility grid. All geometry comes from the current scene;
// source code, variable names and instruction operators are irrelevant here.
const epsilon = 1e-6;
const inflate = (r, gap) => ({x: r.x - gap, y: r.y - gap, width: r.width + gap * 2, height: r.height + gap * 2});
const inside = (p, r) => p.x > r.x + epsilon && p.x < r.x + r.width - epsilon && p.y > r.y + epsilon && p.y < r.y + r.height - epsilon;
const length = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function segmentBlocked(a, b, rectangles) {
  return rectangles.some(r => a.y === b.y
    ? a.y > r.y + epsilon && a.y < r.y + r.height - epsilon && Math.max(a.x, b.x) > r.x + epsilon && Math.min(a.x, b.x) < r.x + r.width - epsilon
    : a.x > r.x + epsilon && a.x < r.x + r.width - epsilon && Math.max(a.y, b.y) > r.y + epsilon && Math.min(a.y, b.y) < r.y + r.height - epsilon);
}
function terminals(rectangle, gap) {
  const {x, y, width: w, height: h} = rectangle;
  return [[x + w, y + h / 2, 1, 0], [x + w / 2, y + h, 0, 1], [x, y + h / 2, -1, 0], [x + w / 2, y, 0, -1]]
    .map(([x, y, dx, dy]) => ({port: {x, y}, point: {x: x + dx * gap, y: y + dy * gap}, direction: dx ? 1 : 2}));
}
class Queue {
  items = [];
  push(item) {
    const a = this.items; a.push(item);
    let i = a.length - 1;
    while (i && a[(i - 1) >> 1].priority > item.priority) { a[i] = a[(i - 1) >> 1]; i = (i - 1) >> 1; }
    a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].priority < a[child].priority) child++;
        if (last.priority <= a[child].priority) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
}
export function routeTransfer(from, to, obstacles, gap = 14) {
  const foreign = obstacles.map(r => inflate(r, gap));
  const rectangles = [...foreign, inflate(from, gap), inflate(to, gap)];
  const starts = terminals(from, gap).filter(t => !segmentBlocked(t.port, t.point, [...foreign, rectangles.at(-1)]));
  const ends = terminals(to, gap).filter(t => !segmentBlocked(t.port, t.point, [...foreign, rectangles.at(-2)]));
  if (!starts.length || !ends.length) return null;
  const points = [...starts, ...ends].map(t => t.point);
  const xs = [...new Set([...points.map(p => p.x), ...rectangles.flatMap(r => [r.x, r.x + r.width])])].sort((a, b) => a - b);
  const ys = [...new Set([...points.map(p => p.y), ...rectangles.flatMap(r => [r.y, r.y + r.height])])].sort((a, b) => a - b);
  const width = xs.length, height = ys.length;
  const node = p => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const point = id => ({x: xs[id % width], y: ys[Math.floor(id / width)]});
  const goal = new Map(ends.map(t => [node(t.point), t]));
  const heuristic = p => Math.min(...ends.map(t => length(p, t.point))) + gap;
  const queue = new Queue(), distances = new Map(), previous = new Map(), origins = new Map(), blocked = new Map();
  const relax = (key, cost, parent, origin) => {
    if (cost >= (distances.get(key) ?? Infinity)) return;
    distances.set(key, cost); previous.set(key, parent); origins.set(key, origin);
    queue.push({key, cost, priority: cost + heuristic(point(Math.floor(key / 3)))});
  };
  for (const t of starts) if (!rectangles.some(r => inside(t.point, r))) relax(node(t.point) * 3 + t.direction, gap, null, t);
  let best = null;
  while (queue.items.length) {
    const current = queue.pop();
    if (best && current.priority >= best.cost) break;
    if (current.cost !== distances.get(current.key)) continue;
    const id = Math.floor(current.key / 3), direction = current.key % 3, p = point(id), end = goal.get(id);
    if (end) {
      const cost = current.cost + gap + (end.direction === direction ? 0 : gap);
      if (!best || cost < best.cost) best = {key: current.key, cost, end};
    }
    const x = id % width, y = Math.floor(id / width);
    for (const [nx, ny, nextDirection] of [[x - 1, y, 1], [x + 1, y, 1], [x, y - 1, 2], [x, y + 1, 2]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx, q = point(next), edge = id < next ? `${id}:${next}` : `${next}:${id}`;
      if (!blocked.has(edge)) blocked.set(edge, segmentBlocked(p, q, rectangles));
      if (blocked.get(edge)) continue;
      relax(next * 3 + nextDirection, current.cost + length(p, q) + (direction === nextDirection ? 0 : gap), current.key, origins.get(current.key));
    }
  }
  if (!best) return null; // Never fall back to a line through an occupied box.
  const path = [best.end.port];
  for (let key = best.key; key !== null; key = previous.get(key)) path.push(point(Math.floor(key / 3)));
  path.push(origins.get(best.key).port); path.reverse();
  return path.filter((p, i) => !i || i === path.length - 1 || !((path[i - 1].x === p.x && p.x === path[i + 1].x) || (path[i - 1].y === p.y && p.y === path[i + 1].y)));
}
