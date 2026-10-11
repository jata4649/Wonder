import { describe, expect, it } from 'vitest';
import { CASTER_BY_ID } from '../shared/config/casters';
import { BTN, NET, type InputCmd, type ServerMsg, type SnapshotMsg, type WelcomeMsg } from '../shared/net/protocol';
import { NetMirror } from '../shared/net/mirror';
import { pathLength } from '../shared/sim/projectiles/drawshot';
import { World } from '../shared/sim/world';
import { GameRoom, type Conn } from '../server/rooms/GameRoom';
import { Matchmaker } from '../server/matchmaking/Matchmaker';
import { MmrStore } from '../server/matchmaking/mmr';

const lo = (id: string) => ({ casterId: id, skillIds: CASTER_BY_ID[id].skills.slice(0, 3).map((s) => s.id), assistIds: [], soulId: '' });

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  constructor(public id: string) {}
  send(m: ServerMsg) {
    this.msgs.push(m);
  }
  snaps() {
    return this.msgs.filter((m): m is SnapshotMsg => m.k === 'snap');
  }
}

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function soloRoom(caster = 'akazukin', team: 0 | 1 = 0) {
  const c = clock();
  const conn = new FakeConn('p1');
  const room = new GameRoom({ id: 'T', mode: 'quick', difficulty: 'normal', seed: 7, now: c.now, players: [{ token: 'tok1', name: 'A', loadout: lo(caster), team, conn, mmr: 1500 }] });
  const seat = room.seatOf('tok1')!;
  let seq = 0;
  const input = (p: Partial<InputCmd> = {}) => room.onInput('tok1', { seq: ++seq, t: c.now(), move: { x: 0, y: 0 }, buttons: 0, ...p });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      c.advance(1000 / 30);
      room.step();
    }
  };
  return { room, conn, seat, hero: seat.hero, input, tick, c };
}

describe('M12 オンライン：サーバー権威', () => {
  it('入力（移動）だけでサーバーがキャストを動かし、ack を返す', () => {
    const { hero, input, tick, conn } = soloRoom();
    const y0 = hero.y;
    for (let i = 0; i < 30; i++) {
      input({ move: { x: 0, y: -1 } });
      tick();
    }
    expect(hero.y).toBeLessThan(y0 - 100);
    const snaps = conn.snaps();
    expect(snaps.length).toBeGreaterThanOrEqual(14); // 15Hz
    expect(snaps[snaps.length - 1].ack).toBeGreaterThanOrEqual(28);
  });

  it('スナップショットは差分のみ（変化しない拠点は2回目以降送られない）', () => {
    const { tick, conn } = soloRoom();
    tick(4);
    const [s1, s2] = conn.snaps();
    expect(s1.e.b?.u?.length).toBe(14);
    expect(s2.e.b).toBeUndefined();
  });

  it('移動ベクトルの水増し（速度ハック）は正規化される', () => {
    const a = soloRoom();
    const b = soloRoom();
    for (let i = 0; i < 20; i++) {
      a.input({ move: { x: 0, y: -1 } });
      b.input({ move: { x: 0, y: -50 } });
      a.tick();
      b.tick();
    }
    expect(b.hero.y).toBeCloseTo(a.hero.y, 5);
  });

  it('描線長を超える描き込みはサーバーでクランプして発動', () => {
    const { hero, input, tick, room } = soloRoom('akazukin');
    hero.x = 1200;
    hero.y = 2600;
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(1200 + (i % 2) * 120, 2600 - i * 20); // 総長2000超
    input({ buttons: BTN.DS, draw: { points: pts, durMs: 1200 } });
    tick();
    const shot = room.world.drawShots.find((p) => p.owner === hero);
    expect(shot).toBeDefined();
    expect(pathLength(shot!.prof.pts)).toBeLessThanOrEqual(hero.def.draw.drawLength + 1);
    expect(room.rejectsOf('tok1')!.clamped).toBe(1);
  });

  it('物理的に不可能な速さの描線・同時押し・連打は弾かれる', () => {
    const { hero, input, tick, room } = soloRoom('akazukin');
    hero.x = 1200;
    hero.y = 2600;
    input({ buttons: BTN.DS, draw: { points: [1200, 2600, 1200, 2300], durMs: 5 } }); // 300px を 5ms
    tick();
    expect(room.rejectsOf('tok1')!.speed).toBe(1);
    input({ buttons: BTN.SS | BTN.DS, aim: { x: 1200, y: 2000 } });
    tick();
    expect(room.rejectsOf('tok1')!.multi).toBe(1);
    // SS を毎 tick 連打 → クールダウン中は弾かれる
    for (let i = 0; i < 10; i++) {
      input({ buttons: BTN.SS, aim: { x: 1200, y: 2000 } });
      tick();
    }
    expect(room.rejectsOf('tok1')!.cd).toBeGreaterThan(3);
    // 再送（古い seq）は無視
    room.onInput('tok1', { seq: 1, t: 0, move: { x: 1, y: 0 }, buttons: BTN.SS, aim: { x: 0, y: 0 } });
    tick();
    expect(room.rejectsOf('tok1')!.stale).toBe(1);
  });

  it('MP 不足の発動は弾かれる（MP はサーバーが持つ）', () => {
    const { hero, input, tick, room } = soloRoom('akazukin');
    hero.mp = 3;
    input({ buttons: BTN.DS, draw: { points: [hero.x, hero.y - 20, hero.x, hero.y - 300], durMs: 300 } });
    tick();
    expect(room.rejectsOf('tok1')!.mp).toBe(1);
  });
});

describe('M12 ラグ補償（150ms）', () => {
  it('撃った瞬間の位置へ描いた線は、相手が直後に避けても補償ありなら当たる（なしなら外れる）', () => {
    for (const lag of [0, 200]) {
      const w = new World({ seed: 1 });
      const shooter = w.addHero(lo('kurousagi'), 0, true, 1);
      const target = w.addHero(lo('akazukin'), 1, true, 1);
      const A = { x: 1200, y: 2000 };
      shooter.x = A.x;
      shooter.y = A.y + 130;
      target.x = A.x;
      target.y = A.y;
      for (let i = 0; i < 30; i++) w.step(1 / 60); // 履歴を貯める（静止）
      const hp0 = target.hp;
      shooter.cmds.push({ t: 'ds', pts: [{ x: A.x, y: A.y + 75 }, { x: A.x, y: A.y - 80 }], lagMs: lag });
      w.step(1 / 60);
      // 撃たれた直後に横へ大きく逃げる（撃った側の画面ではまだ A にいた）
      target.x = A.x + 110;
      for (let i = 0; i < 30; i++) w.step(1 / 60);
      if (lag) expect(target.hp).toBeLessThan(hp0);
      else expect(target.hp).toBe(hp0);
    }
  });

  it('補償は 150ms で頭打ち（それより古い位置には当たらない）', () => {
    const w = new World({ seed: 1 });
    const a = w.addHero(lo('akazukin'), 1, true, 1);
    a.x = 1200;
    a.y = 2000;
    for (let i = 0; i < 6; i++) w.step(1 / 60);
    a.x = 1300; // 0.25秒前から移動
    for (let i = 0; i < 15; i++) w.step(1 / 60);
    expect(w.pastPosition(a.id, 0.15)!.x).toBe(1300);
    expect(w.pastPosition(a.id, 0.3)!.x).toBe(1200);
  });
});

describe('M12 切断・再接続', () => {
  it('切断すると AI が引き継ぎ、30秒以内の再接続で元のキャストに戻る', () => {
    const { room, hero, tick, c } = soloRoom();
    room.disconnect('tok1');
    expect(room.director.isAI(hero)).toBe(true);
    tick(30);
    const conn2 = new FakeConn('p1b');
    c.advance(10_000);
    expect(room.reconnect('tok1', conn2)).toBe(true);
    expect(room.director.isAI(hero)).toBe(false);
    const w = conn2.msgs.find((m): m is WelcomeMsg => m.k === 'welcome')!;
    expect(w.heroId).toBe(hero.id);
  });

  it('30秒を過ぎたら最後まで AI（再接続できない）。状態は維持される', () => {
    const { room, hero, tick, c } = soloRoom();
    const gauge = [...room.world.match.gauge];
    room.disconnect('tok1');
    c.advance(31_000);
    tick();
    expect(room.reconnect('tok1', new FakeConn('x'))).toBe(false);
    expect(room.director.isAI(hero)).toBe(true);
    expect(room.world.match.gauge[0]).toBeLessThanOrEqual(gauge[0]);
  });
});

describe('M12 マッチメイキング', () => {
  const hello = (mm: Matchmaker, name: string, extra: Record<string, unknown> = {}) => {
    const conn = new FakeConn(name);
    mm.hello(conn, { k: 'hello', name, token: name, mode: 'quick', loadout: lo('akazukin'), ...extra } as never);
    return conn;
  };

  it('30秒集まらなければ CPU で補充して開始', () => {
    const c = clock();
    const mm = new Matchmaker(new MmrStore(), { now: c.now });
    const conn = hello(mm, 'solo');
    mm.update();
    expect(mm.rooms.size).toBe(0);
    c.advance(NET.matchWaitMs);
    mm.update();
    expect(mm.rooms.size).toBe(1);
    const room = [...mm.rooms.values()][0];
    expect(room.seats.filter((s) => s.token).length).toBe(1);
    expect(room.seats.length).toBe(8);
    expect(conn.msgs.some((m) => m.k === 'welcome')).toBe(true);
  });

  it('8人揃えば即開始、パーティは同じチーム、補充枠には後から人間が入れる', () => {
    const c = clock();
    const mm = new Matchmaker(new MmrStore(), { now: c.now });
    for (let i = 0; i < 6; i++) hello(mm, `p${i}`);
    hello(mm, 'pa', { party: 'X' });
    hello(mm, 'pb', { party: 'X' });
    mm.update();
    expect(mm.rooms.size).toBe(1);
    const room = [...mm.rooms.values()][0];
    expect(room.seatOf('pa')!.team).toBe(room.seatOf('pb')!.team);
    // 別の部屋（CPU補充あり）に途中参加
    const mm2 = new Matchmaker(new MmrStore(), { now: c.now });
    hello(mm2, 'early');
    c.advance(NET.matchWaitMs);
    mm2.update();
    hello(mm2, 'late');
    const r2 = [...mm2.rooms.values()][0];
    expect(r2.seatOf('late')).toBeDefined();
    expect(r2.director.isAI(r2.seatOf('late')!.hero)).toBe(false);
  });

  it('ルーム対戦（コード＋パスワード）と協力', () => {
    const c = clock();
    const mm = new Matchmaker(new MmrStore(), { now: c.now });
    const host = new FakeConn('h');
    mm.hello(host, { k: 'hello', name: 'h', token: 'h', mode: 'room', loadout: lo('akazukin'), room: { code: 'abc1', password: 'pw' } });
    const bad = new FakeConn('b');
    mm.hello(bad, { k: 'hello', name: 'b', token: 'b', mode: 'room', loadout: lo('akazukin'), room: { code: 'ABC1', password: 'no' } });
    expect(bad.msgs.some((m) => m.k === 'error')).toBe(true);
    const ok = new FakeConn('o');
    mm.hello(ok, { k: 'hello', name: 'o', token: 'o', mode: 'room', loadout: lo('akazukin'), room: { code: 'ABC1', password: 'pw' } });
    mm.startPrivateBy('h');
    expect(mm.rooms.size).toBe(1);
    const coop = new FakeConn('c');
    mm.hello(coop, { k: 'hello', name: 'c', token: 'c', mode: 'coop', loadout: lo('akazukin') });
    const r = [...mm.rooms.values()].find((x) => x.mode === 'coop')!;
    expect(r.seatOf('c')!.team).toBe(0);
  });
});

describe('M12 観戦（1分遅延）', () => {
  it('観戦者には60秒遅れのスナップショットだけが届く', () => {
    const { room, tick, c } = soloRoom();
    const sp = new FakeConn('sp');
    room.addSpectator(sp);
    tick(30 * 30); // 30秒
    expect(sp.snaps().length).toBe(0);
    tick(30 * 31); // 61秒
    const snaps = sp.snaps();
    expect(snaps.length).toBeGreaterThan(0);
    expect(c.now() - snaps[snaps.length - 1].st).toBeGreaterThanOrEqual(NET.spectateDelayMs);
  });
});

describe('M12 予測と reconciliation', () => {
  it('遅延があっても自キャストの予測は 8px 未満に収束する', () => {
    const { room, conn, hero } = soloRoom('akazukin');
    const welcome = conn.msgs.find((m): m is WelcomeMsg => m.k === 'welcome')!;
    const mirror = new NetMirror(welcome.seed, welcome.roster, welcome.heroId, welcome.team, false);
    const c2s: { at: number; cmd: InputCmd }[] = [];
    let delivered = 0;
    let seq = 0;
    const ONE_WAY = 4; // tick（≒133ms）
    for (let t = 0; t < 120; t++) {
      // クライアント：入力を作って予測
      const move = t < 80 ? { x: Math.sin(t / 10), y: -1 } : { x: 0, y: 0 };
      const cmd: InputCmd = { seq: ++seq, t, move, buttons: 0 };
      mirror.predict(cmd);
      c2s.push({ at: t + ONE_WAY, cmd });
      // サーバー
      for (const p of c2s.filter((x) => x.at === t)) room.onInput('tok1', p.cmd);
      room.step();
      // サーバー → クライアント（遅延して届く）
      const snaps = conn.snaps();
      while (delivered < snaps.length && snaps[delivered].tick + ONE_WAY * 1 <= room.tick) mirror.apply(snaps[delivered++]);
      mirror.interpolate(Number.MAX_SAFE_INTEGER, 1 / 30);
    }
    // 止まってしばらく後
    for (let t = 0; t < 20; t++) {
      room.step();
      const snaps = conn.snaps();
      while (delivered < snaps.length) mirror.apply(snaps[delivered++]);
      mirror.interpolate(Number.MAX_SAFE_INTEGER, 1 / 30);
    }
    const me = mirror.me!;
    expect(Math.hypot(me.x - hero.x, me.y - hero.y)).toBeLessThan(8);
  });
});

describe('M12 ピング', () => {
  it('位置はサーバー側の自キャストから決まり、連打は1秒に1回', () => {
    const c = clock();
    const conn = new FakeConn('p');
    const room = new GameRoom({ id: 'S', mode: 'quick', difficulty: 'normal', seed: 3, now: c.now, players: [{ token: 't', name: 'A', loadout: lo('akazukin'), team: 0, conn, mmr: 1500 }] });
    const h = room.seatOf('t')!.hero;
    room.onSignal('t', 'gather');
    room.onSignal('t', 'gather');
    expect(room.world.pings).toHaveLength(1);
    expect(room.world.pings[0].x).toBe(h.x);
    room.onSignal('t', 'hack');
    expect(room.world.pings).toHaveLength(1);
  });
});
