import { afterEach, describe, expect, it } from 'vitest';
import { CASTERS, CASTER_BY_ID } from '../src/config/casters';
import { CASTLE_POS, LANE_X } from '../src/config/map';
import { MINION } from '../src/config/balance';
import { orient } from '../src/input/orientation';
import { DrawGesture } from '../src/input/drawGesture';
import { Camera } from '../src/render/camera';
import { UprightQueue } from '../src/render/uprightText';
import { spawnGiant } from '../src/sim/giants';
import { cullMinions, spawnSquad } from '../src/sim/minions';
import { SOULS } from '../src/config/assists';
import { World } from '../src/sim/world';

const landCam = () => {
  orient.land = true;
  const c = new Camera();
  c.resize(844, 390);
  c.x = 1200;
  c.y = 1800;
  return c;
};
afterEach(() => {
  orient.land = false;
});

describe('M0 横画面の座標変換', () => {
  it('自城が画面左・敵城が画面右、レーンは左右に走る（上中下に並ぶ）', () => {
    const c = landCam();
    c.scale = 844 / 3600;
    const own = c.worldToScreen(CASTLE_POS[0].x, CASTLE_POS[0].y);
    const enemy = c.worldToScreen(CASTLE_POS[1].x, CASTLE_POS[1].y);
    expect(own.x).toBeLessThan(enemy.x);
    expect(Math.abs(own.y - enemy.y)).toBeLessThan(1);
    // レーン（x一定）は画面上で y 一定＝水平線
    const a = c.worldToScreen(LANE_X[0], 500);
    const b = c.worldToScreen(LANE_X[0], 3000);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6);
    const top = c.worldToScreen(LANE_X[0], 1800).y;
    const mid = c.worldToScreen(LANE_X[1], 1800).y;
    const bot = c.worldToScreen(LANE_X[2], 1800).y;
    expect(top).toBeLessThan(mid);
    expect(mid).toBeLessThan(bot);
  });

  it('画面↔ワールド変換は往復で一致', () => {
    const c = landCam();
    for (const [sx, sy] of [
      [0, 0],
      [844, 390],
      [300, 120],
    ]) {
      const w = c.screenToWorld(sx, sy);
      const s = c.worldToScreen(w.x, w.y);
      expect(s.x).toBeCloseTo(sx, 6);
      expect(s.y).toBeCloseTo(sy, 6);
    }
  });

  it('スティックを上に倒すと画面の上へ移動する（90°ずれない）', () => {
    const c = landCam();
    const d = c.screenDirToWorld(0, -1);
    const p0 = c.worldToScreen(1200, 1800);
    const p1 = c.worldToScreen(1200 + d.x * 10, 1800 + d.y * 10);
    expect(p1.y).toBeLessThan(p0.y);
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(1e-6);
    // 右に倒すと画面の右（＝敵陣方向）
    const r = c.screenDirToWorld(1, 0);
    expect(r.y).toBeLessThan(0);
  });

  it('2本指パンはドラッグ方向どおりに盤面が動く', () => {
    const c = landCam();
    const p0 = c.worldToScreen(1300, 1900);
    c.pan(40, -25, 0);
    const p1 = c.worldToScreen(1300, 1900);
    expect(p1.x - p0.x).toBeCloseTo(40, 6);
    expect(p1.y - p0.y).toBeCloseTo(-25, 6);
  });

  it('視野の計算を向きで切り替える', () => {
    const c = landCam();
    const bb = c.bounds(0);
    // 横画面：画面の幅（844）はワールドの y 方向
    expect((bb.y1 - bb.y0) * c.scale).toBeCloseTo(844, 3);
    expect((bb.x1 - bb.x0) * c.scale).toBeCloseTo(390, 3);
  });

  it('正立キュー：文字とバーはスクリーン空間で描かれる（回転なし）', () => {
    const c = landCam();
    const q = new UprightQueue();
    q.text(1200, 1800, '刹那門 開門 12s', { size: 20, dy: 10 });
    q.bar(1200, 1800, 64, 9, 0.5, '#0f0', 20);
    const calls: string[] = [];
    const ctx: any = new Proxy(
      {},
      {
        get: (_t, k) => (typeof k === 'string' && ['fillText', 'fillRect', 'strokeText', 'measureText', 'drawImage'].includes(k) ? (...a: any[]) => (calls.push(k), k === 'measureText' ? { width: 10 } : undefined) : undefined),
        set: () => true,
      },
    );
    q.flush(ctx, c);
    expect(calls).toContain('fillText');
    expect(calls.filter((x) => x === 'fillRect').length).toBe(2);
    expect(q.length).toBe(0);
  });
});

describe('SPEC 5.1 キャストデータ', () => {
  it('テツカギが最長射程、ネムリヒメが最長描線、突進・投擲は貫通力99', () => {
    const curves = CASTERS.filter((c) => c.draw.type === 'curve');
    expect(Math.max(...CASTERS.map((c) => c.draw.range))).toBe(CASTER_BY_ID.tetsukagi.draw.range);
    expect(Math.max(...curves.map((c) => c.draw.drawLength))).toBe(CASTER_BY_ID.nemurihime.draw.drawLength);
    for (const c of CASTERS.filter((c) => c.draw.type !== 'curve')) expect(c.draw.piercePower).toBe(99);
    expect(CASTER_BY_ID.shichinin.draw.multiShot).toBe(3);
    expect(CASTER_BY_ID.kurousagi.draw.down).toBe(false);
    for (const c of CASTERS) expect(c.dsNote.length).toBeGreaterThan(0);
  });
});

describe('SPEC 差分', () => {
  it('短く素早いフリックでストレートショット', () => {
    const w = new World();
    const h = w.addHero({ casterId: 'akazukin', skillIds: [], assistIds: [], soulId: '' }, 0, true, 1);
    h.x = 1200;
    h.y = 2000;
    const cam = new Camera();
    cam.resize(400, 800);
    cam.scale = 1;
    cam.x = 1200;
    cam.y = 2000;
    const g = new DrawGesture(cam, () => h, () => w);
    g.begin(1, 220, 400, 0);
    g.move(220, 360);
    g.move(220, 320);
    g.end(220, 300, 100);
    expect(h.cmds[0]?.t).toBe('ss');
  });

  it('兵士は総数150体を超えたら古い個体から間引く', () => {
    const w = new World();
    for (let i = 0; i < 20; i++) spawnSquad(w, (i % 2) as 0 | 1, 1, 'castle', 9, 1, 1200, 1000 + i * 60);
    const firstId = w.minions[0].id;
    cullMinions(w);
    expect(w.minions.length).toBe(MINION.maxTotal);
    expect(w.minions.some((m) => m.id === firstId)).toBe(false);
  });

  it('破壊型巨人は拠点に接触すると拠点を壊して消滅', () => {
    const w = new World();
    const g = spawnGiant(w, 0, 0, SOULS[0]);
    const target = w.frontBase(1, 0)!;
    g.y = target.y + target.r + g.r + 20;
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    expect(target.alive).toBe(false);
    expect(w.giants.includes(g)).toBe(false);
  });
});
