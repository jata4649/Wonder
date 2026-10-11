// クロスドロー：ドローを描くと軌跡が約20秒残る（敵味方どちらも見える）。
// 味方の軌跡に交わるように描くと弾サイズ・威力・弾速が強化。単独クロス持ちは自分の前回軌跡でも可。
import { CROSS } from '../config/balance';
import type { Team } from '../config/types';
import type { Vec } from './geom';
import { segIntersect } from './geom';

export interface Trail {
  id: number;
  team: Team;
  ownerId: number;
  pts: Vec[];
  t: number; // 残り秒数
  crossed: boolean;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  color: string;
}

export function makeTrail(id: number, team: Team, ownerId: number, pts: Vec[], crossed: boolean, color: string): Trail {
  // 間引いて保持（16px 間隔）
  const out: Vec[] = [pts[0]];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (Math.hypot(p.x - l.x, p.y - l.y) >= 16) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return { id, team, ownerId, pts: out, t: CROSS.trailLifeSec, crossed, bbox: bboxOf(out), color };
}

function bboxOf(pts: Vec[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** 2つの折れ線が交差するか。 */
export function polylinesCross(a: Vec[], b: Vec[]): boolean {
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const q = a[i];
    for (let j = 1; j < b.length; j++) {
      const r = b[j - 1];
      const s = b[j];
      if (segIntersect(p.x, p.y, q.x, q.y, r.x, r.y, s.x, s.y)) return true;
    }
  }
  return false;
}

/** 描いた軌跡が交差できる軌跡に交わるか。 */
export function findCross(trails: Trail[], team: Team, ownerId: number, soloCross: boolean, lastOwnTrailId: number, path: Vec[]): Trail | undefined {
  const bb = bboxOf(path);
  for (const tr of trails) {
    if (tr.team !== team) continue;
    const own = tr.ownerId === ownerId;
    if (own && !(soloCross && tr.id === lastOwnTrailId)) continue;
    if (tr.bbox.x1 < bb.x0 || tr.bbox.x0 > bb.x1 || tr.bbox.y1 < bb.y0 || tr.bbox.y0 > bb.y1) continue;
    if (polylinesCross(path, tr.pts)) return tr;
  }
  return undefined;
}
