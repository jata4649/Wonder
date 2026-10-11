// スナップショットのシリアライズ（サーバー側）。
// - エンティティは量子化した数値配列。前回送った内容と比べて変わったものだけ送る（差分）。
// - 視点チームから見えない敵（森の中など）は送らない（壁抜けチート対策）。観戦者は全部。
import type { Team } from '../config/types';
import type { Hero } from '../sim/units/hero';
import type { GameEvent, World } from '../sim/world';
import type { Ent, EntDelta, NetEvent, SnapshotMsg } from './protocol';

export interface Viewer {
  team: Team;
  heroId: number; // 観戦者は -1
  spectator: boolean;
}

const STATE_CODE: Record<string, number> = { normal: 0, leap: 1, charge: 2, evade: 3, dead: 4 };
export const STATE_NAME = ['normal', 'leap', 'charge', 'evade', 'dead'] as const;
const GATE_CODE: Record<string, number> = { closed: 1, opening: 2, open: 3 };

const r = Math.round;
const r1 = (v: number) => Math.round(v * 10);
const r2 = (v: number) => Math.round(v * 100);

export function heroEnt(h: Hero, own: boolean, me: boolean): Ent {
  const flags = (h.alive ? 1 : 0) | (h.drawStance ? 2 : 0) | (h.invulnTimer > 0 ? 4 : 0) | (h.hitFlash > 0 ? 8 : 0) | (h.downTimer > 0 ? 16 : 0) | (h.isPlayer ? 32 : 0);
  const buffs = h.buffs.map((b) => `${b.kind}:${r2(b.value)}:${r1(b.t)}`).join(',');
  return [
    h.id,
    r(h.x),
    r(h.y),
    r(h.hp),
    h.maxHp,
    own ? r1(h.mp) : 0,
    STATE_CODE[h.state] ?? 0,
    r(h.z),
    flags,
    r2(h.faceX),
    r2(h.faceY),
    r1(Math.max(0, h.respawnTimer)),
    me ? r1(h.skillCd[0]) : 0,
    me ? r1(h.skillCd[1]) : 0,
    me ? r1(h.skillCd[2]) : 0,
    h.wsUsed ? 1 : 0,
    me ? r1(h.evadeCd) : 0,
    buffs,
    h.kills,
    h.deaths,
    h.lane,
    me && h.notice ? h.notice.text : '',
  ];
}

/** 視点ごとのエンティティ一覧（種類 → 配列）。 */
export function serializeWorld(world: World, v: Viewer): Record<string, Ent[]> {
  const see = (m: { team: Team } & Parameters<World['isVisibleTo']>[0]) => v.spectator || m.team === v.team || world.isVisibleTo(m, v.team);
  const out: Record<string, Ent[]> = { h: [], n: [], g: [], b: [], d: [], l: [], s: [], o: [], x: [], t: [], q: [] };
  for (const h of world.heroes) {
    if (h.alive && !see(h)) continue;
    out.h.push(heroEnt(h, v.spectator || h.team === v.team, h.id === v.heroId));
  }
  for (const m of world.minions) {
    if (!see(m)) continue;
    const flags = (m.squad.formTimer > 0 && !m.ramming ? 1 : 0) | (m.ramming ? 2 : 0) | (m.downTimer > 0 ? 4 : 0) | (m.hitFlash > 0 ? 8 : 0);
    out.n.push([m.id, m.team, m.big ? 1 : 0, r(m.x), r(m.y), r(m.hp), m.maxHp, flags, r2(m.atkTimer)]);
  }
  for (const g of world.giants) {
    if (!see(g)) continue;
    out.g.push([g.id, g.team, g.def.type, r(g.x), r(g.y), r(g.hp), g.maxHp, (g.downTimer > 0 ? 1 : 0) | (g.hitFlash > 0 ? 2 : 0), r1(g.swing), g.lane, g.soul.id]);
  }
  for (const b of world.bases) {
    const g = b.gate;
    out.b.push([b.id, r(b.hp), b.alive ? 1 : 0, g ? GATE_CODE[g.state] : 0, g ? r1(g.timer) : 0, g?.openedAt !== undefined ? r2(g.openedAt) : -1, b.hitFlash > 0 ? 1 : 0]);
  }
  for (const p of world.drawShots) out.d.push([p.id, p.team, r(p.x), r(p.y), r(p.width), p.color, p.crossed ? 1 : 0]);
  for (const s of world.lobs) out.l.push([s.id, s.team, r(s.x0), r(s.y0), r(s.tx), r(s.ty), r2(s.T), r(s.radius), s.color, r2(s.t)]);
  for (const s of world.straightShots) out.s.push([s.id, s.team, r(s.x), r(s.y), r(s.vx), r(s.vy)]);
  for (const b of world.bolts) out.o.push([b.id, b.team, r(b.x), r(b.y)]);
  for (const o of world.orbs) {
    if (!v.spectator && o.team !== v.team) continue; // 相手チームの経験値は見せない（回収できないので）
    out.x.push([o.id, o.team, r(o.x), r(o.y), o.value]);
  }
  for (const t of world.trails) out.t.push([t.id, t.team, t.ownerId, t.crossed ? 1 : 0, t.color, ...t.pts.flatMap((p) => [r(p.x), r(p.y)])]);
  world.pings.forEach((p) => {
    if (!v.spectator && p.team !== v.team) return;
    const kinds = ['gather', 'retreat', 'caution', 'enemy'];
    out.q.push([p.team * 10 + kinds.indexOf(p.kind), p.team, p.kind, r(p.x), r(p.y)]);
  });
  return out;
}

/** 視点ごとに前回送った内容を覚えて、差分だけを作る。 */
export class DeltaEncoder {
  private last = new Map<string, Map<number, string>>();

  /** 全量を送り直す（再接続時など） */
  reset() {
    this.last.clear();
  }

  diff(cur: Record<string, Ent[]>): Record<string, EntDelta> {
    const out: Record<string, EntDelta> = {};
    for (const kind of Object.keys(cur)) {
      const prev = this.last.get(kind) ?? new Map<number, string>();
      const next = new Map<number, string>();
      const u: Ent[] = [];
      for (const e of cur[kind]) {
        const id = e[0] as number;
        const key = JSON.stringify(e);
        next.set(id, key);
        if (prev.get(id) !== key) u.push(e);
      }
      const d: number[] = [];
      for (const id of prev.keys()) if (!next.has(id)) d.push(id);
      this.last.set(kind, next);
      if (u.length || d.length) out[kind] = { ...(u.length ? { u } : {}), ...(d.length ? { d } : {}) };
    }
    return out;
  }
}

/** ゲームイベントを、視点チームに合わせて送れる形にする。 */
export function toNetEvents(evs: GameEvent[], v: Viewer): NetEvent[] {
  const out: NetEvent[] = [];
  for (const e of evs) {
    switch (e.type) {
      case 'damage':
        out.push({ t: 'damage', x: r(e.x), y: r(e.y), a: r(e.amount), team: e.team, fx: e.fx, big: e.big, tid: e.targetId });
        break;
      case 'blast':
        out.push({ t: 'blast', x: r(e.x), y: r(e.y), r: r(e.r), team: e.team });
        break;
      case 'sweep':
        out.push({ t: 'sweep', x: r(e.x), y: r(e.y), dx: e.dx, dy: e.dy, team: e.team });
        break;
      case 'ram':
        out.push({ t: 'ram', x: r(e.x), y: r(e.y), team: e.team });
        break;
      case 'heal':
        out.push({ t: 'heal', x: r(e.x), y: r(e.y), a: r(e.amount), team: e.team });
        break;
      case 'chain':
        out.push({ t: 'chain', hid: e.hero.id, n: e.count, xp: Math.round(e.xp * 10) / 10 });
        break;
      case 'cross':
        out.push({ t: 'cross', hid: e.hero.id, x: r(e.x), y: r(e.y), solo: e.solo });
        break;
      case 'levelUp':
        out.push({ t: 'levelUp', team: e.team, lv: e.level });
        break;
      case 'heroKilled':
        out.push({ t: 'heroKilled', hid: e.hero.id, by: e.by.team });
        break;
      case 'baseDestroyed':
        out.push({ t: 'baseDestroyed', bid: e.base.id, by: e.by });
        break;
      case 'gateOpen':
        out.push({ t: 'gateOpen', bid: e.base.id });
        break;
      case 'soulAnnounce':
        // 召喚予告は自軍のみ見える
        if (v.spectator || e.team === v.team) out.push({ t: 'soulAnnounce', team: e.team, soul: e.soul.id, lane: e.lane });
        break;
      case 'giantSummon':
        out.push({ t: 'giantSummon', gid: e.giant.id });
        break;
      case 'giantKilled':
        out.push({ t: 'giantKilled', team: e.giant.team, type: e.giant.def.type, x: r(e.giant.x), y: r(e.giant.y) });
        break;
      case 'ping':
        if (v.spectator || e.team === v.team) out.push({ t: 'ping', team: e.team, kind: e.kind, x: r(e.x), y: r(e.y) });
        break;
      case 'wonder':
        out.push({ t: 'wonder', hid: e.hero.id });
        break;
      default:
        break;
    }
  }
  return out;
}

/** スナップショット本体（視点ごと）。 */
export function buildSnapshot(world: World, v: Viewer, enc: DeltaEncoder, tick: number, st: number, ack: number, evs: GameEvent[]): SnapshotMsg {
  const m = world.match;
  const res = m.result;
  const st0 = world.soul.teams[v.team];
  const st1 = world.soul.teams[(1 - v.team) as Team];
  const soul = (s: typeof st0) => [r1(s.gauge), s.announced?.soul.id ?? '', s.announced?.lane ?? -1];
  const ev = toNetEvents(evs, v);
  return {
    k: 'snap',
    tick,
    st,
    wt: Math.round(world.time * 1000) / 1000,
    ack,
    m: [r1(m.timeLeft), r1(m.gauge[0]), r1(m.gauge[1]), res ? (res.winner === 'draw' ? 2 : res.winner) : -1, res?.reason === 'time' ? 1 : 0],
    p: [r1(world.progress[0].xp), world.progress[0].level, r1(world.progress[1].xp), world.progress[1].level],
    s: soul(st0),
    ...(v.spectator ? { s2: soul(st1) } : {}),
    fz: world.freezeT > 0 ? 1 : 0,
    e: enc.diff(serializeWorld(world, v)),
    ...(ev.length ? { ev } : {}),
  };
}
