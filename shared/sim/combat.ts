// ダメージ処理の一元化。
import type { Team } from '../config/types';
import { isGateProtected, type Base } from './bases';
import type { Minion, Mob } from './units/types';
import type { World } from './world';

export interface DamageSource {
  team: Team;
  kind: 'minion' | 'hero' | 'giant' | 'ram' | 'skill';
  heroId?: number;
}

export interface HitOpts {
  down?: boolean;
  /** 経験値を落とさない（体当たり消滅など） */
  noXp?: boolean;
  /** 表示用のヒット種別 */
  fx?: 'ds' | 'ss' | 'lob' | 'bolt' | 'skill' | 'giant';
}

/** 無敵判定（整列中の兵士・回避中のキャストなど）。 */
export function isInvulnerable(world: World, m: Mob): boolean {
  if (!m.alive) return true;
  if (m.kind === 'minion') return (m as Minion).squad.formTimer > 0 && !(m as Minion).ramming;
  return world.mobInvulnerable(m);
}

/** 動くユニットへのダメージ。実際に与えた量を返す。 */
export function damageMob(world: World, target: Mob, amount: number, src: DamageSource, opts: HitOpts = {}): number {
  if (isInvulnerable(world, target) || target.team === src.team) return 0;
  amount = world.modifyIncomingDamage(target, amount, src);
  if (amount <= 0) return 0;
  const dealt = Math.min(target.hp, amount);
  target.hp -= amount;
  target.hitFlash = 0.12;
  if (target.kind === 'minion') (target as Minion).lastHitTeam = src.team;
  world.onMobDamaged(target, dealt, src, opts);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    world.onMobKilled(target, src, opts);
  } else if (opts.down) {
    world.applyDown(target);
  }
  return dealt;
}

/** 拠点・城へのダメージ。門が閉じている間は一切通らない。 */
export function damageBase(world: World, base: Base, amount: number, src: DamageSource): number {
  if (!base.alive || base.team === src.team) return 0;
  if (isGateProtected(base)) return 0;
  const dealt = base.tier === 'castle' ? amount : Math.min(base.hp, amount);
  if (base.tier !== 'castle') base.hp -= amount;
  base.hitFlash = 0.1;
  world.onBaseDamaged(base, dealt, src);
  if (base.tier !== 'castle' && base.hp <= 0) world.destroyBase(base, src);
  return dealt;
}
