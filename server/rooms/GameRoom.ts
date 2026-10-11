// 1試合 = 1ルーム。サーバー権威：30Hz の tick ループ、入力の検証、スナップショット配信、
// 切断時の AI 引き継ぎ（30秒以内の再接続で元に戻す）、1分遅延の観戦配信。
import { createMatch, type AIDirector, type SlotSpec } from '../../shared/ai/setup';
import type { Difficulty, Loadout, Team } from '../../shared/config/types';
import { NET, type InputCmd, type RosterEntry, type ServerMsg, type SnapshotMsg } from '../../shared/net/protocol';
import { DeltaEncoder, buildSnapshot, serializeWorld, toNetEvents, type Viewer } from '../../shared/net/snapshot';
import type { Hero } from '../../shared/sim/units/hero';
import { World, type GameEvent } from '../../shared/sim/world';
import { validateInput, type RejectReason } from '../validation/validate';

export interface Conn {
  send(msg: ServerMsg): void;
  close?(): void;
  /** テスト用：受信遅延の注入など */
  readonly id: string;
}

export interface SeatPlayer {
  token: string;
  name: string;
  loadout: Loadout;
  team: Team;
  conn: Conn;
  mmr: number;
}

interface Seat {
  token: string | null; // null = 最初から CPU
  name: string;
  hero: Hero;
  team: Team;
  conn: Conn | null;
  queue: InputCmd[];
  lastSeq: number;
  lastMove: { x: number; y: number };
  rttMs: number;
  enc: DeltaEncoder;
  disconnectedAt: number | null;
  /** 30秒を過ぎて最後まで AI */
  aiForever: boolean;
  mmr: number;
  rejects: Record<RejectReason | 'clamped', number>;
}

interface Spectator {
  conn: Conn;
  enc: DeltaEncoder;
  cursor: number;
}

/** 観戦用の遅延バッファ（全員分の状態を視点なしで保存し、60秒遅れで配信）。 */
interface DelayedFrame {
  st: number;
  tick: number;
  meta: Omit<SnapshotMsg, 'e' | 'ack' | 'k'>;
  ents: ReturnType<typeof serializeWorld>;
  ev: ReturnType<typeof toNetEvents>;
}

export interface RoomOptions {
  id: string;
  mode: 'coop' | 'quick' | 'room';
  players: SeatPlayer[];
  /** CPU で埋める人数（チームごとに 4 になるまで）。 */
  difficulty: Difficulty;
  seed?: number;
  now?: () => number;
  /** スナップショットのログ（テスト用） */
  onEnd?: (room: GameRoom) => void;
}

export class GameRoom {
  readonly id: string;
  readonly mode: RoomOptions['mode'];
  world: World;
  director: AIDirector;
  seats: Seat[] = [];
  spectators: Spectator[] = [];
  tick = 0;
  ended = false;
  private delayed: DelayedFrame[] = [];
  private now: () => number;
  private seed: number;
  private onEnd?: (room: GameRoom) => void;
  readonly difficulty: Difficulty;
  readonly startedAt: number;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.now = opts.now ?? (() => Date.now());
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.difficulty = opts.difficulty;
    this.onEnd = opts.onEnd;
    this.world = new World({ seed: this.seed });
    const slots: SlotSpec[] = [];
    for (const team of [0, 1] as Team[]) {
      const humans = opts.players.filter((p) => p.team === team).slice(0, 4);
      for (const p of humans) slots.push({ team, human: true, loadout: p.loadout });
      for (let i = humans.length; i < 4; i++) slots.push({ team, human: false });
    }
    const { heroes, director } = createMatch(this.world, slots, opts.difficulty);
    this.director = director;
    let hi = 0;
    for (const team of [0, 1] as Team[]) {
      const humans = opts.players.filter((p) => p.team === team).slice(0, 4);
      const teamHeroes = heroes.filter((h) => h.team === team);
      teamHeroes.forEach((h, i) => {
        const p = humans[i];
        h.netName = p?.name ?? `CPU${++hi}`;
        this.seats.push({
          token: p?.token ?? null,
          name: p?.name ?? h.netName,
          hero: h,
          team,
          conn: p?.conn ?? null,
          queue: [],
          lastSeq: 0,
          lastMove: { x: 0, y: 0 },
          rttMs: 80,
          enc: new DeltaEncoder(),
          disconnectedAt: null,
          aiForever: false,
          mmr: p?.mmr ?? 1500,
          rejects: { stale: 0, multi: 0, rate: 0, mp: 0, cd: 0, speed: 0, malformed: 0, dead: 0, clamped: 0 },
        });
      });
    }
    this.startedAt = this.now();
    for (const s of this.seats) if (s.conn) this.sendWelcome(s);
  }

  roster(): RosterEntry[] {
    return this.seats.map((s) => ({ id: s.hero.id, team: s.team, name: s.name, human: !!s.token, loadout: s.hero.loadout }));
  }

  private sendWelcome(s: Seat) {
    s.enc.reset();
    s.conn?.send({ k: 'welcome', roomId: this.id, heroId: s.hero.id, team: s.team, seed: this.seed, roster: this.roster(), token: s.token ?? '', spectator: false });
  }

  seatOf(token: string) {
    return this.seats.find((s) => s.token === token);
  }

  /** 空いている CPU 枠（最初から CPU の枠）があるか。途中参加用。 */
  openCpuSeats(team?: Team) {
    return this.seats.filter((s) => s.token === null && (team === undefined || s.team === team));
  }

  /** 途中参加：CPU 枠を人間が引き継ぐ。 */
  joinCpuSeat(p: Omit<SeatPlayer, 'team' | 'loadout'>, team?: Team): Seat | undefined {
    const seat = this.openCpuSeats(team)[0];
    if (!seat) return undefined;
    seat.token = p.token;
    seat.name = p.name;
    seat.conn = p.conn;
    seat.mmr = p.mmr;
    seat.hero.netName = p.name;
    this.director.detach(seat.hero);
    this.sendWelcome(seat);
    return seat;
  }

  // ---- 接続 ----
  onInput(token: string, cmd: InputCmd) {
    const s = this.seatOf(token);
    if (!s || !s.conn || s.aiForever) return;
    s.queue.push(cmd);
    // 溜まりすぎたら古い入力の「移動」だけ捨てる（発動は残す）
    while (s.queue.length > NET.maxQueuedInputs) {
      const old = s.queue.shift()!;
      if (old.buttons && s.queue.length) s.queue[0] = { ...s.queue[0], buttons: s.queue[0].buttons || old.buttons, draw: s.queue[0].draw ?? old.draw, aim: s.queue[0].aim ?? old.aim, card: s.queue[0].card ?? old.card, dir: s.queue[0].dir ?? old.dir };
    }
  }

  onPing(token: string, rttMs: number) {
    const s = this.seatOf(token);
    if (s) s.rttMs = s.rttMs * 0.7 + rttMs * 0.3;
  }

  /** 切断：その枠を即座に AI が引き継ぐ。 */
  disconnect(token: string) {
    const s = this.seatOf(token);
    if (!s || !s.conn) return;
    s.conn = null;
    s.queue = [];
    s.disconnectedAt = this.now();
    this.director.attach(s.hero, 'normal');
    this.broadcastNotice(`${s.name} が切断しました（AIが引き継ぎます）`);
  }

  /** 再接続：30秒以内なら元のキャストに戻す。 */
  reconnect(token: string, conn: Conn): boolean {
    const s = this.seatOf(token);
    if (!s || s.aiForever || s.disconnectedAt === null) return false;
    if (this.now() - s.disconnectedAt > NET.reconnectMs) return false;
    s.conn = conn;
    s.disconnectedAt = null;
    s.lastSeq = 0;
    this.director.detach(s.hero);
    this.sendWelcome(s);
    this.broadcastNotice(`${s.name} が復帰しました`);
    return true;
  }

  addSpectator(conn: Conn) {
    const sp: Spectator = { conn, enc: new DeltaEncoder(), cursor: 0 };
    this.spectators.push(sp);
    conn.send({ k: 'welcome', roomId: this.id, heroId: -1, team: 0, seed: this.seed, roster: this.roster(), token: '', spectator: true });
    conn.send({ k: 'notice', msg: `観戦：${NET.spectateDelayMs / 1000}秒遅れで配信します` });
  }

  removeConn(conn: Conn) {
    this.spectators = this.spectators.filter((s) => s.conn !== conn);
  }

  private broadcastNotice(msg: string) {
    for (const s of this.seats) s.conn?.send({ k: 'notice', msg });
  }

  // ---- tick ----
  /** 30Hz で呼ぶ。シミュレーション2ステップ（1/60×2）。 */
  step() {
    if (this.ended) return;
    const now = this.now();
    this.tick++;
    // 入力の適用（1 tick につき1入力）
    for (const s of this.seats) {
      if (s.disconnectedAt !== null && !s.aiForever && now - s.disconnectedAt > NET.reconnectMs) {
        s.aiForever = true; // 最後まで AI
      }
      if (!s.conn) continue;
      const h = s.hero;
      const cmd = s.queue.shift();
      if (!cmd) {
        // 入力が届いていない tick は直前の移動を続ける
        h.moveX = s.lastMove.x;
        h.moveY = s.lastMove.y;
        continue;
      }
      const lagMs = s.rttMs / 2 + NET.interpMs;
      const r = validateInput(cmd, h, { lastSeq: s.lastSeq, actedThisTick: false, lagMs: lagMs <= 300 ? lagMs : 0 });
      if (r.reject !== 'stale') s.lastSeq = Math.max(s.lastSeq, cmd.seq);
      if (r.reject) s.rejects[r.reject]++;
      if (r.clamped) s.rejects.clamped++;
      s.lastMove = r.move;
      h.moveX = r.move.x;
      h.moveY = r.move.y;
      if (r.cmd) h.cmds.push(r.cmd);
    }
    const evs: GameEvent[] = [];
    for (let i = 0; i < NET.simStepsPerTick; i++) {
      this.world.step(1 / 60);
      // 人間の発動は1ステップ目で処理済み（2ステップ目に持ち越さない）
      evs.push(...this.world.drainEvents());
    }
    this.pendingEvents.push(...evs);
    const sendEvery = Math.round(NET.tickHz / NET.snapshotHz);
    if (this.tick % sendEvery === 0) this.broadcast(now);
    if (this.world.ended && !this.ended) this.finish();
  }

  private pendingEvents: GameEvent[] = [];

  private broadcast(now: number) {
    const evs = this.pendingEvents;
    this.pendingEvents = [];
    for (const s of this.seats) {
      if (!s.conn) continue;
      const v: Viewer = { team: s.team, heroId: s.hero.id, spectator: false };
      s.conn.send(buildSnapshot(this.world, v, s.enc, this.tick, now, s.lastSeq, evs));
    }
    // 観戦：全員視点の状態を保存して、1分遅れで配信
    if (this.spectators.length || this.delayed.length) {
      const v: Viewer = { team: 0, heroId: -1, spectator: true };
      const snap = buildSnapshot(this.world, v, new DeltaEncoder(), this.tick, now, 0, evs);
      const { e: _e, k: _k, ack: _a, ...meta } = snap;
      this.delayed.push({ st: now, tick: this.tick, meta, ents: serializeWorld(this.world, v), ev: snap.ev ?? [] });
      this.flushSpectators(now);
    }
  }

  private flushSpectators(now: number) {
    while (this.delayed.length && now - this.delayed[0].st >= NET.spectateDelayMs) {
      const f = this.delayed.shift()!;
      for (const sp of this.spectators) {
        sp.conn.send({ k: 'snap', ...f.meta, ack: 0, e: sp.enc.diff(f.ents), ev: f.ev });
      }
    }
    if (!this.spectators.length) {
      // 観戦者がいなくても、途中から来た人のために直近1分は保持
      while (this.delayed.length && now - this.delayed[0].st > NET.spectateDelayMs + 2000) this.delayed.shift();
    }
  }

  private finish() {
    this.ended = true;
    this.broadcast(this.now());
    this.onEnd?.(this);
  }

  /** テスト・管理用：拒否された入力の数。 */
  rejectsOf(token: string) {
    return this.seatOf(token)?.rejects;
  }
}
