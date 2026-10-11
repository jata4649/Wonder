// マッチメイキング（SPEC 8.6）。
// - 内部レート（MMR）が近い人を優先して最大8人を集める。待ち時間が延びるほど許容幅を広げる。
// - 待機上限30秒。集まらなければ CPU で補充して開始。補充枠には後から人間が入れる。
// - パーティ（2〜4人）は同一チーム。
// - 協力（人間は全員味方＋CPU）、ルーム対戦（コード＋任意のパスワード）、観戦（1分遅延）。
import type { Difficulty, Loadout, Team } from '../../shared/config/types';
import { NET, type HelloMsg } from '../../shared/net/protocol';
import { GameRoom, type Conn, type SeatPlayer } from '../rooms/GameRoom';
import { MmrStore } from './mmr';

export interface Ticket {
  conn: Conn;
  token: string;
  name: string;
  loadout: Loadout;
  party?: string;
  mmr: number;
  at: number;
}

interface PrivateRoom {
  code: string;
  password?: string;
  hostToken: string;
  members: Ticket[];
}

export class Matchmaker {
  queue: Ticket[] = [];
  rooms = new Map<string, GameRoom>();
  privateRooms = new Map<string, PrivateRoom>();
  private seq = 1;
  private now: () => number;
  /** トークン → 参加中の部屋 */
  private where = new Map<string, GameRoom>();

  constructor(
    public mmr: MmrStore,
    opts: { now?: () => number; difficulty?: Difficulty } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.difficulty = opts.difficulty ?? 'normal';
  }
  difficulty: Difficulty;

  roomOf(token: string) {
    return this.where.get(token);
  }

  /** 参加要求の振り分け。 */
  hello(conn: Conn, msg: HelloMsg) {
    const token = msg.token;
    // 再接続（30秒以内なら元のキャストに戻る）
    const prev = this.where.get(token);
    if (prev && !prev.ended && prev.reconnect(token, conn)) return;
    const t: Ticket = { conn, token, name: (msg.name || 'プレイヤー').slice(0, 12), loadout: msg.loadout, party: msg.party, mmr: this.mmr.get(token), at: this.now() };
    switch (msg.mode) {
      case 'coop':
        return this.startCoop(t, msg.difficulty ?? this.difficulty);
      case 'quick':
        if (this.lateJoin(t)) return;
        this.queue.push(t);
        this.status();
        return;
      case 'room':
        return this.joinPrivate(t, msg.room);
      case 'spectate': {
        const room = (msg.watch && this.rooms.get(msg.watch)) || [...this.rooms.values()].reverse().find((r) => !r.ended);
        if (!room) return conn.send({ k: 'error', msg: '観戦できる試合がありません' });
        room.addSpectator(conn);
        return;
      }
    }
  }

  leave(token: string, conn: Conn) {
    this.queue = this.queue.filter((t) => t.token !== token);
    for (const pr of this.privateRooms.values()) {
      pr.members = pr.members.filter((m) => m.token !== token);
      if (!pr.members.length) this.privateRooms.delete(pr.code);
    }
    const room = this.where.get(token);
    if (room && !room.ended) room.disconnect(token);
    for (const r of this.rooms.values()) r.removeConn(conn);
  }

  private newRoomId() {
    return `R${(this.seq++).toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
  }

  private createRoom(mode: GameRoom['mode'], players: SeatPlayer[], difficulty: Difficulty) {
    const room = new GameRoom({
      id: this.newRoomId(),
      mode,
      players,
      difficulty,
      now: this.now,
      onEnd: (r) => this.onRoomEnd(r),
    });
    this.rooms.set(room.id, room);
    for (const p of players) this.where.set(p.token, room);
    return room;
  }

  private seat(t: Ticket, team: Team): SeatPlayer {
    return { token: t.token, name: t.name, loadout: t.loadout, team, conn: t.conn, mmr: t.mmr };
  }

  // ---- 協力 ----
  private startCoop(t: Ticket, difficulty: Difficulty) {
    // 同じパーティの待機者がいれば一緒に（最大4人）
    const mates = t.party ? this.queue.filter((q) => q.party === t.party).slice(0, 3) : [];
    this.queue = this.queue.filter((q) => !mates.includes(q));
    this.createRoom('coop', [t, ...mates].map((m) => this.seat(m, 0)), difficulty);
  }

  // ---- 途中参加（CPU 補充枠） ----
  private lateJoin(t: Ticket): boolean {
    if (t.party) return false;
    for (const room of this.rooms.values()) {
      if (room.ended || room.mode !== 'quick') continue;
      if (room.world.match.timeLeft < 180) continue;
      const seat = room.joinCpuSeat({ token: t.token, name: t.name, conn: t.conn, mmr: t.mmr });
      if (seat) {
        this.where.set(t.token, room);
        return true;
      }
    }
    return false;
  }

  /** 1秒ごとに呼ぶ：レートが近い人で部屋を作る／30秒経ったら CPU 補充で開始。 */
  update(): void {
    if (!this.queue.length) return;
    const now = this.now();
    this.queue.sort((a, b) => a.mmr - b.mmr);
    // 8人揃うグループを探す（待ち時間に応じて許容幅を広げる）
    const width = (t: Ticket) => 100 + (now - t.at) / 1000 * 25;
    for (let i = 0; i + 8 <= this.queue.length; i++) {
      const group = this.queue.slice(i, i + 8);
      const spread = group[7].mmr - group[0].mmr;
      if (spread <= Math.min(...group.map(width))) {
        this.startQuick(group);
        return this.update();
      }
    }
    // 一番長く待っている人が上限を超えたら、レートの近い人を集めて CPU で補充
    const oldest = this.queue.reduce((a, b) => (a.at < b.at ? a : b));
    if (now - oldest.at >= NET.matchWaitMs) {
      const near = [...this.queue].sort((a, b) => Math.abs(a.mmr - oldest.mmr) - Math.abs(b.mmr - oldest.mmr)).slice(0, 8);
      this.startQuick(near);
      return this.update();
    }
    this.status();
  }

  /** チーム分け：パーティは同じチーム、残りはレートが均等になるように交互に。 */
  splitTeams(group: Ticket[]): [Ticket[], Ticket[]] {
    const teams: [Ticket[], Ticket[]] = [[], []];
    const sum = (ts: Ticket[]) => ts.reduce((a, t) => a + t.mmr, 0);
    const parties = new Map<string, Ticket[]>();
    const solos: Ticket[] = [];
    for (const t of group) {
      if (t.party) {
        if (!parties.has(t.party)) parties.set(t.party, []);
        parties.get(t.party)!.push(t);
      } else solos.push(t);
    }
    const blocks = [...parties.values(), ...solos.map((s) => [s])].sort((a, b) => b.length - a.length || sum(b) - sum(a));
    for (const b of blocks) {
      const fit = ([0, 1] as const).filter((k) => teams[k].length + b.length <= 4);
      if (!fit.length) continue;
      const k = fit.length === 2 ? (sum(teams[0]) <= sum(teams[1]) ? 0 : 1) : fit[0];
      teams[k].push(...b);
    }
    return teams;
  }

  private startQuick(group: Ticket[]) {
    this.queue = this.queue.filter((q) => !group.includes(q));
    const [a, b] = this.splitTeams(group);
    this.createRoom('quick', [...a.map((t) => this.seat(t, 0)), ...b.map((t) => this.seat(t, 1))], this.difficulty);
  }

  private status() {
    const now = this.now();
    for (const t of this.queue) {
      t.conn.send({ k: 'lobby', mode: 'quick', waiting: this.queue.length, humans: this.queue.length, waitedMs: now - t.at, limitMs: NET.matchWaitMs });
    }
  }

  // ---- ルーム対戦 ----
  private joinPrivate(t: Ticket, room?: HelloMsg['room']) {
    const code = (room?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return t.conn.send({ k: 'error', msg: 'ルームコードを入力してください' });
    let pr = this.privateRooms.get(code);
    if (!pr) {
      pr = { code, password: room?.password || undefined, hostToken: t.token, members: [] };
      this.privateRooms.set(code, pr);
    } else if (pr.password && pr.password !== room?.password) {
      return t.conn.send({ k: 'error', msg: 'パスワードが違います' });
    }
    if (pr.members.length >= 8) return t.conn.send({ k: 'error', msg: 'ルームが満員です' });
    pr.members.push(t);
    this.privateStatus(pr);
    if (pr.members.length === 8) this.startPrivate(pr);
  }

  /** ホストが開始（足りない枠は CPU）。 */
  startPrivateBy(token: string) {
    for (const pr of this.privateRooms.values()) {
      if (pr.hostToken === token && pr.members.length) return this.startPrivate(pr);
    }
  }

  private startPrivate(pr: PrivateRoom) {
    this.privateRooms.delete(pr.code);
    const [a, b] = this.splitTeams(pr.members);
    this.createRoom('room', [...a.map((t) => this.seat(t, 0)), ...b.map((t) => this.seat(t, 1))], this.difficulty);
  }

  private privateStatus(pr: PrivateRoom) {
    for (const m of pr.members) {
      m.conn.send({ k: 'lobby', mode: 'room', waiting: pr.members.length, humans: pr.members.length, waitedMs: 0, limitMs: 0, roomCode: pr.code, host: m.token === pr.hostToken });
    }
  }

  // ---- 試合終了：レート更新 ----
  private onRoomEnd(room: GameRoom) {
    const res = room.world.match.result;
    const humans = room.seats.filter((s) => s.token);
    if (res && room.mode !== 'coop') {
      const avg = (team: Team) => {
        const ss = room.seats.filter((s) => s.team === team);
        return ss.reduce((a, s) => a + (s.token ? this.mmr.get(s.token) : 1500), 0) / ss.length;
      };
      for (const s of humans) {
        const score = res.winner === 'draw' ? 0.5 : res.winner === s.team ? 1 : 0;
        const delta = this.mmr.update(s.token!, avg((1 - s.team) as Team), score, {
          basesDestroyed: room.world.match.stats.baseDestroyed[s.team],
          damage: s.hero.dmgHeroes + s.hero.dmgBases,
        });
        s.conn?.send({ k: 'end', mmr: Math.round(this.mmr.get(s.token!)), delta: Math.round(delta) });
      }
    } else {
      for (const s of humans) s.conn?.send({ k: 'end' });
    }
    for (const s of humans) if (this.where.get(s.token!) === room) this.where.delete(s.token!);
    this.endedAt.set(room.id, this.now());
  }
  private endedAt = new Map<string, number>();

  /** 全ルームを1tick進める（終わった部屋は観戦の遅延ぶん残してから片付け）。 */
  tickRooms() {
    const now = this.now();
    for (const r of this.rooms.values()) {
      r.step();
      const e = this.endedAt.get(r.id);
      if (e !== undefined && now - e > NET.spectateDelayMs + 5000) {
        this.rooms.delete(r.id);
        this.endedAt.delete(r.id);
      }
    }
  }
}
