// 兵士（小兵士・大兵士）の生成・隊列・行動優先度。
// 行動優先度（グループ単位）：①城・拠点へ突撃 ②整列 ③攻撃 ④前進
import { MINION } from '../config/balance';
import { CASTLE_POS, LANE_IDS, LANE_X, forwardSign, laneMouth } from '../config/map';
import type { LaneId, Team } from '../config/types';
import { isGateProtected, type Base } from './bases';
import { damageBase, isInvulnerable } from './combat';
import { dist2 } from './geom';
import type { Minion, Mob, Squad, SquadSource } from './units/types';
import type { World } from './world';

/** 兵士隊列の目標（敵の次の建物）。 */
export type Objective =
  | { kind: 'base'; base: Base }
  | { kind: 'gate'; base: Base; stopY: number }
  | { kind: 'castle'; base: Base };

export function laneObjective(world: World, team: Team, lane: LaneId): Objective {
  const enemy = (1 - team) as Team;
  const front = world.frontBase(enemy, lane);
  if (front?.alive) return { kind: 'base', base: front };
  const deep = world.deepBase(enemy, lane);
  if (deep?.alive) {
    if (isGateProtected(deep)) return { kind: 'gate', base: deep, stopY: deep.gate!.y - forwardSign(team) * 70 };
    return { kind: 'base', base: deep };
  }
  return { kind: 'castle', base: world.castle(enemy) };
}

/** 城前の広場で横移動する高さ。 */
function plazaY(team: Team) {
  return CASTLE_POS[(1 - team) as Team].y - forwardSign(team) * 140;
}

export function spawnSquad(world: World, team: Team, lane: LaneId, source: SquadSource, count: number, bigCount: number, x: number, y: number): Squad {
  const sq: Squad = {
    id: world.nextId(),
    team,
    lane,
    source,
    members: [],
    ax: x,
    ay: y,
    formTimer: MINION.formSec,
    state: 'form',
    speed: MINION.small.speed,
  };
  const fwd = forwardSign(team);
  for (let i = 0; i < count; i++) {
    const big = i < bigCount; // 大兵士は先頭中央
    const st = big ? MINION.big : MINION.small;
    const off = slotOffset(i, fwd);
    const m: Minion = {
      id: world.nextId(),
      kind: 'minion',
      team,
      x: x + off.x + world.rng.range(-30, 30),
      y: y + off.y - fwd * world.rng.range(20, 60),
      r: st.radius,
      hp: st.hp,
      maxHp: st.hp,
      alive: true,
      downTimer: 0,
      pierceResist: big ? MINION.pierceResistBig : 0,
      hitFlash: 0,
      revealTimer: 0,
      big,
      squad: sq,
      slot: i,
      atkTimer: world.rng.range(0, MINION.attackInterval),
      ramming: false,
      speed: st.speed,
      atk: st.atk,
      ramDamage: st.ramDamage,
      xp: st.xp,
      lastHitTeam: -1,
    };
    sq.members.push(m);
    world.minions.push(m);
    if (big) sq.speed = Math.min(sq.speed, st.speed);
  }
  world.squads.push(sq);
  return sq;
}

/** 隊列内の位置。3列で並ぶ。slot0 が先頭中央。 */
export function slotOffset(i: number, fwd: number) {
  const row = Math.floor(i / 3);
  const colOrder = [0, -1, 1];
  const col = colOrder[i % 3];
  return { x: col * MINION.spacing * 1.25, y: -fwd * row * MINION.spacing };
}

/** 生成タイマー（城・手前拠点・奥拠点）。 */
export function updateSpawns(world: World, dt: number) {
  const W = MINION;
  for (const team of [0, 1] as Team[]) {
    const ts = world.spawnTimers[team];
    ts.castle -= dt;
    if (ts.castle <= 0) {
      ts.castle += W.castleWave.intervalSec;
      for (const lane of LANE_IDS) {
        const p = laneMouth(team, lane);
        spawnSquad(world, team, lane, 'castle', W.castleWave.count, W.castleWave.big, p.x, p.y);
      }
    }
  }
  for (const b of world.bases) {
    if (!b.alive || b.tier === 'castle' || b.lane === -1) continue;
    if (b.tier === 'deep' && isGateProtected(b)) continue;
    b.spawnTimer -= dt;
    if (b.spawnTimer <= 0) {
      const first = b.spawnCount === 0;
      let count: number;
      if (b.tier === 'front') {
        count = first ? W.frontWave.firstCount : W.frontWave.count;
      } else {
        count = first ? W.deepWave.countOnOpen : W.deepWave.count;
      }
      b.spawnTimer = b.tier === 'front' ? (first ? W.frontWave.offsetSec : W.frontWave.intervalSec) : W.deepWave.intervalSec;
      b.spawnCount++;
      const fwd = forwardSign(b.team);
      // 開始時8体は4体×2隊
      const groups = b.tier === 'front' && first ? 2 : 1;
      for (let g = 0; g < groups; g++) {
        spawnSquad(world, b.team, b.lane as LaneId, b.tier, count / groups, 0, b.x, b.y + fwd * (b.r + 50 + g * 110));
      }
    }
  }
}

/** 敵として認識できるか。 */
function canTarget(world: World, team: Team, m: Mob): boolean {
  return m.alive && m.team !== team && !isInvulnerable(world, m) && world.isVisibleTo(m, team);
}

export function updateSquads(world: World, dt: number) {
  for (const sq of world.squads) {
    sq.members = sq.members.filter((m) => m.alive);
    if (sq.members.length === 0) continue;
    updateSquad(world, sq, dt);
  }
  world.squads = world.squads.filter((s) => s.members.length > 0);
}

function updateSquad(world: World, sq: Squad, dt: number) {
  const fwd = forwardSign(sq.team);
  const obj = laneObjective(world, sq.team, sq.lane);
  const target = obj.base;
  // ① 突撃：建物が射程に入り、かつダメージが通る状態なら
  const ramDist = MINION.ramRange + target.r;
  const canRam = obj.kind !== 'gate' && target.alive && dist2(sq.ax, sq.ay, target.x, target.y) < ramDist * ramDist;
  if (sq.formTimer > 0) sq.formTimer -= dt;

  if (canRam && sq.formTimer <= 0) {
    sq.state = 'ram';
    for (const m of sq.members) ramMember(world, m, target, dt);
    return;
  }
  for (const m of sq.members) m.ramming = false;

  // ② 整列
  if (sq.formTimer > 0) {
    sq.state = 'form';
    moveMembersToSlots(world, sq, dt, 1.4);
    return;
  }

  // ③ 攻撃：認識範囲の最前列グループ（キャスト＞巨人＞兵士）
  let anyInRange = false;
  let anyRecognized = false;
  const frontSquad = nearestEnemySquad(world, sq);
  for (const m of sq.members) {
    if (m.downTimer > 0) continue;
    const t = pickTarget(world, m, frontSquad);
    if (!t) continue;
    anyRecognized = true;
    const d2 = dist2(m.x, m.y, t.x, t.y);
    const ar = MINION.attackRange + t.r;
    if (d2 < ar * ar) {
      anyInRange = true;
      m.atkTimer -= dt;
      if (m.atkTimer <= 0) {
        m.atkTimer = MINION.attackInterval * world.rng.range(0.85, 1.15);
        world.spawnBolt(m, t, m.atk);
      }
    }
  }
  if (anyInRange) {
    sq.state = 'fight';
    moveMembersToSlots(world, sq, dt, 1);
    return;
  }

  // ④ 前進
  sq.state = obj.kind === 'gate' ? 'wait' : 'advance';
  const sp = sq.speed * (anyRecognized ? 0.8 : 1) * dt;
  let tx = LANE_X[sq.lane];
  let ty: number;
  if (obj.kind === 'gate') ty = obj.stopY;
  else if (obj.kind === 'base') ty = target.y;
  else {
    // 城へ：レーンを抜けて広場で横移動
    const py = plazaY(sq.team);
    if ((sq.ay - py) * fwd < -1) {
      ty = py;
    } else {
      tx = target.x;
      ty = target.y;
    }
  }
  const dx = tx - sq.ax;
  const dy = ty - sq.ay;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    const k = Math.min(1, sp / d);
    sq.ax += dx * k;
    sq.ay += dy * k;
  }
  moveMembersToSlots(world, sq, dt, 1.35);
}

function nearestEnemySquad(world: World, sq: Squad): Squad | undefined {
  let best: Squad | undefined;
  let bd = (MINION.recognizeRange + 80) ** 2;
  world.grid.query(sq.ax, sq.ay, MINION.recognizeRange + 80, (u) => {
    if (u.kind !== 'minion' || !canTarget(world, sq.team, u)) return;
    const d = dist2(u.x, u.y, sq.ax, sq.ay);
    if (d < bd) {
      bd = d;
      best = (u as Minion).squad;
    }
  });
  return best;
}

function pickTarget(world: World, m: Minion, frontSquad: Squad | undefined): Mob | undefined {
  let hero: Mob | undefined;
  let giant: Mob | undefined;
  let minion: Mob | undefined;
  let dh = Infinity;
  let dg = Infinity;
  let dm = Infinity;
  world.grid.query(m.x, m.y, MINION.recognizeRange, (u) => {
    if (!canTarget(world, m.team, u)) return;
    const d = dist2(u.x, u.y, m.x, m.y);
    if (u.kind === 'hero' && d < dh) {
      dh = d;
      hero = u;
    } else if (u.kind === 'giant' && d < dg) {
      dg = d;
      giant = u;
    } else if (u.kind === 'minion' && (u as Minion).squad === frontSquad && d < dm) {
      dm = d;
      minion = u;
    }
  });
  return hero ?? giant ?? minion;
}

function moveMembersToSlots(world: World, sq: Squad, dt: number, speedMult: number) {
  const fwd = forwardSign(sq.team);
  for (const m of sq.members) {
    if (m.downTimer > 0) continue;
    const off = slotOffset(m.slot, fwd);
    const tx = sq.ax + off.x;
    const ty = sq.ay + off.y;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.5) {
      const step = Math.min(d, m.speed * speedMult * dt);
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
    }
  }
}

/** 体当たり：建物に触れたら大打撃を与えて自身は消滅（経験値なし）。 */
function ramMember(world: World, m: Minion, target: Base, dt: number) {
  if (m.downTimer > 0) return;
  m.ramming = true;
  const dx = target.x - m.x;
  const dy = target.y - m.y;
  const d = Math.hypot(dx, dy);
  if (d <= target.r + m.r) {
    damageBase(world, target, m.ramDamage, { team: m.team, kind: 'ram' });
    m.alive = false;
    m.hp = 0;
    world.onMinionRammed(m, target);
    return;
  }
  const step = Math.min(d, MINION.ramSpeed * dt);
  m.x += (dx / d) * step;
  m.y += (dy / d) * step;
}
