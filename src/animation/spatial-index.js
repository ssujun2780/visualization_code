// Uniform spatial hash with overflow handling for very large obstacles.
export class SpatialIndex {
  constructor(size = 192) { this.size = size; this.items = new Map(); this.buckets = new Map(); this.large = new Set(); }
  keys(r) {
    const x0 = Math.floor(r.x / this.size), x1 = Math.floor((r.x + r.width) / this.size);
    const y0 = Math.floor(r.y / this.size), y1 = Math.floor((r.y + r.height) / this.size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 512) return null;
    const keys = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`);
    return keys;
  }
  delete(id) {
    const old = this.items.get(id);
    if (!old) return;
    for (const key of old.keys ?? []) { const bucket = this.buckets.get(key); bucket?.delete(id); if (!bucket?.size) this.buckets.delete(key); }
    this.large.delete(id); this.items.delete(id);
  }
  set(id, rectangle, value = id) {
    this.delete(id);
    const keys = this.keys(rectangle);
    this.items.set(id, {rectangle, value, keys});
    if (!keys) this.large.add(id);
    else for (const key of keys) { if (!this.buckets.has(key)) this.buckets.set(key, new Set()); this.buckets.get(key).add(id); }
  }
  query(r) {
    const keys = this.keys(r), ids = new Set(this.large);
    if (!keys) for (const id of this.items.keys()) ids.add(id);
    else for (const key of keys) for (const id of this.buckets.get(key) ?? []) ids.add(id);
    const result = [];
    for (const id of ids) {
      const item = this.items.get(id), a = item.rectangle;
      if (a.x <= r.x + r.width && a.x + a.width >= r.x && a.y <= r.y + r.height && a.y + a.height >= r.y) result.push(item.value);
    }
    return result;
  }
}
export const segmentBox = (a, b, padding = 0) => ({x: Math.min(a.x, b.x) - padding, y: Math.min(a.y, b.y) - padding,
  width: Math.abs(a.x - b.x) + padding * 2, height: Math.abs(a.y - b.y) + padding * 2});
