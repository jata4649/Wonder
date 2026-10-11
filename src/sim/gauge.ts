// チームゲージと勝敗。
// 減少量の序列： 敵拠点の破壊 ＞ 敵城・敵拠点へのダメージ ＞ 敵キャストの撃破
import { CASTLE_GAUGE_PER_DMG, GAUGE, MATCH } from '../config/balance';
import type { Team } from '../config/types';
import type { Base } from './bases';

export type MatchResult = { winner: Team | 'draw'; reason: 'gauge' | 'time' };

export class MatchState {
  gauge: [number, number] = [MATCH.teamGaugeMax, MATCH.teamGaugeMax];
  timeLeft = MATCH.durationSec;
  result: MatchResult | null = null;
  /** 統計（リザルト用） */
  stats = {
    baseDestroyed: [0, 0] as [number, number],
    heroKills: [0, 0] as [number, number],
    gaugeFrom: [
      { base: 0, damage: 0, kill: 0 },
      { base: 0, damage: 0, kill: 0 },
    ],
  };

  /** team のゲージを減らす。cause は「与えた側」の統計に記録。 */
  reduce(team: Team, amount: number, cause: 'base' | 'damage' | 'kill') {
    if (this.result || amount <= 0) return;
    this.gauge[team] = Math.max(0, this.gauge[team] - amount);
    this.stats.gaugeFrom[1 - team][cause] += amount;
    if (this.gauge[team] <= 0) this.result = { winner: (1 - team) as Team, reason: 'gauge' };
  }

  onBaseDamaged(b: Base, dealt: number) {
    if (b.tier === 'castle') this.reduce(b.team, dealt * CASTLE_GAUGE_PER_DMG, 'damage');
    else this.reduce(b.team, (dealt / b.maxHp) * b.def.gaugeOnFullDamage, 'damage');
  }

  onBaseDestroyed(b: Base) {
    this.stats.baseDestroyed[1 - b.team]++;
    this.reduce(b.team, b.def.gaugeDamage, 'base');
  }

  onHeroKilled(team: Team) {
    this.stats.heroKills[1 - team]++;
    this.reduce(team, GAUGE.heroKill, 'kill');
  }

  tick(dt: number) {
    if (this.result) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      const [a, b] = this.gauge;
      const eps = 1e-6;
      this.result = { winner: Math.abs(a - b) < eps ? 'draw' : a > b ? 0 : 1, reason: 'time' };
    }
  }

  /** 時間切れ判定で使う、ゲージの比較（a が b に何%差をつけているか）。 */
  diffPercent(team: Team) {
    return ((this.gauge[team] - this.gauge[1 - team]) / MATCH.teamGaugeMax) * 100;
  }
}
