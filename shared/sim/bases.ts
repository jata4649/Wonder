// 拠点・城・刻の門。
import { BASES, GATE_OPEN_SEC, MINION } from '../config/balance';
import { CASTLE_POS, GATE_Y, LANE_X, baseSlots } from '../config/map';
import type { BaseDef, GateKind, LaneId, Team } from '../config/types';

export type GateState = 'closed' | 'opening' | 'open';

export interface Base {
  id: number;
  kind: 'base';
  team: Team;
  lane: LaneId | -1; // 城は -1
  tier: 'front' | 'deep' | 'castle';
  def: BaseDef;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 奥拠点の手前にある刻の門。手前拠点が壊れるまで closed。 */
  gate?: { kind: GateKind; state: GateState; timer: number; x: number; y: number; openedAt?: number };
  /** 視界半径（ミニマップ表示用）。 */
  vision: number;
  /** 被弾演出用。 */
  hitFlash: number;
  /** 次の出撃までの秒数（兵士生成） */
  spawnTimer: number;
  spawnCount: number;
  destroyedAt?: number;
}

export function createBases(nextId: () => number): Base[] {
  const out: Base[] = [];
  for (const s of baseSlots()) {
    const def = BASES[s.kind];
    const b: Base = {
      id: nextId(),
      kind: 'base',
      team: s.team,
      lane: s.lane,
      tier: s.tier,
      def,
      x: s.x,
      y: s.y,
      r: def.radius,
      hp: def.maxHp,
      maxHp: def.maxHp,
      alive: true,
      vision: 650,
      hitFlash: 0,
      spawnTimer: s.tier === 'front' ? MINION.frontWave.firstAt : 0,
      spawnCount: 0,
    };
    if (s.tier === 'deep') {
      b.gate = { kind: 'none', state: 'closed', timer: 0, x: LANE_X[s.lane], y: GATE_Y[s.team] };
    }
    out.push(b);
  }
  // 手前拠点の門の種類を確定（手前拠点の種別に従う）
  for (const deep of out) {
    if (deep.tier !== 'deep' || !deep.gate) continue;
    const front = out.find((f) => f.tier === 'front' && f.team === deep.team && f.lane === deep.lane)!;
    deep.gate.kind = front.def.gate;
  }
  for (const team of [0, 1] as Team[]) {
    const def = BASES.castle;
    out.push({
      id: nextId(),
      kind: 'base',
      team,
      lane: -1,
      tier: 'castle',
      def,
      x: CASTLE_POS[team].x,
      y: CASTLE_POS[team].y,
      r: def.radius,
      hp: def.maxHp,
      maxHp: def.maxHp,
      alive: true,
      vision: 800,
      hitFlash: 0,
      spawnTimer: 0,
      spawnCount: 0,
    });
  }
  return out;
}

/** 門が閉じていて（＝ダメージを一切通さない）状態か。 */
export function isGateProtected(b: Base): boolean {
  return !!b.gate && b.gate.state !== 'open';
}

/** 手前拠点が壊れたとき、同じレーンの奥拠点の門を開き始める。 */
export function startGateOpening(deep: Base) {
  if (!deep.gate || deep.gate.state !== 'closed') return;
  deep.gate.state = 'opening';
  deep.gate.timer = GATE_OPEN_SEC[deep.gate.kind];
}

/** 門の更新。開いた瞬間に true を返す。 */
export function updateGate(b: Base, dt: number): boolean {
  if (!b.gate || b.gate.state !== 'opening') return false;
  b.gate.timer -= dt;
  if (b.gate.timer <= 0) {
    b.gate.state = 'open';
    b.gate.timer = 0;
    return true;
  }
  return false;
}
