// クライアント側の「鏡」ワールド。サーバーのスナップショットを当てはめて描画に使う。
// - 他キャスト・兵士・弾などは 100ms 遅らせて補間（なめらかに見せる）
// - 自キャストはローカル予測で即応し、スナップショットの ack で巻き戻して未処理の入力を再適用（reconciliation）
// シミュレーションはサーバーが正。鏡ワールドは step しない。
import { CROSS } from '../config/balance';
import { GIANTS } from '../config/giants';
import { SOUL_BY_ID } from '../config/assists';
import type { GiantType, Team } from '../config/types';
import type { Base } from '../sim/bases';
import type { Giant } from '../sim/giants';
import type { Vec } from '../sim/geom';
import type { DrawProjectile, LobShell, StraightShot } from '../sim/projectiles/drawshot';
import type { Bolt } from '../sim/projectiles/bolt';
import { Hero, type Buff, type HeroState } from '../sim/units/hero';
import type { Minion, Squad } from '../sim/units/types';
import type { Trail } from '../sim/trails';
import type { XpOrb } from '../sim/xp';
import { World, type GameEvent, type Ping, type PingKind } from '../sim/world';
import { NET, type Ent, type InputCmd, type NetEvent, type RosterEntry, type SnapshotMsg } from './protocol';
import { STATE_NAME } from './snapshot';

type Sample = { t: number; x: number; y: number };

/** 自キャストの移動予測：サーバーと同じ移動式（1入力＝1tick＝シミュレーション2ステップ）。 */
export function predictMove(hero: Hero, move: { x: number; y: number }) {
  const dt = 1 / 60;
  for (let i = 0; i < NET.simStepsPerTick; i++) {
    const len = Math.hypot(move.x, move.y);
    if (len > 0.05) {
      const k = Math.min(1, len);
      const sp = hero.stat('speed') * k * dt;
      hero.x += (move.x / len) * sp;
      hero.y += (move.y / len) * sp;
    }
    hero.collide();
  }
}

export class NetMirror {
  world: World;
  heroId: number;
  team: Team;
  spectator: boolean;
  /** 補間用：種類:id → 位置の履歴（サーバー時刻） */
  private samples = new Map<string, Sample[]>();
  private latestSt = 0;
  /** 自キャストの予測 */
  pending: { seq: number; move: { x: number; y: number } }[] = [];
  private predicted?: Vec;
  /** 予測と確定のズレ（表示を滑らかにするための残差） */
  smooth = { x: 0, y: 0 };
  lastError = 0;
  private minions = new Map<number, Minion>();
  private giants = new Map<number, Giant>();
  private shots = new Map<number, DrawProjectile>();
  private lobs = new Map<number, LobShell>();
  private straights = new Map<number, StraightShot>();
  private bolts = new Map<number, Bolt>();
  private orbs = new Map<number, XpOrb>();
  private trails = new Map<number, Trail>();
  private pings = new Map<number, Ping & { id: number }>();
  private squadStub = new Map<number, Squad>();
  /** 受信したイベント（演出用に変換済み） */
  events: GameEvent[] = [];
  serverState: { state: HeroState; x: number; y: number } = { state: 'normal', x: 0, y: 0 };

  constructor(seed: number, roster: RosterEntry[], heroId: number, team: Team, spectator: boolean) {
    this.world = new World({ seed });
    this.world.trustVisibility = true; // 見えないものはサーバーが送ってこない
    for (const r of roster) {
      const h = this.world.addHero(r.loadout, r.team, r.human, 1, r.id);
      h.netName = r.name;
    }
    this.heroId = heroId;
    this.team = team;
    this.spectator = spectator;
  }

  get me(): Hero | undefined {
    return this.world.heroes.find((h) => h.id === this.heroId);
  }

  private push(key: string, st: number, x: number, y: number) {
    let a = this.samples.get(key);
    if (!a) this.samples.set(key, (a = []));
    a.push({ t: st, x, y });
    if (a.length > 24) a.shift();
  }

  /** スナップショットを当てはめる。 */
  apply(s: SnapshotMsg) {
    const w = this.world;
    const st = s.st;
    this.latestSt = st;
    w.time = s.wt;
    w.freezeT = s.fz ? 0.1 : 0;
    // 試合
    const [tl, g0, g1, res, why] = s.m;
    w.match.timeLeft = tl / 10;
    w.match.gauge = [g0 / 10, g1 / 10];
    w.match.result = res < 0 ? null : { winner: res === 2 ? 'draw' : (res as Team), reason: why ? 'time' : 'gauge' };
    w.progress[0].xp = s.p[0] / 10;
    w.progress[0].level = s.p[1];
    w.progress[1].xp = s.p[2] / 10;
    w.progress[1].level = s.p[3];
    const applySoul = (team: Team, arr: (number | string)[] | undefined) => {
      if (!arr) return;
      const t = w.soul.teams[team];
      t.gauge = (arr[0] as number) / 10;
      const sid = arr[1] as string;
      t.announced = sid ? { soul: SOUL_BY_ID[sid], lane: arr[2] as 0 | 1 | 2 } : null;
    };
    applySoul(this.team, s.s);
    applySoul((1 - this.team) as Team, s.s2);

    const e = s.e;
    if (e.h) this.applyHeroes(e.h.u ?? [], e.h.d ?? [], st, s.ack);
    this.applyKind(e.n, this.minions, (a, m) => this.minion(a, m), (m) => this.push(`n${m.id}`, st, m.x, m.y));
    this.applyKind(e.g, this.giants, (a, g) => this.giant(a, g), (g) => this.push(`g${g.id}`, st, g.x, g.y));
    if (e.b) for (const a of e.b.u ?? []) this.base(a);
    this.applyKind(e.d, this.shots, (a, p) => this.shot(a, p), (p) => this.push(`d${p.id}`, st, p.x, p.y));
    this.applyKind(e.l, this.lobs, (a, l) => this.lob(a, l));
    this.applyKind(e.s, this.straights, (a, p) => this.straight(a, p), (p) => this.push(`s${p.id}`, st, p.x, p.y));
    this.applyKind(e.o, this.bolts, (a, p) => this.bolt(a, p), (p) => this.push(`o${p.id}`, st, p.x, p.y));
    this.applyKind(e.x, this.orbs, (a, p) => this.orb(a, p), (p) => this.push(`x${p.id}`, st, p.x, p.y));
    this.applyKind(e.t, this.trails, (a, p) => this.trail(a, p));
    this.applyKind(e.q, this.pings, (a, p) => this.ping(a, p));
    w.minions = [...this.minions.values()];
    w.giants = [...this.giants.values()];
    w.drawShots = [...this.shots.values()];
    w.lobs = [...this.lobs.values()];
    w.straightShots = [...this.straights.values()];
    w.bolts = [...this.bolts.values()];
    w.orbs = [...this.orbs.values()];
    w.trails = [...this.trails.values()];
    w.pings = [...this.pings.values()];
    w.refreshWalls();
    if (s.ev) for (const ev of s.ev) this.event(ev);
  }

  private applyKind<T extends { id: number }>(
    d: { u?: Ent[]; d?: number[] } | undefined,
    map: Map<number, T>,
    upd: (a: Ent, prev: T | undefined) => T,
    after?: (o: T) => void,
  ) {
    if (!d) return;
    for (const id of d.d ?? []) {
      map.delete(id);
    }
    for (const a of d.u ?? []) {
      const o = upd(a, map.get(a[0] as number));
      map.set(o.id, o);
      after?.(o);
    }
  }

  private applyHeroes(u: Ent[], del: number[], st: number, ack: number) {
    const w = this.world;
    for (const id of del) {
      const h = w.heroes.find((x) => x.id === id);
      if (h && h.id !== this.heroId) h.alive = false; // 見えなくなった（森など）
    }
    for (const a of u) {
      const h = w.heroes.find((x) => x.id === a[0]);
      if (!h) continue;
      const [, x, y, hp, maxHp, mp, state, z, flags, fx, fy, resp, c0, c1, c2, ws, ecd, buffs, kills, deaths, lane, notice] = a as number[] & string[];
      h.hp = hp as number;
      h.maxHp = maxHp as number;
      h.mp = (mp as number) / 10;
      h.state = STATE_NAME[state as number] ?? 'normal';
      h.netZ = z as number;
      const f = flags as number;
      h.alive = !!(f & 1);
      h.drawStance = !!(f & 2);
      h.invulnTimer = f & 4 ? 0.1 : 0;
      h.hitFlash = f & 8 ? 0.1 : 0;
      h.downTimer = f & 16 ? 0.1 : 0;
      h.faceX = (fx as number) / 100;
      h.faceY = (fy as number) / 100;
      h.respawnTimer = (resp as number) / 10;
      if (h.id === this.heroId) {
        h.skillCd = [(c0 as number) / 10, (c1 as number) / 10, (c2 as number) / 10];
        h.evadeCd = (ecd as number) / 10;
        h.notice = notice ? { text: notice as string, t: 0.5 } : h.notice;
      }
      h.wsUsed = !!ws;
      h.buffs = String(buffs || '')
        .split(',')
        .filter(Boolean)
        .map((b) => {
          const [kind, v, t] = b.split(':');
          return { kind: kind as Buff['kind'], value: Number(v) / 100, t: Number(t) / 10 };
        });
      h.kills = kills as number;
      h.deaths = deaths as number;
      h.lane = lane as number;
      if (h.id === this.heroId && !this.spectator) {
        this.serverState = { state: h.state, x: x as number, y: y as number };
        this.reconcile(h, x as number, y as number, ack);
      } else {
        this.push(`h${h.id}`, st, x as number, y as number);
        if (!this.samples.get(`h${h.id}`)?.length) {
          h.x = x as number;
          h.y = y as number;
        }
      }
    }
    // ack を受けたら処理済みの入力を捨てる（位置更新が無い snapshot でも）
    this.pending = this.pending.filter((p) => p.seq > ack);
  }

  /** 予測の巻き戻しと再適用。 */
  private reconcile(h: Hero, sx: number, sy: number, ack: number) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    const before = this.predicted ?? { x: sx, y: sy };
    h.x = sx;
    h.y = sy;
    if (h.state === 'normal' && h.downTimer <= 0 && h.alive) {
      for (const p of this.pending) predictMove(h, p.move);
    }
    const err = Math.hypot(h.x - before.x, h.y - before.y);
    this.lastError = err;
    // 小さなズレは表示を滑らかに吸収、大きなズレ（ワープ・突進など）は即座に合わせる
    if (err < 60) {
      this.smooth.x += before.x - h.x;
      this.smooth.y += before.y - h.y;
    } else this.smooth = { x: 0, y: 0 };
    this.predicted = { x: h.x, y: h.y };
  }

  /** 自キャストの入力をローカルに即反映（予測）。 */
  predict(cmd: InputCmd) {
    const h = this.me;
    if (!h || this.spectator) return;
    this.pending.push({ seq: cmd.seq, move: cmd.move });
    if (this.pending.length > 120) this.pending.shift();
    // 表示位置（残差込み）ではなく、予測そのものから進める
    if (this.predicted) {
      h.x = this.predicted.x;
      h.y = this.predicted.y;
    }
    if (h.alive && h.state === 'normal' && h.downTimer <= 0) predictMove(h, cmd.move);
    this.predicted = { x: h.x, y: h.y };
  }

  /** 描画直前：他者を補間（serverNow - 100ms の位置）。 */
  interpolate(serverNow: number, dt: number) {
    const rt = Math.min(serverNow, this.latestSt) - NET.interpMs;
    const w = this.world;
    const lerp = (key: string, o: { x: number; y: number }) => {
      const a = this.samples.get(key);
      if (!a || !a.length) return;
      let i = a.length - 1;
      while (i > 0 && a[i - 1].t > rt) i--;
      const p1 = a[i];
      const p0 = a[i - 1];
      if (!p0 || p1.t <= rt) {
        o.x = p1.x;
        o.y = p1.y;
        return;
      }
      const k = Math.max(0, Math.min(1, (rt - p0.t) / (p1.t - p0.t)));
      o.x = p0.x + (p1.x - p0.x) * k;
      o.y = p0.y + (p1.y - p0.y) * k;
    };
    for (const h of w.heroes) if (h.id !== this.heroId || this.spectator) lerp(`h${h.id}`, h);
    for (const m of w.minions) lerp(`n${m.id}`, m);
    for (const g of w.giants) lerp(`g${g.id}`, g);
    for (const p of w.drawShots) {
      const prev = { x: p.x, y: p.y };
      lerp(`d${p.id}`, p);
      if (prev.x !== p.x || prev.y !== p.y) {
        p.history.push(prev);
        if (p.history.length > 10) p.history.shift();
      }
    }
    for (const p of w.straightShots) lerp(`s${p.id}`, p);
    for (const p of w.bolts) lerp(`o${p.id}`, p);
    for (const o of w.orbs) lerp(`x${o.id}`, o);
    for (const l of w.lobs) l.t = Math.min(l.T, l.t + dt);
    for (const t of w.trails) t.t = Math.max(0, t.t - dt);
    for (const p of w.pings) p.t = Math.max(0.05, p.t - dt);
    // 自キャスト：予測位置＋残差（徐々に0へ）
    const me = this.me;
    if (me && !this.spectator) {
      const k = Math.exp(-15 * dt);
      this.smooth.x *= k;
      this.smooth.y *= k;
      if (this.predicted) {
        me.x = this.predicted.x + this.smooth.x;
        me.y = this.predicted.y + this.smooth.y;
      }
    }
    // 古いサンプルを掃除
    if (Math.random() < 0.02) {
      const alive = new Set<string>([
        ...w.heroes.map((h) => `h${h.id}`),
        ...w.minions.map((m) => `n${m.id}`),
        ...w.giants.map((g) => `g${g.id}`),
        ...w.drawShots.map((p) => `d${p.id}`),
        ...w.straightShots.map((p) => `s${p.id}`),
        ...w.bolts.map((p) => `o${p.id}`),
        ...w.orbs.map((p) => `x${p.id}`),
      ]);
      for (const k2 of this.samples.keys()) if (!alive.has(k2)) this.samples.delete(k2);
    }
    w.grid.rebuild(w.mobs());
  }

  /** 表示用：予測位置を「確定」に戻す（自キャスト以外の位置は補間済み）。 */
  get predictedPos() {
    return this.predicted;
  }

  // ---- エンティティ変換 ----
  private minion(a: Ent, m?: Minion): Minion {
    const [id, team, big, x, y, hp, maxHp, flags, atk] = a as number[];
    let sq = this.squadStub.get(id);
    if (!sq) {
      sq = { id: -id, team: team as Team, lane: 1, source: 'castle', members: [], ax: x, ay: y, formTimer: 0, state: 'advance', speed: 0 };
      this.squadStub.set(id, sq);
    }
    sq.formTimer = flags & 1 ? 1 : 0;
    const o: Minion =
      m ??
      ({
        id,
        kind: 'minion',
        team: team as Team,
        x,
        y,
        r: big ? 22 : 15,
        hp,
        maxHp,
        alive: true,
        downTimer: 0,
        pierceResist: big ? 1 : 0,
        hitFlash: 0,
        revealTimer: 0,
        slowT: 0,
        slowMult: 1,
        big: !!big,
        squad: sq,
        slot: 0,
        atkTimer: 0,
        ramming: false,
        speed: 0,
        atk: 0,
        ramDamage: 0,
        xp: 0,
        lastHitTeam: -1,
      } as Minion);
    o.hp = hp;
    o.maxHp = maxHp;
    o.ramming = !!(flags & 2);
    o.downTimer = flags & 4 ? 0.1 : 0;
    o.hitFlash = flags & 8 ? 0.1 : 0;
    o.atkTimer = atk / 100;
    return o;
  }

  private giant(a: Ent, g?: Giant): Giant {
    const [id, team, type, x, y, hp, maxHp, flags, swing, lane, soulId] = a as (number & string)[];
    const def = GIANTS[type as unknown as GiantType];
    const o: Giant =
      g ??
      ({
        id,
        kind: 'giant',
        team,
        x,
        y,
        r: def.radius,
        hp,
        maxHp,
        alive: true,
        downTimer: 0,
        pierceResist: 5,
        hitFlash: 0,
        revealTimer: 0,
        slowT: 0,
        slowMult: 1,
        def,
        soul: SOUL_BY_ID[soulId as unknown as string] ?? { id: '', name: '', giantType: def.type },
        lane,
        atkTimer: 0,
        downImmune: 0,
        state: 'walk',
        swing: 0,
      } as unknown as Giant);
    o.hp = hp as number;
    o.maxHp = maxHp as number;
    o.downTimer = (flags as number) & 1 ? 0.1 : 0;
    o.hitFlash = (flags as number) & 2 ? 0.1 : 0;
    o.swing = (swing as number) / 10;
    return o;
  }

  private base(a: Ent) {
    const [id, hp, alive, gs, gt, oa, hf] = a as number[];
    const b = this.world.bases.find((x) => x.id === id) as Base | undefined;
    if (!b) return;
    b.hp = hp;
    b.alive = !!alive;
    b.hitFlash = hf ? 0.1 : 0;
    if (b.gate && gs) {
      b.gate.state = gs === 1 ? 'closed' : gs === 2 ? 'opening' : 'open';
      b.gate.timer = gt / 10;
      b.gate.openedAt = oa >= 0 ? oa / 100 : undefined;
    }
  }

  private shot(a: Ent, p?: DrawProjectile): DrawProjectile {
    const [id, team, x, y, width, color, crossed] = a as (number & string)[];
    const o =
      p ??
      ({ id, team, x, y, width, color, crossed: !!crossed, history: [], alive: true } as unknown as DrawProjectile);
    o.width = width as number;
    o.crossed = !!crossed;
    if (!p) {
      o.x = x as number;
      o.y = y as number;
    }
    return o;
  }

  private lob(a: Ent, l?: LobShell): LobShell {
    const [id, team, x0, y0, tx, ty, T, radius, color, t] = a as (number & string)[];
    const o = l ?? ({ id, team, alive: true } as unknown as LobShell);
    Object.assign(o, { x0, y0, tx, ty, T: (T as number) / 100, radius, color, t: Math.max(o.t ?? 0, (t as number) / 100) });
    return o;
  }

  private straight(a: Ent, s?: StraightShot): StraightShot {
    const [id, team, x, y, vx, vy] = a as number[];
    const o = s ?? ({ id, team: team as Team, x, y, alive: true } as unknown as StraightShot);
    o.vx = vx;
    o.vy = vy;
    return o;
  }

  private bolt(a: Ent, b?: Bolt): Bolt {
    const [id, team, x, y] = a as number[];
    return b ?? ({ id, team: team as Team, x, y, alive: true } as unknown as Bolt);
  }

  private orb(a: Ent, o?: XpOrb): XpOrb {
    const [id, team, x, y, value] = a as number[];
    const r = o ?? ({ id, team: team as Team, x, y, value, t: 15, alive: true, magnet: -1 } as XpOrb);
    r.value = value;
    return r;
  }

  private trail(a: Ent, t?: Trail): Trail {
    if (t) return t;
    const [id, team, ownerId, crossed, color, ...flat] = a as (number & string)[];
    const pts: Vec[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i] as number, y: flat[i + 1] as number });
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { id: id as number, team: team as Team, ownerId: ownerId as number, pts, t: CROSS.trailLifeSec, crossed: !!crossed, bbox: { x0, y0, x1, y1 }, color: color as string };
  }

  private ping(a: Ent, p?: Ping): Ping & { id: number } {
    const [id, team, kind, x, y] = a as (number & string)[];
    const o = (p as Ping & { id: number }) ?? ({ id, team, kind: kind as PingKind, x, y, t: 4 } as unknown as Ping & { id: number });
    o.x = x as number;
    o.y = y as number;
    return o;
  }

  // ---- イベント（演出）を元の形に戻す ----
  private event(ev: NetEvent) {
    const w = this.world;
    const hero = (id: number) => w.heroes.find((h) => h.id === id);
    switch (ev.t) {
      case 'damage':
        this.events.push({ type: 'damage', x: ev.x, y: ev.y, amount: ev.a, team: ev.team, fx: ev.fx as never, big: ev.big, targetId: ev.tid });
        break;
      case 'blast':
        this.events.push({ type: 'blast', x: ev.x, y: ev.y, r: ev.r, team: ev.team });
        break;
      case 'sweep':
        this.events.push({ type: 'sweep', x: ev.x, y: ev.y, dx: ev.dx, dy: ev.dy, team: ev.team });
        break;
      case 'ram':
        this.events.push({ type: 'ram', x: ev.x, y: ev.y, team: ev.team });
        break;
      case 'heal':
        this.events.push({ type: 'heal', x: ev.x, y: ev.y, amount: ev.a, team: ev.team });
        break;
      case 'chain': {
        const h = hero(ev.hid);
        if (h) this.events.push({ type: 'chain', hero: h, count: ev.n, xp: ev.xp });
        break;
      }
      case 'cross': {
        const h = hero(ev.hid);
        if (h) this.events.push({ type: 'cross', hero: h, x: ev.x, y: ev.y, solo: ev.solo });
        break;
      }
      case 'levelUp':
        this.events.push({ type: 'levelUp', team: ev.team, level: ev.lv });
        break;
      case 'heroKilled': {
        const h = hero(ev.hid);
        if (h) this.events.push({ type: 'heroKilled', hero: h, by: { team: ev.by, kind: 'hero' } });
        break;
      }
      case 'baseDestroyed': {
        const b = w.bases.find((x) => x.id === ev.bid);
        if (b) {
          b.alive = false;
          w.refreshWalls();
          this.events.push({ type: 'baseDestroyed', base: b, by: ev.by });
        }
        break;
      }
      case 'gateOpen': {
        const b = w.bases.find((x) => x.id === ev.bid);
        if (b) this.events.push({ type: 'gateOpen', base: b });
        break;
      }
      case 'soulAnnounce':
        if (SOUL_BY_ID[ev.soul]) this.events.push({ type: 'soulAnnounce', team: ev.team, soul: SOUL_BY_ID[ev.soul], lane: ev.lane as 0 | 1 | 2 });
        break;
      case 'giantSummon': {
        const g = this.giants.get(ev.gid);
        if (g) this.events.push({ type: 'giantSummon', giant: g });
        break;
      }
      case 'giantKilled': {
        const def = GIANTS[ev.type as GiantType];
        this.events.push({ type: 'giantKilled', giant: { team: ev.team, x: ev.x, y: ev.y, def } as unknown as Giant });
        break;
      }
      case 'ping':
        this.events.push({ type: 'ping', team: ev.team, kind: ev.kind as PingKind, x: ev.x, y: ev.y });
        break;
      case 'wonder': {
        const h = hero(ev.hid);
        if (h) this.events.push({ type: 'wonder', hero: h });
        break;
      }
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
