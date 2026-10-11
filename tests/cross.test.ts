import { describe, expect, it } from 'vitest';
import { CROSS } from '../shared/config/balance';
import { CASTER_BY_ID } from '../shared/config/casters';
import { World } from '../shared/sim/world';

const lo = (id: string) => ({ casterId: id, skillIds: [], assistIds: [], soulId: '' });
const line = (x0: number, y0: number, x1: number, y1: number, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));

function setup(caster = 'akazukin') {
  const w = new World();
  const a = w.addHero(lo(caster), 0, true, 1);
  const b = w.addHero(lo('tetsukagi'), 0, false, 1);
  a.x = 1200;
  a.y = 2000;
  b.x = 1100;
  b.y = 1900;
  return { w, a, b };
}

describe('クロスドロー', () => {
  it('軌跡が約20秒残る', () => {
    const { w, b } = setup();
    b.cmds.push({ t: 'ds', pts: line(1100, 1880, 1350, 1750) });
    w.step(1 / 60);
    expect(w.trails).toHaveLength(1);
    for (let i = 0; i < 60 * (CROSS.trailLifeSec - 1); i++) w.step(1 / 60);
    expect(w.trails).toHaveLength(1);
    for (let i = 0; i < 60 * 2; i++) w.step(1 / 60);
    expect(w.trails).toHaveLength(0);
  });

  it('味方の軌跡に交わると弾サイズ・威力・弾速が強化', () => {
    const { w, a, b } = setup();
    b.cmds.push({ t: 'ds', pts: line(1080, 1850, 1450, 1850) }); // 横線
    w.step(1 / 60);
    a.cmds.push({ t: 'ds', pts: line(1200, 1980, 1200, 1700) }); // 縦線で交差
    w.step(1 / 60);
    const shot = w.drawShots.find((p) => p.owner === a)!;
    expect(shot.crossed).toBe(true);
    expect(shot.width).toBeCloseTo(CASTER_BY_ID.akazukin.draw.width * CROSS.sizeMult, 3);
    expect(shot.power).toBeGreaterThan(CASTER_BY_ID.akazukin.draw.power * 1.2);
  });

  it('自分の前回軌跡ではクロスしない（単独クロス持ち以外）', () => {
    const { w, a } = setup();
    a.cmds.push({ t: 'ds', pts: line(1150, 1960, 1500, 1850) });
    w.step(1 / 60);
    a.mp = 100;
    a.cmds.push({ t: 'ds', pts: line(1200, 1980, 1200, 1700) });
    w.step(1 / 60);
    expect(w.drawShots.filter((p) => p.owner === a).every((p) => !p.crossed)).toBe(true);
  });

  it('単独クロス持ちは自分の前回軌跡でもクロス可', () => {
    const { w, a } = setup('nemurihime');
    expect(a.def.draw.crossSolo).toBe(true);
    a.cmds.push({ t: 'ds', pts: line(1150, 1960, 1450, 1850) });
    w.step(1 / 60);
    a.mp = 100;
    a.cmds.push({ t: 'ds', pts: line(1200, 1980, 1250, 1700) });
    w.step(1 / 60);
    expect(w.drawShots.some((p) => p.owner === a && p.crossed)).toBe(true);
  });

  it('敵の軌跡ではクロスしない', () => {
    const { w, a } = setup();
    const e = w.addHero(lo('tetsukagi'), 1, false, 1);
    e.x = 1100;
    e.y = 1900;
    e.cmds.push({ t: 'ds', pts: line(1080, 1880, 1300, 1880) });
    w.step(1 / 60);
    a.cmds.push({ t: 'ds', pts: line(1200, 1980, 1200, 1700) });
    w.step(1 / 60);
    expect(w.drawShots.find((p) => p.owner === a)?.crossed).toBe(false);
  });
});
