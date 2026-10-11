// 簡易ナビ：レーン（縦の通路）と、レーン同士をつなぐ横断点（森の入口・城前広場）のグラフ。
import { FOREST_STRIPS, LANE_X, OPEN_GAPS, PLAZA_Y, forestAt, nearestLane } from '../config/map';
import type { LaneId, Team } from '../config/types';
import type { Vec } from '../sim/geom';
import type { World } from '../sim/world';

interface Crossing {
  y: number;
  a: LaneId;
  b: LaneId;
}

function crossings(world: World): Crossing[] {
  const out: Crossing[] = [];
  const ys = [PLAZA_Y[1] - 120, PLAZA_Y[0] + 120, ...OPEN_GAPS.map(([a, b]) => (a + b) / 2)];
  for (const y of ys) {
    out.push({ y, a: 0, b: 1 }, { y, a: 1, b: 2 });
  }
  // 拠点破壊で開いた森の入口（両側が開いていれば横断可）
  for (const team of [0, 1] as Team[]) {
    for (const [a, b] of [
      [0, 1],
      [1, 2],
    ] as [LaneId, LaneId][]) {
      const fa = world.frontBase(team, a);
      const fb = world.frontBase(team, b);
      if (fa && fb && !fa.alive && !fb.alive) out.push({ y: fa.y, a, b });
    }
  }
  return out;
}

/** 森の中から外へ出る経由点（常設の入口・開いた扉）。 */
function forestExit(world: World, strip: number, from: Vec, to: Vec): Vec {
  const s = FOREST_STRIPS[strip];
  const cands: { y: number; lane: LaneId }[] = [];
  for (const [a, b] of OPEN_GAPS) for (const lane of [strip, strip + 1] as LaneId[]) cands.push({ y: (a + b) / 2, lane });
  // 扉：左の縁はこの森の左レーン、右の縁は右レーンの手前拠点に紐づく
  for (const team of [0, 1] as Team[]) {
    for (const lane of [strip, strip + 1] as LaneId[]) {
      const fb = world.frontBase(team, lane);
      if (fb && !fb.alive) cands.push({ y: fb.y, lane });
    }
  }
  let best = cands[0];
  let bc = Infinity;
  for (const c of cands) {
    const ex = LANE_X[c.lane];
    const cost = Math.hypot(ex - from.x, c.y - from.y) + Math.hypot(to.x - ex, to.y - c.y);
    if (cost < bc) {
      bc = cost;
      best = c;
    }
  }
  const leftSide = best.lane === strip;
  // 出口の高さに揃うまでは、中央の岩を避けて出口側の縁沿いを縦に移動
  if (Math.abs(from.y - best.y) > 30) return { x: leftSide ? s.x0 + 70 : s.x1 - 70, y: best.y };
  return { x: LANE_X[best.lane], y: best.y };
}

/** 現在地から目的地までの次の経由点。 */
export function nextWaypoint(world: World, from: Vec, to: Vec): Vec {
  const fa = forestAt(from.x, from.y);
  if (fa >= 0 && forestAt(to.x, to.y) !== fa) {
    // 横断中（横断点の高さにいる）なら目的側のレーンへそのまま抜ける
    const lb = laneOf(to);
    const side: LaneId = (lb === -1 ? (Math.abs(to.x - LANE_X[fa]) < Math.abs(to.x - LANE_X[fa + 1]) ? fa : fa + 1) : lb <= fa ? fa : fa + 1) as LaneId;
    const crossing = crossings(world).find((c) => c.a === fa && c.b === fa + 1 && Math.abs(from.y - c.y) < 45);
    if (crossing) return { x: LANE_X[side], y: crossing.y };
    return forestExit(world, fa, from, to);
  }
  const la = laneOf(from);
  const lb = laneOf(to);
  if (la === -1 && lb === -1) return to;
  if (la === -1) {
    // 広場 → レーン：まずレーンの入口へ
    const py = from.y > 1800 ? PLAZA_Y[0] + 80 : PLAZA_Y[1] - 80;
    if (Math.abs(from.x - LANE_X[lb as LaneId]) > 50) return { x: LANE_X[lb as LaneId], y: py };
    return to;
  }
  if (lb === -1) {
    // レーン → 広場：レーンを抜けてから
    const py = to.y > 1800 ? PLAZA_Y[0] + 80 : PLAZA_Y[1] - 80;
    if (Math.abs(from.y - py) > 40 && Math.abs(from.x - to.x) > 60) return { x: LANE_X[la], y: py };
    return to;
  }
  if (la === lb) return to;
  // 1レーンずつ移動
  const step = (lb > la ? la + 1 : la - 1) as LaneId;
  const opts = crossings(world).filter((c) => (c.a === la && c.b === step) || (c.b === la && c.a === step));
  let best = opts[0];
  let bc = Infinity;
  for (const c of opts) {
    const cost = Math.abs(from.y - c.y) + Math.abs(to.y - c.y);
    if (cost < bc) {
      bc = cost;
      best = c;
    }
  }
  if (!best) return to;
  // 横断点の手前（自レーン上）に着いていたら横に進む
  if (Math.abs(from.y - best.y) < 40) return { x: LANE_X[step], y: best.y };
  return { x: LANE_X[la], y: best.y };
}

/** 縦通路のどれにいるか（森の中なら最寄り）。広場では -1（自由移動）。 */
function laneOf(p: Vec): LaneId | -1 {
  if (p.y < PLAZA_Y[1] - 40 || p.y > PLAZA_Y[0] + 40) return -1;
  return nearestLane(p.x);
}

