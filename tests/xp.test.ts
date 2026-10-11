import { describe, expect, it } from 'vitest';
import { MINION, XP } from '../src/config/balance';
import { damageMob } from '../src/sim/combat';
import { spawnSquad } from '../src/sim/minions';
import { World } from '../src/sim/world';

const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * 60; i++) w.step(1 / 60);
};
const lo = (id: string) => ({ casterId: id, skillIds: [], assistIds: [], soulId: '' });

describe('経験値とチームレベル', () => {
  it('兵士を倒すと経験値アイテムが落ち、ドロー射程内で回収、チーム共有', () => {
    const w = new World();
    const a = w.addHero(lo('akazukin'), 0, true, 0);
    const b = w.addHero(lo('tetsukagi'), 0, false, 2);
    a.x = 1200;
    a.y = 2000;
    b.x = 600; // 遠くの味方
    b.y = 3000;
    const sq = spawnSquad(w, 1, 1, 'castle', 3, 0, 1200, 1700);
    sq.formTimer = 0;
    const m = sq.members[0];
    damageMob(w, m, 9999, { team: 0, kind: 'hero', heroId: a.id });
    expect(w.orbs).toHaveLength(1);
    expect(w.orbs[0].team).toBe(0);
    run(w, 1.5);
    expect(w.orbs).toHaveLength(0);
    expect(w.progress[0].xp).toBe(MINION.small.xp);
    // 遠くの味方も同じチームレベル
    expect(b.level).toBe(a.level);
  });

  it('回収されない経験値は約15秒で消滅', () => {
    const w = new World();
    const sq = spawnSquad(w, 1, 1, 'castle', 3, 0, 1200, 1700);
    sq.formTimer = 0;
    damageMob(w, sq.members[0], 9999, { team: 0, kind: 'minion' });
    const id = w.orbs[0].id;
    run(w, XP.orbLifeSec - 1);
    expect(w.orbs.some((o) => o.id === id)).toBe(true);
    run(w, 1.5);
    expect(w.orbs.some((o) => o.id === id)).toBe(false);
  });

  it('体当たりで消えた兵士からは経験値が出ない', () => {
    const w = new World();
    const target = w.frontBase(1, 0)!;
    spawnSquad(w, 0, 0, 'castle', 4, 1, target.x, target.y + 300);
    run(w, 6);
    expect(w.orbs.filter((o) => o.team === 1)).toHaveLength(0);
    expect(w.orbs.filter((o) => o.team === 0)).toHaveLength(0);
  });

  it('レベルアップでスキルが解禁される', () => {
    const w = new World();
    const h = w.addHero(lo('akazukin'), 0, true, 0);
    expect(h.level).toBe(1);
    w.addTeamXp(0, XP.levelThresholds[2]);
    expect(h.level).toBe(3);
  });
});
