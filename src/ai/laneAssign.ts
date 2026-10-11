// レーン割り当て：ファイター=端/中央、アタッカー=中央/遊撃、サポーター=中央。
// 全レーンに最低1人を置く。プレイヤーのいるレーンは固定として扱う。
import type { LaneId, Role } from '../config/types';

export interface AssignInput {
  id: number;
  role: Role;
  fixedLane?: LaneId; // プレイヤーなど
}

export interface Assignment {
  lane: LaneId;
  roam: boolean;
}

export function assignLanes(heroes: AssignInput[]): Map<number, Assignment> {
  const out = new Map<number, Assignment>();
  const count = [0, 0, 0];
  for (const h of heroes) {
    if (h.fixedLane !== undefined) {
      out.set(h.id, { lane: h.fixedLane, roam: false });
      count[h.fixedLane]++;
    }
  }
  const free = heroes.filter((h) => h.fixedLane === undefined);
  const pref = (r: Role): LaneId[] => (r === 'fighter' ? [0, 2, 1] : [1, 0, 2]);
  // 1) ファイターは空いている端→中央
  // 2) サポーター・アタッカーは中央、空きがあれば埋める
  const order = [...free].sort((a, b) => rank(a.role) - rank(b.role));
  for (const h of order) {
    const lanes = pref(h.role);
    let lane = lanes.find((l) => count[l] === 0);
    if (lane === undefined) lane = h.role === 'fighter' ? lanes.reduce((a, b) => (count[b] < count[a] ? b : a)) : 1;
    out.set(h.id, { lane, roam: h.role === 'attacker' && count[lane] > 0 });
    count[lane]++;
  }
  // 空きレーンが残ったら、一番多いレーンから（アタッカー優先で）移す
  for (const l of [0, 1, 2] as LaneId[]) {
    if (count[l] > 0) continue;
    const from = ([0, 1, 2] as LaneId[]).reduce((a, b) => (count[b] > count[a] ? b : a));
    if (count[from] < 2) break;
    const cands = free.filter((h) => out.get(h.id)!.lane === from);
    const mover = cands.find((h) => h.role === 'attacker') ?? cands.find((h) => h.role === 'fighter') ?? cands[0];
    if (!mover) continue;
    out.set(mover.id, { lane: l, roam: false });
    count[from]--;
    count[l]++;
  }
  return out;
}

function rank(r: Role) {
  return r === 'fighter' ? 0 : r === 'support' ? 1 : 2;
}
