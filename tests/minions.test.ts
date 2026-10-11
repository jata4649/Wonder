import { describe, expect, it } from 'vitest';
import { MINION } from '../src/config/balance';
import { isInvulnerable, damageMob } from '../src/sim/combat';
import { spawnSquad } from '../src/sim/minions';
import { World } from '../src/sim/world';

const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * 60; i++) w.step(1 / 60);
};

describe('兵士', () => {
  it('城から各レーンに大兵士1体を含む9体が出る', () => {
    const w = new World();
    run(w, MINION.castleWave.firstAt + 0.05);
    const castleSquads = w.squads.filter((s) => s.source === 'castle' && s.team === 0);
    expect(castleSquads).toHaveLength(3);
    for (const s of castleSquads) {
      expect(s.members).toHaveLength(9);
      expect(s.members.filter((m) => m.big)).toHaveLength(1);
    }
  });

  it('手前拠点は開始時8体（以降4体）', () => {
    const w = new World();
    run(w, MINION.frontWave.firstAt + 0.05);
    const front = w.squads.filter((s) => s.source === 'front' && s.team === 0);
    expect(front.reduce((a, s) => a + s.members.length, 0)).toBe(24); // 3レーン×8
  });

  it('整列中は無敵', () => {
    const w = new World();
    const sq = spawnSquad(w, 0, 1, 'castle', 9, 1, 1200, 2000);
    const m = sq.members[0];
    expect(isInvulnerable(w, m)).toBe(true);
    expect(damageMob(w, m, 999, { team: 1, kind: 'hero' })).toBe(0);
    run(w, MINION.formSec + 0.1);
    expect(isInvulnerable(w, m)).toBe(false);
  });

  it('拠点へ体当たりすると消滅しつつ大打撃を与える', () => {
    const w = new World();
    const target = w.frontBase(1, 0)!;
    const sq = spawnSquad(w, 0, 0, 'castle', 4, 1, target.x, target.y + 300);
    const ids = sq.members.map((m) => m.id);
    run(w, 6);
    expect(target.hp).toBeLessThan(target.maxHp - MINION.big.ramDamage);
    expect(w.minions.filter((m) => ids.includes(m.id))).toHaveLength(0);
  });

  it('閉じた門の前では止まり、奥拠点にダメージが通らない', () => {
    const w = new World();
    const front = w.frontBase(1, 1)!;
    w.destroyBase(front);
    const deep = w.deepBase(1, 1)!;
    spawnSquad(w, 0, 1, 'castle', 9, 1, deep.x, deep.y + 500);
    run(w, 8); // 刹那門は12秒
    expect(deep.hp).toBe(deep.maxHp);
    run(w, 10);
    expect(deep.gate!.state).toBe('open');
    expect(deep.hp).toBeLessThan(deep.maxHp);
  });

  it('5分走らせても破綻しない', () => {
    const w = new World({ seed: 3 });
    run(w, 300);
    expect(w.minions.length).toBeLessThan(600);
  });
});
