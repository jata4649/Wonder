// 兵士・巨人のホーミング弾（対キャストもホーミング）。
import { MINION } from '../../config/balance';
import type { Team } from '../../config/types';
import { damageMob, type DamageSource } from '../combat';
import type { Mob } from '../units/types';
import type { World } from '../world';

export interface Bolt {
  id: number;
  team: Team;
  x: number;
  y: number;
  target: Mob;
  damage: number;
  speed: number;
  life: number;
  alive: boolean;
  src: DamageSource;
}

export function makeBolt(id: number, from: Mob, target: Mob, damage: number, kind: DamageSource['kind'] = 'minion'): Bolt {
  return {
    id,
    team: from.team,
    x: from.x,
    y: from.y,
    target,
    damage,
    speed: MINION.boltSpeed,
    life: 2,
    alive: true,
    src: { team: from.team, kind },
  };
}

export function updateBolts(world: World, bolts: Bolt[], dt: number) {
  for (const b of bolts) {
    b.life -= dt;
    const t = b.target;
    if (!t.alive || b.life <= 0) {
      b.alive = false;
      continue;
    }
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const d = Math.hypot(dx, dy);
    const step = b.speed * dt;
    if (d <= step + t.r * 0.5) {
      damageMob(world, t, b.damage, b.src, { fx: 'bolt' });
      b.alive = false;
      continue;
    }
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;
  }
}
