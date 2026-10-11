import { describe, expect, it } from 'vitest';
import { HERO, MINION, ROLE_DECAY } from '../src/config/balance';
import { CASTER_BY_ID } from '../src/config/casters';
import { DrawGesture } from '../src/input/drawGesture';
import { Camera } from '../src/render/camera';
import { spawnSquad } from '../src/sim/minions';
import { buildProfile, decayFactor } from '../src/sim/projectiles/drawshot';
import { World } from '../src/sim/world';

const lo = (id: string) => ({ casterId: id, skillIds: [], assistIds: [], soulId: '' });
const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * 60; i++) w.step(1 / 60);
};
const line = (x0: number, y0: number, x1: number, y1: number, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
const zigzag = (x: number, y: number, amp: number, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: x + (i % 2 ? amp : -amp), y: y - i * step }));

describe('弾速変化', () => {
  it('直線だと加速する', () => {
    const d = CASTER_BY_ID.akazukin.draw;
    const p = buildProfile(line(0, 0, 0, -400), d);
    expect(p.speed[p.speed.length - 1]).toBeGreaterThan(d.baseSpeed * 1.4);
  });
  it('鋭角に曲げると減速する', () => {
    const d = CASTER_BY_ID.akazukin.draw;
    const pts = [...line(0, 0, 0, -150), ...line(0, -150, 150, -150).slice(1)];
    const p = buildProfile(pts, d);
    const before = p.speed[Math.floor(p.pts.length * 0.4)];
    const after = p.speed[Math.floor(p.pts.length * 0.6)];
    expect(after).toBeLessThan(before * 0.75);
  });
  it('テツカギはジグザグでほぼ停止する（停滞ドロー）', () => {
    const tk = CASTER_BY_ID.tetsukagi.draw;
    const ak = CASTER_BY_ID.akazukin.draw;
    const z = zigzag(0, 0, 25, 20, 8);
    const pt = buildProfile(z, tk);
    const pa = buildProfile(z, ak);
    const minT = Math.min(...pt.speed);
    expect(minT).toBeLessThan(tk.baseSpeed * 0.08);
    expect(minT / tk.baseSpeed).toBeLessThan(Math.min(...pa.speed) / ak.baseSpeed);
  });
});

describe('ドローショット', () => {
  it('発射位置は曲線の始点（キャスト中心ではない）', () => {
    const w = new World();
    const h = w.addHero(lo('akazukin'), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    h.cmds.push({ t: 'ds', pts: line(1240, 1990, 1240, 1700) });
    w.step(1 / 60);
    const p = w.drawShots[0];
    expect(p.prof.pts[0].x).toBeCloseTo(1240, 0);
    expect(p.prof.pts[0].y).toBeCloseTo(1990, 0);
    // 始点は判定内にクランプされる
    h.mp = 100;
    h.cmds.push({ t: 'ds', pts: line(1500, 2000, 1500, 1700) });
    w.step(1 / 60);
    const q = w.drawShots[w.drawShots.length - 1];
    expect(Math.hypot(q.prof.pts[0].x - h.x, q.prof.pts[0].y - h.y)).toBeLessThanOrEqual(HERO.drawStartRadius + 5);
  });

  it('MPは基本10消費、不足時は発動しない', () => {
    const w = new World();
    const h = w.addHero(lo('akazukin'), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const mp0 = h.mp;
    h.cmds.push({ t: 'ds', pts: line(1200, 1990, 1200, 1800) });
    w.step(1 / 60);
    expect(mp0 - h.mp).toBeGreaterThan(9.5);
    h.mp = 5;
    const n = w.drawShots.length;
    h.cmds.push({ t: 'ds', pts: line(1200, 1990, 1200, 1800) });
    w.step(1 / 60);
    expect(w.drawShots.length).toBe(n);
    expect(h.notice?.text).toBe('MP不足');
  });

  it('減衰：ファイターは緩く（≈6割）、それ以外は強い（4〜5割）', () => {
    expect(decayFactor(ROLE_DECAY.fighter, 99)).toBeCloseTo(0.6, 1);
    expect(decayFactor(ROLE_DECAY.attacker, 99)).toBeLessThanOrEqual(0.5);
    expect(decayFactor(ROLE_DECAY.support, 99)).toBeLessThanOrEqual(0.5);
    for (const id of ['garasunokutsu', 'hoshitsubame', 'onryou']) {
      const d = CASTER_BY_ID[id].draw;
      expect(d.pierceDecay).toBe(false);
    }
  });

  it('大兵士は自由曲線ドローを遮り、貫通力があれば貫通する', () => {
    for (const pierce of [0, 1]) {
      const w = new World();
      const h = w.addHero(lo('akazukin'), 0, true, 1);
      h.x = 1200;
      h.y = 2000;
      const sq = spawnSquad(w, 1, 1, 'castle', 4, 1, 1200, 1800);
      sq.formTimer = 0;
      sq.state = 'advance';
      const big = sq.members[0];
      big.x = 1200;
      big.y = 1850;
      const behind = sq.members[1];
      behind.x = 1200;
      behind.y = 1760;
      for (const m of sq.members.slice(2)) m.x = 900;
      sq.ax = 1200;
      sq.ay = 1850;
      (h.def.draw as any).piercePower = pierce;
      h.cmds.push({ t: 'ds', pts: line(1200, 1975, 1200, 1700) });
      w.step(1 / 60);
      sq.formTimer = 0;
      for (let i = 0; i < 40; i++) {
        big.y = 1850;
        behind.y = 1760;
        big.x = behind.x = 1200;
        w.step(1 / 60);
      }
      expect(big.hp).toBeLessThan(MINION.big.hp);
      if (pierce === 0) expect(behind.hp).toBe(MINION.small.hp);
      else expect(behind.hp).toBeLessThan(MINION.small.hp);
      (h.def.draw as any).piercePower = 0;
    }
  });

  it('投擲は大兵士に遮られない（着弾範囲全体にダメージ）', () => {
    const w = new World();
    const h = w.addHero(lo('garasunokutsu'), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const sq = spawnSquad(w, 1, 1, 'castle', 4, 1, 1200, 1700);
    sq.formTimer = 0;
    for (const m of sq.members) {
      m.x = 1200 + (m.slot - 1.5) * 30;
      m.y = 1700;
    }
    h.cmds.push({ t: 'ds', pts: line(1200, 1980, 1200, 1700) });
    for (let i = 0; i < 60; i++) {
      for (const m of sq.members) m.y = 1700;
      w.step(1 / 60);
    }
    expect(sq.members.every((m) => m.hp < m.maxHp)).toBe(true);
  });

  it('5連続ヒットでチェインボーナス', () => {
    const w = new World();
    const h = w.addHero(lo('akazukin'), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const sq = spawnSquad(w, 1, 1, 'castle', 6, 0, 1200, 1800);
    sq.formTimer = 0;
    sq.members.forEach((m, i) => {
      m.x = 1200;
      m.y = 1930 - i * 40;
    });
    h.cmds.push({ t: 'ds', pts: line(1200, 1975, 1200, 1650) });
    let chain: any = null;
    for (let i = 0; i < 120; i++) {
      sq.members.forEach((m, k) => {
        m.x = 1200;
        m.y = 1930 - k * 40;
      });
      w.step(1 / 60);
      for (const e of w.drainEvents()) if (e.type === 'chain') chain = e;
    }
    expect(chain).not.toBeNull();
    expect(chain.count).toBeGreaterThanOrEqual(5);
    expect(chain.xp).toBeGreaterThanOrEqual(MINION.small.xp * 1.8);
  });
});

describe('入力ジェスチャ', () => {
  const setup = (caster = 'akazukin') => {
    const w = new World();
    const h = w.addHero(lo(caster), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const cam = new Camera();
    cam.resize(400, 800);
    cam.scale = 1;
    cam.x = 1200;
    cam.y = 2000;
    const g = new DrawGesture(cam, () => h, () => w);
    return { w, h, g };
  };
  // 画面中央(200,400) = キャストの位置
  it('自キャストの上で離すとキャンセル', () => {
    const { h, g } = setup();
    g.begin(1, 220, 400, 0);
    g.move(220, 300);
    g.move(240, 250);
    g.move(205, 395);
    g.end(205, 395, 500);
    expect(h.cmds).toHaveLength(0);
    expect(g.lastResult?.kind).toBe('cancel');
  });
  it('回避（cancel）でもキャンセル', () => {
    const { h, g } = setup();
    g.begin(1, 220, 400, 0);
    g.move(220, 300);
    g.cancel();
    expect(h.cmds).toHaveLength(0);
  });
  it('描線長を超えた瞬間に自動発動', () => {
    const { h, g } = setup();
    g.begin(1, 220, 400, 0);
    for (let i = 1; i <= 60; i++) g.move(220 + (i % 2) * 60, 400 - i * 6);
    expect(h.cmds.length).toBe(1);
    expect(g.active).toBe(false);
    expect(g.lastResult?.kind).toBe('auto');
  });
  it('短タップはストレートショット', () => {
    const { h, g } = setup();
    g.begin(1, 300, 300, 0);
    g.end(300, 300, 100);
    expect(h.cmds[0]?.t).toBe('ss');
  });
  it('MP不足だと攻撃姿勢に入れない', () => {
    const { h, g } = setup();
    h.mp = 3;
    g.begin(1, 220, 400, 0);
    expect(h.drawStance).toBe(false);
    g.move(220, 300);
    g.end(220, 250, 600);
    expect(h.cmds).toHaveLength(0);
    expect(h.notice?.text).toBe('MP不足');
  });
});

describe('突進・跳躍', () => {
  it('跳躍は森の壁を飛び越えて着地範囲攻撃', () => {
    const w = new World();
    const h = w.addHero(lo('hoshitsubame'), 0, true, 0);
    h.x = 690; // 左レーンの右端（森の縁の手前）
    h.y = 1600;
    h.cmds.push({ t: 'ds', pts: line(690, 1600, 1000, 1600) });
    run(w, 1);
    expect(h.x).toBeGreaterThan(780); // 森の中へ
  });
  it('突撃は大兵士でも途切れず、減衰なし', () => {
    const w = new World();
    const h = w.addHero(lo('onryou'), 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const sq = spawnSquad(w, 1, 1, 'castle', 3, 1, 1200, 1850);
    sq.formTimer = 0;
    sq.members.forEach((m, i) => {
      m.x = 1200;
      m.y = 1900 - i * 50;
    });
    h.cmds.push({ t: 'ds', pts: line(1200, 1990, 1200, 1700) });
    for (let i = 0; i < 40; i++) {
      sq.members.forEach((m, k) => {
        if (m.alive) {
          m.x = 1200;
          m.y = 1900 - k * 50;
        }
      });
      w.step(1 / 60);
    }
    expect(sq.members.every((m) => m.hp < m.maxHp)).toBe(true);
  });
});
