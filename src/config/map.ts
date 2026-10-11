// 盤面トポロジー（SPEC.md Section 1）。縦長・3本の縦レーン・レーン間の森・上下の城。
// 自軍(team 0)が下、敵軍(team 1)が上。y が大きいほど下。
import type { BaseKind, LaneId, Team } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WORLD_W = 2400;
export const WORLD_H = 3600;

export const LANE_X: readonly [number, number, number] = [600, 1200, 1800];
export const LANE_WIDTH = 260;
export const LANE_IDS: readonly LaneId[] = [0, 1, 2];

/** プレイ可能領域（外周は崖）。 */
export const PLAY_X0 = LANE_X[0] - LANE_WIDTH / 2 - 40; // 430
export const PLAY_X1 = LANE_X[2] + LANE_WIDTH / 2 + 40; // 1970
export const PLAY_Y0 = 90;
export const PLAY_Y1 = WORLD_H - 90;

export const CASTLE_POS: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 1200, y: 3350 },
  { x: 1200, y: 250 },
];

/** 各チームの拠点 y 座標（手前＝中央寄り、奥＝城寄り）。 */
export const FRONT_Y: readonly [number, number] = [2350, 1250];
export const DEEP_Y: readonly [number, number] = [2900, 700];
/** 刻の門（奥拠点の手前）。 */
export const GATE_Y: readonly [number, number] = [2770, 830];
/** 城の前の広場（レーン同士を横につなぐ）。 */
export const PLAZA_Y: readonly [number, number] = [3150, 450];

/** 森の範囲（y）。森の外（城側）はレーン間が崖になる。 */
export const FOREST_Y0 = 900;
export const FOREST_Y1 = 2700;
/** レーン間の森の帯（x 範囲）。index 0 = 左-中央間, 1 = 中央-右間。 */
export const FOREST_STRIPS: readonly { x0: number; x1: number }[] = [
  { x0: LANE_X[0] + LANE_WIDTH / 2, x1: LANE_X[1] - LANE_WIDTH / 2 },
  { x0: LANE_X[1] + LANE_WIDTH / 2, x1: LANE_X[2] - LANE_WIDTH / 2 },
];

/** 拠点の配置。各レーンに手前1＋奥1。端の右レーン手前は小拠点（悠久門）。 */
export interface BaseSlot {
  team: Team;
  lane: LaneId;
  tier: 'front' | 'deep';
  kind: BaseKind;
  x: number;
  y: number;
}

export const LANE_KINDS: Record<'front' | 'deep', readonly [BaseKind, BaseKind, BaseKind]> = {
  front: ['normal', 'normal', 'small'],
  deep: ['large', 'huge', 'large'],
};

export function baseSlots(): BaseSlot[] {
  const out: BaseSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    for (const lane of LANE_IDS) {
      out.push({ team, lane, tier: 'front', kind: LANE_KINDS.front[lane], x: LANE_X[lane], y: FRONT_Y[team] });
      out.push({ team, lane, tier: 'deep', kind: LANE_KINDS.deep[lane], x: LANE_X[lane], y: DEEP_Y[team] });
    }
  }
  return out;
}

/** 壁。door が付いている壁は、紐づく拠点の破壊で消える（＝森の入り口が開く）。 */
export interface WallDef extends Rect {
  door?: { team: Team; lane: LaneId };
  kind: 'cliff' | 'forestEdge' | 'rock';
}

const EDGE = 34; // 森の縁の壁の厚み
/** 常に開いている森の入り口（中央付近）。 */
export const OPEN_GAPS: readonly [number, number][] = [[1700, 1900]];
/** 拠点破壊で開く入り口：各チームの手前拠点の横。 */
export const DOOR_GAP_HALF = 80;

export function buildWalls(): WallDef[] {
  const walls: WallDef[] = [];
  // 外周の崖
  walls.push({ x: 0, y: 0, w: PLAY_X0, h: WORLD_H, kind: 'cliff' });
  walls.push({ x: PLAY_X1, y: 0, w: WORLD_W - PLAY_X1, h: WORLD_H, kind: 'cliff' });
  walls.push({ x: 0, y: 0, w: WORLD_W, h: PLAY_Y0, kind: 'cliff' });
  walls.push({ x: 0, y: PLAY_Y1, w: WORLD_W, h: WORLD_H - PLAY_Y1, kind: 'cliff' });

  FOREST_STRIPS.forEach((s, stripIdx) => {
    // 森の外側（城側）はレーン間を崖で区切る。城前の広場だけ横につながる。
    walls.push({ x: s.x0, y: PLAZA_Y[1], w: s.x1 - s.x0, h: FOREST_Y0 - PLAZA_Y[1], kind: 'cliff' });
    walls.push({ x: s.x0, y: FOREST_Y1, w: s.x1 - s.x0, h: PLAZA_Y[0] - FOREST_Y1, kind: 'cliff' });

    // 森の左右の縁。開口部＝常設の入り口＋拠点破壊で開く扉。
    const laneLeft = stripIdx as LaneId; // この森の左にあるレーン
    const laneRight = (stripIdx + 1) as LaneId;
    for (const side of ['left', 'right'] as const) {
      const x = side === 'left' ? s.x0 : s.x1 - EDGE;
      const adjLane = side === 'left' ? laneLeft : laneRight;
      const doors: { y0: number; y1: number; team: Team }[] = [
        { y0: FRONT_Y[1] - DOOR_GAP_HALF, y1: FRONT_Y[1] + DOOR_GAP_HALF, team: 1 },
        { y0: FRONT_Y[0] - DOOR_GAP_HALF, y1: FRONT_Y[0] + DOOR_GAP_HALF, team: 0 },
      ];
      const cuts = [
        ...OPEN_GAPS.map(([y0, y1]) => ({ y0, y1, door: undefined as undefined | { team: Team; lane: LaneId } })),
        ...doors.map((d) => ({ y0: d.y0, y1: d.y1, door: { team: d.team, lane: adjLane } })),
      ].sort((a, b) => a.y0 - b.y0);
      let y = FOREST_Y0;
      for (const c of cuts) {
        if (c.y0 > y) walls.push({ x, y, w: EDGE, h: c.y0 - y, kind: 'forestEdge' });
        if (c.door) walls.push({ x, y: c.y0, w: EDGE, h: c.y1 - c.y0, kind: 'forestEdge', door: c.door });
        y = c.y1;
      }
      if (y < FOREST_Y1) walls.push({ x, y, w: EDGE, h: FOREST_Y1 - y, kind: 'forestEdge' });
    }

    // 森の中の岩（遮蔽物）
    const cx = (s.x0 + s.x1) / 2;
    walls.push({ x: cx - 45, y: 1450, w: 90, h: 110, kind: 'rock' });
    walls.push({ x: cx - 45, y: 2040, w: 90, h: 110, kind: 'rock' });
  });
  return walls;
}

/** その座標が森の中か（森の帯のインデックス、または -1）。 */
export function forestAt(x: number, y: number): number {
  if (y < FOREST_Y0 || y > FOREST_Y1) return -1;
  for (let i = 0; i < FOREST_STRIPS.length; i++) {
    const s = FOREST_STRIPS[i];
    if (x > s.x0 && x < s.x1) return i;
  }
  return -1;
}

/** x 座標から最も近いレーン。 */
export function nearestLane(x: number): LaneId {
  let best: LaneId = 0;
  for (const l of LANE_IDS) if (Math.abs(LANE_X[l] - x) < Math.abs(LANE_X[best] - x)) best = l;
  return best;
}

/** チームの前進方向（y の符号）。自軍は上(-)へ攻める。 */
export function forwardSign(team: Team): number {
  return team === 0 ? -1 : 1;
}

/** 兵士の出撃位置（城前のレーン入口）。 */
export function laneMouth(team: Team, lane: LaneId): { x: number; y: number } {
  return { x: LANE_X[lane], y: team === 0 ? 3230 : 370 };
}
