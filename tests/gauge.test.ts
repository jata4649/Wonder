import { describe, expect, it } from 'vitest';
import { BASES, GAUGE, MATCH } from '../src/config/balance';
import { damageBase } from '../src/sim/combat';
import { World } from '../src/sim/world';

describe('チームゲージと勝敗', () => {
  it('序列：拠点破壊 > 拠点への（全耐久分の）ダメージ > キャスト撃破', () => {
    const n = BASES.normal;
    expect(n.gaugeDamage).toBeGreaterThan(n.gaugeOnFullDamage);
    expect(n.gaugeOnFullDamage).toBeGreaterThan(GAUGE.heroKill);
    // 小≈0.6倍、特大≈2.2倍
    expect(BASES.small.gaugeDamage / n.gaugeDamage).toBeCloseTo(0.6, 1);
    expect(BASES.huge.gaugeDamage / n.gaugeDamage).toBeCloseTo(2.2, 1);
  });

  it('拠点破壊でゲージが減る', () => {
    const w = new World();
    const b = w.frontBase(1, 0)!;
    damageBase(w, b, b.maxHp + 10, { team: 0, kind: 'hero' });
    expect(b.alive).toBe(false);
    expect(w.match.gauge[1]).toBeCloseTo(MATCH.teamGaugeMax - BASES.normal.gaugeDamage - BASES.normal.gaugeOnFullDamage, 5);
  });

  it('門が閉じている奥拠点にはダメージが通らない', () => {
    const w = new World();
    const deep = w.deepBase(1, 1)!;
    expect(damageBase(w, deep, 500, { team: 0, kind: 'hero' })).toBe(0);
    expect(w.match.gauge[1]).toBe(MATCH.teamGaugeMax);
  });

  it('城へのダメージでゲージが減る', () => {
    const w = new World();
    damageBase(w, w.castle(1), 1000, { team: 0, kind: 'ram' });
    expect(w.match.gauge[1]).toBeLessThan(MATCH.teamGaugeMax);
  });

  it('ゲージ0で勝利', () => {
    const w = new World();
    w.match.reduce(1, 1000, 'damage');
    expect(w.match.result).toEqual({ winner: 0, reason: 'gauge' });
  });

  it('時間切れは残量の多い方が勝ち、同値は引き分け', () => {
    const w = new World();
    w.match.timeLeft = 0.01;
    w.match.gauge = [50, 60];
    w.step(1 / 60);
    expect(w.match.result).toEqual({ winner: 1, reason: 'time' });
    const w2 = new World();
    w2.match.timeLeft = 0.01;
    w2.step(1 / 60);
    expect(w2.match.result?.winner).toBe('draw');
  });
});
