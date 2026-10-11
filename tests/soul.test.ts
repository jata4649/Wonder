import { describe, expect, it } from 'vitest';
import { SOUL } from '../shared/config/balance';
import { SOULS } from '../shared/config/assists';
import { damageBase } from '../shared/sim/combat';
import { spawnGiant } from '../shared/sim/giants';
import { spawnSquad } from '../shared/sim/minions';
import { World } from '../shared/sim/world';

const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * 60; i++) w.step(1 / 60);
};

describe('ソウルゲージ', () => {
  it('ゲージ差25%以内は両軍とも自然増加', () => {
    const w = new World();
    w.match.gauge = [100, 80];
    run(w, SOUL.tickSec + 0.1);
    expect(w.soul.teams[0].gauge).toBeGreaterThan(0);
    expect(w.soul.teams[1].gauge).toBeGreaterThan(0);
  });

  it('25%以上の差で優勢側は停止、劣勢側は増加量アップ（25%刻み）', () => {
    const w = new World();
    w.match.gauge = [100, 70];
    expect(w.soul.naturalGain(w, 0)).toBe(0);
    const g1 = w.soul.naturalGain(w, 1);
    expect(g1).toBeGreaterThan(SOUL.tickGain);
    w.match.gauge = [100, 45];
    expect(w.soul.naturalGain(w, 1)).toBeGreaterThan(g1);
  });

  it('拠点陥落・キャスト撤退は差に関係なく必ず加算', () => {
    const w = new World();
    w.match.gauge = [100, 40]; // team0 大幅優勢
    const before = w.soul.teams[0].gauge;
    w.soul.onBaseLost(w, 0);
    expect(w.soul.teams[0].gauge).toBeGreaterThan(before);
    const b2 = w.soul.teams[0].gauge;
    w.soul.onHeroLost(w, 0);
    expect(w.soul.teams[0].gauge).toBeGreaterThan(b2);
    // 劣勢側の方が多く増える
    const w2 = new World();
    w2.match.gauge = [100, 40];
    w2.soul.onBaseLost(w2, 1);
    expect(w2.soul.teams[1].gauge).toBeGreaterThan(w.soul.teams[0].gauge - b2 + 0);
  });

  it('半分で召喚予告、満タンで一時停止＋巨人召喚（同じソウルは1回）', () => {
    const w = new World();
    w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: [], soulId: SOULS[0].id }, 0, true, 1);
    w.soul.add(w, 0, SOUL.announceAt);
    expect(w.soul.teams[0].announced?.soul.id).toBe(SOULS[0].id);
    const t0 = w.time;
    w.soul.add(w, 0, 100);
    expect(w.giants).toHaveLength(1);
    expect(w.giants[0].soul.id).toBe(SOULS[0].id);
    expect(w.freezeT).toBeGreaterThan(0);
    w.step(1 / 60);
    expect(w.time).toBe(t0); // 停止中は時間が進まない
    expect(w.soul.teams[0].used.has(SOULS[0].id)).toBe(true);
    // 次は別のソウル
    w.soul.add(w, 0, SOUL.announceAt);
    expect(w.soul.teams[0].announced?.soul.id).not.toBe(SOULS[0].id);
  });

  it('巨人生存中はゲージが伸びにくい', () => {
    const w = new World();
    spawnGiant(w, 0, 1, SOULS[1]);
    w.soul.add(w, 0, 10);
    expect(w.soul.teams[0].gauge).toBeLessThan(10);
  });
});

describe('巨人', () => {
  it('破壊型が拠点に触れると耐久に関係なく破壊', () => {
    const w = new World();
    const g = spawnGiant(w, 0, 0, SOULS[0]);
    const target = w.frontBase(1, 0)!;
    g.y = target.y + target.r + g.r + 40;
    run(w, 2);
    expect(target.alive).toBe(false);
  });

  it('破壊型でも閉じた門の奥拠点は壊せない', () => {
    const w = new World();
    const g = spawnGiant(w, 0, 1, SOULS[0]);
    w.destroyBase(w.frontBase(1, 1)!);
    const deep = w.deepBase(1, 1)!;
    g.y = deep.y + 300;
    expect(damageBase(w, deep, 1, { team: 0, kind: 'giant' })).toBe(0);
    run(w, 5);
    expect(deep.alive).toBe(true);
  });

  it('範囲型は兵士列を薙ぎ払う', () => {
    const w = new World();
    const g = spawnGiant(w, 0, 1, SOULS[1]);
    g.y = 1800;
    const sq = spawnSquad(w, 1, 1, 'castle', 9, 1, 1200, 1700);
    sq.formTimer = 0;
    const members = [...sq.members];
    run(w, 3.5);
    expect(members.filter((m) => !m.alive).length).toBeGreaterThanOrEqual(6);
  });

  it('巨人はダウンが効く（短時間・連続では効かない）', () => {
    const w = new World();
    const g = spawnGiant(w, 1, 1, SOULS[1]);
    w.applyDown(g);
    expect(g.downTimer).toBeGreaterThan(0);
    g.downTimer = 0;
    w.applyDown(g);
    expect(g.downTimer).toBe(0);
  });
});
