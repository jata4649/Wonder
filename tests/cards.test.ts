import { describe, expect, it } from 'vitest';
import { ASSISTS, SOULS } from '../shared/config/assists';
import { CASTERS } from '../shared/config/casters';
import { EFFECT_IDS, wonderReady } from '../shared/sim/effects';
import { World, assistActive } from '../shared/sim/world';

const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * 60; i++) w.step(1 / 60);
};

describe('カード', () => {
  it('全キャストがスキル5つ・WS1つを持ち、効果IDが実装済み', () => {
    for (const c of CASTERS) {
      expect(c.skills).toHaveLength(5);
      for (const s of [...c.skills, c.wonderSkill]) expect(EFFECT_IDS).toContain(s.effect);
      expect(c.wonderSkill.mpCost).toBe(0);
    }
  });

  it('スキルは3つ装備、MP消費とクールダウン', () => {
    const w = new World();
    const c = CASTERS[0];
    const h = w.addHero({ casterId: c.id, skillIds: [c.skills[0].id, c.skills[1].id, c.skills[4].id], assistIds: [], soulId: '' }, 0, true, 1);
    expect(h.skills.map((s) => s.id)).toEqual([c.skills[0].id, c.skills[1].id, c.skills[4].id]);
    h.x = 1200;
    h.y = 2000;
    const mp0 = h.mp;
    h.cmds.push({ t: 'skill', slot: 0, x: 1200, y: 1800 });
    w.step(1 / 60);
    expect(h.mp).toBeLessThan(mp0 - c.skills[0].mpCost + 1);
    expect(h.skillCd[0]).toBeGreaterThan(0);
    // 必要レベル未満は使えない
    const mp1 = h.mp;
    h.cmds.push({ t: 'skill', slot: 2, x: 1200, y: 1800 });
    run(w, 0.5);
    expect(h.skillCd[2]).toBe(0);
    expect(h.mp).toBeGreaterThanOrEqual(mp1);
  });

  it('ワンダースキルは1試合1回・MP0（Lv5で解禁）', () => {
    const w = new World();
    const h = w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: [], soulId: '' }, 0, true, 1);
    expect(wonderReady(h)).toBe(false);
    w.teamLevel = () => 5;
    expect(wonderReady(h)).toBe(true);
    const mp0 = h.mp;
    h.cmds.push({ t: 'ws', x: h.x, y: h.y - 100 });
    w.step(1 / 60);
    expect(h.wsUsed).toBe(true);
    expect(h.mp).toBeGreaterThanOrEqual(mp0);
    expect(wonderReady(h)).toBe(false);
  });

  it('アシストはチームレベル到達で発動、4枠目はLv6以上', () => {
    expect(assistActive(1, 0, 1)).toBe(true);
    expect(assistActive(4, 0, 3)).toBe(false);
    expect(assistActive(1, 3, 5)).toBe(false);
    expect(assistActive(1, 3, 6)).toBe(true);
    const w = new World();
    const hp = ASSISTS.find((a) => a.id === 'as_leather')!;
    const h = w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: ['as_iron', hp.id], soulId: SOULS[0].id }, 0, true, 1);
    const base = h.stat('maxHp');
    w.teamLevel = () => 4;
    expect(h.stat('maxHp')).toBeGreaterThan(base + 100);
  });
});
