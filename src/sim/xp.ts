// 経験値アイテムとチームレベル（経験値はチーム共有）。
import { XP } from '../config/balance';
import type { Team } from '../config/types';
import type { World } from './world';

export interface XpOrb {
  id: number;
  team: Team; // 回収できるチーム（倒した側）
  x: number;
  y: number;
  value: number;
  t: number; // 残り秒数
  alive: boolean;
  magnet: number; // 引き寄せ中のキャストID（-1=なし）
}

export class TeamProgress {
  xp = 0;
  level = 1;

  add(v: number): number {
    this.xp += v;
    const before = this.level;
    while (this.level < XP.maxLevel && this.xp >= XP.levelThresholds[this.level]) this.level++;
    return this.level - before;
  }

  /** 次のレベルまでの進捗 0..1 */
  progress(): number {
    if (this.level >= XP.maxLevel) return 1;
    const a = XP.levelThresholds[this.level - 1];
    const b = XP.levelThresholds[this.level];
    return (this.xp - a) / (b - a);
  }
}

export function dropOrb(world: World, team: Team, x: number, y: number, value: number) {
  world.orbs.push({
    id: world.nextId(),
    team,
    x: x + world.rng.range(-12, 12),
    y: y + world.rng.range(-12, 12),
    value,
    t: XP.orbLifeSec,
    alive: true,
    magnet: -1,
  });
}

/** ドローショット射程程度まで近づくと回収（引き寄せ）。約15秒で消滅。 */
export function updateOrbs(world: World, dt: number) {
  for (const o of world.orbs) {
    o.t -= dt;
    if (o.t <= 0) {
      o.alive = false;
      continue;
    }
    let target = o.magnet >= 0 ? world.heroes.find((h) => h.id === o.magnet && h.alive) : undefined;
    if (!target) {
      o.magnet = -1;
      let best = Infinity;
      for (const h of world.heroes) {
        if (!h.alive || h.team !== o.team) continue;
        const r = h.stat('xpRange');
        const d = (h.x - o.x) ** 2 + (h.y - o.y) ** 2;
        if (d < r * r && d < best) {
          best = d;
          target = h;
        }
      }
      if (target) o.magnet = target.id;
    }
    if (target) {
      const dx = target.x - o.x;
      const dy = target.y - o.y;
      const d = Math.hypot(dx, dy);
      const step = XP.pickupMagnetSpeed * dt;
      if (d <= step + target.r) {
        o.alive = false;
        world.addTeamXp(o.team, o.value);
      } else {
        o.x += (dx / d) * step;
        o.y += (dy / d) * step;
      }
    }
  }
  world.orbs = world.orbs.filter((o) => o.alive);
}
