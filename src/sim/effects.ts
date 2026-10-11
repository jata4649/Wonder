// スキル効果の実装。SkillDef.effect の関数IDと対応する。
import { HERO, SKILL_COMMON, XP } from '../config/balance';
import type { SkillDef } from '../config/types';
import { damageMob } from './combat';
import { pushOutOfRect, type Vec } from './geom';
import { buildProfile, makeDrawProjectile, type DSOwner } from './projectiles/drawshot';
import { clampToCircle, type Hero } from './units/hero';
import type { Mob } from './units/types';
import type { World } from './world';

type EffectFn = (w: World, h: Hero, p: Record<string, number>, target: Vec) => void;

const powerMult = (h: Hero) => 1 + HERO.levelAtkPerLv * (h.level - 1);

function alliesInRadius(w: World, h: Hero, radius: number): Hero[] {
  if (!radius) return [h];
  return w.heroes.filter((o) => o.alive && o.team === h.team && Math.hypot(o.x - h.x, o.y - h.y) <= radius);
}

function enemiesIn(w: World, h: Hero, x: number, y: number, r: number, cb: (m: Mob) => void) {
  w.grid.query(x, y, r, (m) => {
    if (m.team !== h.team && m.alive) cb(m);
  });
}

const EFFECTS: Record<string, EffectFn> = {
  nova(w, h, p) {
    enemiesIn(w, h, h.x, h.y, p.radius, (m) => damageMob(w, m, p.power * powerMult(h), h.src(), { down: !!p.down, fx: 'skill' }));
    w.emit({ type: 'blast', x: h.x, y: h.y, r: p.radius, team: h.team });
  },
  bolt(w, h, p, t) {
    const dx = t.x - h.x;
    const dy = t.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    const pts = [
      { x: h.x, y: h.y },
      { x: h.x + (dx / d) * p.range, y: h.y + (dy / d) * p.range },
    ];
    const owner: DSOwner = { id: h.id, team: h.team, onDrawHit() {}, onDrawEnd() {} };
    const def = { ...h.def.draw, type: 'curve' as const, decay: [1], pierceDecay: false, down: !!p.down, maxHits: 0, coreMult: 1 };
    const prof = buildProfile(pts, { baseSpeed: p.speed, speedUpStraight: 1, speedDownSharp: 1 });
    w.drawShots.push(
      makeDrawProjectile(w, owner, prof, def, {
        power: p.power * powerMult(h),
        width: p.width,
        piercePower: 99,
        speedMult: 1,
        crossed: false,
        color: '#ffffff',
      }),
    );
  },
  dash(w, h, p, t) {
    h.dash(t.x - h.x, t.y - h.y, p.distance, 0.1);
    void w;
  },
  blink(w, h, p, t) {
    const dest = clampToCircle(t, h.x, h.y, p.range);
    for (const wall of w.activeWalls()) pushOutOfRect(dest, h.r, wall);
    w.emit({ type: 'blast', x: h.x, y: h.y, r: 60, team: h.team });
    h.x = dest.x;
    h.y = dest.y;
    h.collide();
    w.emit({ type: 'blast', x: h.x, y: h.y, r: 60, team: h.team });
  },
  heal(w, h, p) {
    for (const a of alliesInRadius(w, h, p.radius)) {
      const amt = a.maxHp * p.amount;
      a.hp = Math.min(a.maxHp, a.hp + amt);
      w.emit({ type: 'heal', x: a.x, y: a.y, amount: amt, team: a.team });
    }
  },
  haste(w, h, p) {
    for (const a of alliesInRadius(w, h, p.radius ?? 0)) w.addBuff(a, { kind: 'haste', value: p.mult, t: p.dur });
  },
  guard(w, h, p) {
    for (const a of alliesInRadius(w, h, p.radius ?? 0)) w.addBuff(a, { kind: 'guard', value: p.mult, t: p.dur });
  },
  empower(w, h, p) {
    w.addBuff(h, { kind: 'empower', value: p.mult, t: p.dur });
  },
  pierceUp(w, h, p) {
    w.addBuff(h, { kind: 'pierceUp', value: p.amount, t: p.dur });
  },
  mpBurst(w, h, p) {
    for (const a of alliesInRadius(w, h, p.radius ?? 0)) a.mp = Math.min(a.stat('maxMp'), a.mp + p.amount);
  },
  slow(w, h, p) {
    enemiesIn(w, h, h.x, h.y, p.radius, (m) => {
      if (p.power) damageMob(w, m, p.power * powerMult(h), h.src(), { fx: 'skill' });
      if (m.kind === 'hero') w.addBuff(m as Hero, { kind: 'slow', value: p.mult, t: p.dur });
      else w.slowMob(m, p.mult, p.dur);
    });
    w.emit({ type: 'blast', x: h.x, y: h.y, r: p.radius, team: h.team });
  },
  stun(w, h, p, t) {
    const c = clampToCircle(t, h.x, h.y, p.range);
    enemiesIn(w, h, c.x, c.y, p.radius, (m) => damageMob(w, m, p.power * powerMult(h), h.src(), { down: true, fx: 'skill' }));
    w.emit({ type: 'blast', x: c.x, y: c.y, r: p.radius, team: h.team });
  },
};

export function skillUnlocked(h: Hero, s: SkillDef): boolean {
  return h.level >= s.requiredLevel;
}

/** スキルの使用可否（UI/AI 用）。 */
export function skillReady(h: Hero, slot: number): { ok: boolean; reason?: string } {
  const s = h.skills[slot];
  if (!s) return { ok: false, reason: 'none' };
  if (!skillUnlocked(h, s)) return { ok: false, reason: `Lv${s.requiredLevel}` };
  if (h.skillCd[slot] > 0) return { ok: false, reason: 'cd' };
  if (h.mp < s.mpCost) return { ok: false, reason: 'mp' };
  return { ok: true };
}

export function wonderReady(h: Hero): boolean {
  return !h.wsUsed && h.level >= XP.wonderSkillLevel;
}

export function castSkill(w: World, h: Hero, slot: number, x: number, y: number) {
  const s = h.skills[slot];
  if (!s || h.gcd > 0) return;
  const r = skillReady(h, slot);
  if (!r.ok) {
    if (r.reason === 'mp') h.say('MP不足');
    return;
  }
  h.mp -= s.mpCost;
  h.skillCd[slot] = s.cooldown;
  h.gcd = SKILL_COMMON.globalCooldown;
  runEffect(w, h, s, { x, y });
}

/** ワンダースキル：1試合1回・MP0。 */
export function castWonder(w: World, h: Hero, x: number, y: number) {
  if (!wonderReady(h)) return;
  h.wsUsed = true;
  h.gcd = SKILL_COMMON.globalCooldown;
  w.emit({ type: 'wonder', hero: h });
  runEffect(w, h, h.def.wonderSkill, { x, y });
}

function runEffect(w: World, h: Hero, s: SkillDef, t: Vec) {
  const fn = EFFECTS[s.effect];
  if (!fn) throw new Error(`unknown skill effect: ${s.effect}`);
  fn(w, h, s.params, t);
  h.revealTimer = 1;
  w.emit({ type: 'skill', hero: h, skill: s });
}

export const EFFECT_IDS = Object.keys(EFFECTS);
