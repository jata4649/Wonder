import { describe, expect, it } from 'vitest';
import { HeroAI } from '../src/ai/heroAI';
import { assignLanes } from '../src/ai/laneAssign';
import { nextWaypoint } from '../src/ai/nav';
import { setupMatch } from '../src/ai/setup';
import { AI_DIFFICULTY } from '../src/config/balance';
import { CASTLE_POS } from '../src/config/map';
import { World } from '../src/sim/world';

describe('AI', () => {
  it('レーン割り当て：全レーンを埋め、ファイターは端、サポーターは中央', () => {
    const a = assignLanes([
      { id: 1, role: 'fighter' },
      { id: 2, role: 'fighter' },
      { id: 3, role: 'support' },
      { id: 4, role: 'attacker' },
    ]);
    const lanes = [...a.values()].map((x) => x.lane);
    expect(new Set(lanes).size).toBe(3);
    expect([0, 2]).toContain(a.get(1)!.lane);
    expect([0, 2]).toContain(a.get(2)!.lane);
    expect(a.get(3)!.lane).toBe(1);
    expect(a.get(4)!.roam).toBe(true);
  });

  it('プレイヤーのレーンは固定し、他を埋める', () => {
    const a = assignLanes([
      { id: 1, role: 'attacker', fixedLane: 0 },
      { id: 2, role: 'support' },
      { id: 3, role: 'support' },
      { id: 4, role: 'support' },
    ]);
    const lanes = [...a.values()].map((x) => x.lane);
    expect(new Set(lanes).size).toBe(3);
  });

  it('難易度は3段階', () => {
    expect(Object.keys(AI_DIFFICULTY)).toEqual(['easy', 'normal', 'hard']);
    expect(AI_DIFFICULTY.hard.aimError).toBeLessThan(AI_DIFFICULTY.easy.aimError);
  });

  it('味方3＋敵4のAIが生成される', () => {
    const w = new World();
    const { player, director } = setupMatch(w, { casterId: 'akazukin', skillIds: [], assistIds: [], soulId: '' }, 'normal');
    expect(player).toBeDefined();
    expect(director.ais.filter((a) => a.hero.team === 0)).toHaveLength(3);
    expect(director.ais.filter((a) => a.hero.team === 1)).toHaveLength(4);
  });

  it('HP30%以下で撤退する', () => {
    const w = new World();
    const h = w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: [], soulId: '' }, 0, false, 1);
    const ai = new HeroAI(w, h, 'hard', 1);
    w.controllers.push(ai);
    h.x = 1200;
    h.y = 1800;
    h.hp = h.maxHp * 0.25;
    const d0 = Math.hypot(h.x - CASTLE_POS[0].x, h.y - CASTLE_POS[0].y);
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    expect(ai.mode).toBe('retreat');
    expect(Math.hypot(h.x - CASTLE_POS[0].x, h.y - CASTLE_POS[0].y)).toBeLessThan(d0 - 200);
  });

  it('敵の巨人に向かう', () => {
    const w = new World();
    const h = w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: [], soulId: '' }, 0, false, 1);
    const ai = new HeroAI(w, h, 'hard', 0);
    w.controllers.push(ai);
    w.summonGiant(1, 0, { id: 'x', name: 'x', giantType: 'breaker' });
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    expect(ai.mode).toBe('giant');
  });

  it('ナビ：別レーンへは森の入口か広場を経由', () => {
    const w = new World();
    const wp = nextWaypoint(w, { x: 600, y: 2400 }, { x: 1800, y: 2400 });
    expect(wp.x).toBe(600); // まず自レーン上の横断点へ
    expect([1800, 3270]).toContain(wp.y);
  });
});
