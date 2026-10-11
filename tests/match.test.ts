import { describe, expect, it } from 'vitest';
import { setupMatch } from '../src/ai/setup';
import type { Difficulty } from '../src/config/types';
import { World } from '../src/sim/world';

export function simulateMatch(seed: number, diff: Difficulty) {
  const w = new World({ seed });
  setupMatch(w, null, diff);
  let giants = 0;
  let maxMinions = 0;
  const firstBase: number[] = [];
  let steps = 0;
  while (!w.ended && steps < 60 * 60 * 8) {
    w.step(1 / 60);
    steps++;
    if (w.minions.length > maxMinions) maxMinions = w.minions.length;
    for (const e of w.drainEvents()) {
      if (e.type === 'giantSummon') giants++;
      if (e.type === 'baseDestroyed') firstBase.push(Math.round(w.time));
    }
  }
  return {
    seed,
    diff,
    result: w.match.result,
    t: Math.round(w.time),
    gauge: w.match.gauge.map((g) => +g.toFixed(1)),
    lv: w.progress.map((p) => p.level),
    kills: w.match.stats.heroKills,
    bases: w.match.stats.baseDestroyed,
    baseTimes: firstBase,
    giants,
    maxMinions,
    from: w.match.stats.gaugeFrom.map((g) => [g.base, g.damage, g.kill].map((x) => +x.toFixed(1))),
    deaths: w.heroes.map((h) => `${h.def.name}:${h.kills}/${h.deaths}`).join(' '),
  };
}

describe('AI 4v4 フルマッチ（ヘッドレス）', () => {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    it(`${diff}: 7分で決着し、破綻しない`, () => {
      const r = simulateMatch(diff.length * 7, diff);
      console.log(JSON.stringify(r));
      expect(r.result).not.toBeNull();
      expect(r.t).toBeLessThanOrEqual(421);
      expect(r.maxMinions).toBeLessThan(500);
    }, 60000);
  }
});
