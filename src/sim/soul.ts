// ソウルゲージ：劣勢になるほど溜まる。満タンで巨人召喚（劣勢側の逆転装置）。
// - ゲージ差25%以内：両軍とも約6.5秒ごとに自然増加
// - 25%以上差：優勢側は自然増加停止、劣勢側は増加量アップ（25%刻みでさらに増加）
// - 拠点陥落・キャスト撤退時は差に関係なく必ず増加（増加量は有利不利で変動）
// - 半分で次のソウルを予告、満タンで一瞬停止＋ランダムレーンに巨人召喚。同じソウルは1試合1回。
import { MATCH, SOUL } from '../config/balance';
import { SOULS, SOUL_BY_ID } from '../config/assists';
import { LANE_IDS } from '../config/map';
import type { LaneId, SoulDef, Team } from '../config/types';
import type { World } from './world';

export interface SoulTeam {
  gauge: number;
  announced: { soul: SoulDef; lane: LaneId } | null;
  used: Set<string>;
}

export class SoulSystem {
  teams: [SoulTeam, SoulTeam] = [
    { gauge: 0, announced: null, used: new Set() },
    { gauge: 0, announced: null, used: new Set() },
  ];
  private tick = SOUL.tickSec;

  /** team から見たゲージ差（%）。正なら優勢。 */
  diff(world: World, team: Team) {
    const g = world.match.gauge;
    return ((g[team] - g[1 - team]) / MATCH.teamGaugeMax) * 100;
  }

  /** 自然増加量。 */
  naturalGain(world: World, team: Team): number {
    const d = this.diff(world, team);
    if (Math.abs(d) < SOUL.diffStep) return SOUL.tickGain;
    if (d > 0) return 0; // 優勢側は停止
    const steps = Math.floor(Math.abs(d) / SOUL.diffStep);
    return SOUL.tickGain * (1 + SOUL.trailerBonusPerStep * steps);
  }

  /** イベント（拠点陥落・キャスト撤退）による増加倍率。必ず正。 */
  eventMult(world: World, team: Team): number {
    const d = this.diff(world, team);
    if (Math.abs(d) < SOUL.diffStep) return 1;
    if (d > 0) return SOUL.leaderEventMult;
    return 1 + SOUL.trailerBonusPerStep * Math.floor(Math.abs(d) / SOUL.diffStep);
  }

  private giantMult(world: World, team: Team) {
    return world.giants.some((g) => g.team === team && g.alive) ? SOUL.giantAliveMult : 1;
  }

  add(world: World, team: Team, amount: number) {
    const t = this.teams[team];
    t.gauge = Math.min(SOUL.max, t.gauge + amount * this.giantMult(world, team));
    this.check(world, team);
  }

  onBaseLost(world: World, team: Team) {
    this.add(world, team, SOUL.eventBase.baseLost * this.eventMult(world, team));
  }

  onHeroLost(world: World, team: Team) {
    this.add(world, team, SOUL.eventBase.heroLost * this.eventMult(world, team));
  }

  update(world: World, dt: number) {
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick += SOUL.tickSec;
      for (const team of [0, 1] as Team[]) this.add(world, team, this.naturalGain(world, team));
    }
  }

  private pickSoul(world: World, team: Team): SoulDef | undefined {
    const t = this.teams[team];
    const own = world.heroes
      .filter((h) => h.team === team)
      .map((h) => SOUL_BY_ID[h.loadout.soulId])
      .filter((s): s is SoulDef => !!s && !t.used.has(s.id));
    const uniq = [...new Map(own.map((s) => [s.id, s])).values()];
    if (uniq.length) return world.rng.pick(uniq);
    const rest = SOULS.filter((s) => !t.used.has(s.id));
    return rest.length ? world.rng.pick(rest) : undefined;
  }

  private check(world: World, team: Team) {
    const t = this.teams[team];
    if (!t.announced && t.gauge >= SOUL.announceAt) {
      const soul = this.pickSoul(world, team);
      if (!soul) {
        t.gauge = Math.min(t.gauge, SOUL.announceAt - 1);
        return;
      }
      t.announced = { soul, lane: world.rng.pick(LANE_IDS) };
      world.emit({ type: 'soulAnnounce', team, soul, lane: t.announced.lane });
    }
    if (t.announced && t.gauge >= SOUL.max) {
      const { soul, lane } = t.announced;
      t.used.add(soul.id);
      t.announced = null;
      t.gauge = 0;
      world.summonGiant(team, lane, soul);
    }
  }
}
