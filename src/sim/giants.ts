// 巨人の行動。
import { GIANTS, GIANT_BASE_MULT, GIANT_CASTLE_HIT, GIANT_DOWN } from '../config/giants';
import { CASTLE_POS, FRONT_Y, LANE_X, forwardSign } from '../config/map';
import type { GiantDef, LaneId, SoulDef, Team } from '../config/types';
import { damageBase, damageMob, type DamageSource } from './combat';
import { dist2 } from './geom';
import { laneObjective } from './minions';
import type { Hero } from './units/hero';
import type { Mob } from './units/types';
import type { World } from './world';

export interface Giant extends Mob {
  kind: 'giant';
  def: GiantDef;
  soul: SoulDef;
  lane: LaneId;
  atkTimer: number;
  downImmune: number;
  state: 'walk' | 'attack' | 'wait';
  swing: number; // 描画用
}

export function spawnGiant(world: World, team: Team, lane: LaneId, soul: SoulDef): Giant {
  const def = GIANTS[soul.giantType];
  const g: Giant = {
    id: world.nextId(),
    kind: 'giant',
    team,
    x: LANE_X[lane],
    y: FRONT_Y[team] + forwardSign(team) * 140,
    r: def.radius,
    hp: def.maxHp,
    maxHp: def.maxHp,
    alive: true,
    downTimer: 0,
    pierceResist: 5,
    hitFlash: 0,
    revealTimer: 0,
    slowT: 0,
    slowMult: 1,
    def,
    soul,
    lane,
    atkTimer: def.attackInterval,
    downImmune: 0,
    state: 'walk',
    swing: 0,
  };
  world.giants.push(g);
  return g;
}

export function giantApplyDown(g: Giant) {
  if (g.downImmune > 0) return;
  g.downTimer = GIANT_DOWN.sec;
  g.downImmune = GIANT_DOWN.immune;
}

export function updateGiants(world: World, dt: number) {
  for (const g of world.giants) {
    if (!g.alive) continue;
    if (g.hitFlash > 0) g.hitFlash -= dt;
    if (g.downImmune > 0) g.downImmune -= dt;
    if (g.slowT > 0) g.slowT -= dt;
    if (g.swing > 0) g.swing -= dt;
    if (g.downTimer > 0) {
      g.downTimer -= dt;
      continue;
    }
    updateGiant(world, g, dt);
  }
  world.giants = world.giants.filter((g) => g.alive);
}

function src(g: Giant): DamageSource {
  return { team: g.team, kind: 'giant' };
}

function updateGiant(world: World, g: Giant, dt: number) {
  const def = g.def;
  const obj = laneObjective(world, g.team, g.lane);
  const target = obj.base;
  const touching = obj.kind !== 'gate' && dist2(g.x, g.y, target.x, target.y) < (target.r + g.r + 6) ** 2;
  g.atkTimer -= dt;

  // 支援型：オーラで味方回復・敵を鈍足化
  if (def.healPerSec && def.auraRadius) {
    world.grid.query(g.x, g.y, def.auraRadius, (m) => {
      if (m.team === g.team) {
        if (m !== g && m.alive) m.hp = Math.min(m.maxHp, m.hp + def.healPerSec! * (m.kind === 'hero' ? 1.5 : 1) * dt);
      } else if (m.kind === 'hero') {
        world.addBuff(m as Hero, { kind: 'slow', value: 0.75, t: 0.3 });
      } else world.slowMob(m, 0.7, 0.3);
    });
  }

  if (touching) {
    g.state = 'attack';
    if (def.destroysBaseOnContact) {
      // 触れた拠点を耐久に関係なく破壊
      if (target.tier === 'castle') {
        damageBase(world, target, GIANT_CASTLE_HIT, src(g));
        g.alive = false;
        world.emit({ type: 'blast', x: g.x, y: g.y, r: 200, team: g.team });
      } else {
        damageBase(world, target, target.hp + 1, src(g));
      }
      return;
    }
    if (g.atkTimer <= 0) {
      g.atkTimer = def.attackInterval;
      g.swing = 0.3;
      damageBase(world, target, def.atk * GIANT_BASE_MULT, src(g));
    }
    return;
  }

  // 範囲型：近くに敵ユニットがいれば足を止めて薙ぎ払う
  if (def.canAttackUnits) {
    let any = false;
    world.grid.query(g.x, g.y, def.attackRange, (m) => {
      if (m.team !== g.team && m.alive && world.isVisibleTo(m, g.team)) any = true;
    });
    if (any) {
      g.state = 'attack';
      if (g.atkTimer <= 0) {
        g.atkTimer = def.attackInterval;
        g.swing = 0.35;
        world.grid.query(g.x, g.y, def.attackRange, (m) => {
          if (m.team !== g.team) damageMob(world, m, m.kind === 'minion' ? def.atk * 3 : def.atk, src(g), { down: true, fx: 'giant' });
        });
        world.emit({ type: 'blast', x: g.x, y: g.y, r: def.attackRange, team: g.team });
      }
      return;
    }
  }

  // 前進（猛突進は何も無視して一直線）
  g.state = obj.kind === 'gate' ? 'wait' : 'walk';
  const fwd = forwardSign(g.team);
  let tx = LANE_X[g.lane];
  let ty: number;
  if (obj.kind === 'gate') ty = obj.stopY - fwd * 40;
  else if (obj.kind === 'base') ty = target.y;
  else {
    const py = CASTLE_POS[(1 - g.team) as Team].y - fwd * 140;
    if ((g.y - py) * fwd < -1) ty = py;
    else {
      tx = target.x;
      ty = target.y;
    }
  }
  const dx = tx - g.x;
  const dy = ty - g.y;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    const sp = def.moveSpeed * (g.slowT > 0 ? g.slowMult : 1) * dt;
    const k = Math.min(1, sp / d);
    g.x += dx * k;
    g.y += dy * k;
  }
}
