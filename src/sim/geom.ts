import type { Rect } from '../config/map';

export interface Vec {
  x: number;
  y: number;
}

export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(dist2(ax, ay, bx, by));
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 円と矩形が重なっているか。 */
export function circleRect(cx: number, cy: number, r: number, rc: Rect): boolean {
  const nx = clamp(cx, rc.x, rc.x + rc.w);
  const ny = clamp(cy, rc.y, rc.y + rc.h);
  return dist2(cx, cy, nx, ny) < r * r;
}

/** 円を矩形の外へ押し出す。押し出したら true。 */
export function pushOutOfRect(p: Vec, r: number, rc: Rect): boolean {
  const nx = clamp(p.x, rc.x, rc.x + rc.w);
  const ny = clamp(p.y, rc.y, rc.y + rc.h);
  const dx = p.x - nx;
  const dy = p.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    p.x = nx + (dx / d) * r;
    p.y = ny + (dy / d) * r;
  } else {
    // 中心が矩形内：最も近い辺へ
    const l = p.x - rc.x;
    const rgt = rc.x + rc.w - p.x;
    const t = p.y - rc.y;
    const b = rc.y + rc.h - p.y;
    const m = Math.min(l, rgt, t, b);
    if (m === l) p.x = rc.x - r;
    else if (m === rgt) p.x = rc.x + rc.w + r;
    else if (m === t) p.y = rc.y - r;
    else p.y = rc.y + rc.h + r;
  }
  return true;
}

export function pointInRect(x: number, y: number, rc: Rect): boolean {
  return x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
}

/** 線分 (a→b) と線分 (c→d) が交差するか。 */
export function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 線分が矩形を横切るか（簡易：サンプリングではなくスラブ法）。 */
export function segRect(ax: number, ay: number, bx: number, by: number, rc: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - rc.x, rc.x + rc.w - ax, ay - rc.y, rc.y + rc.h - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** シード付き乱数（mulberry32）。 */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hiExcl: number) => Math.floor(lo + (hiExcl - lo) * next()),
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
  };
}
export type Rng = ReturnType<typeof makeRng>;
