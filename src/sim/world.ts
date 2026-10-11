// シミュレーション本体。描画から独立しており、ヘッドレスでも動く。
import { HERO, MATCH, MINION, XP } from '../config/balance';
import { CASTER_BY_ID } from '../config/casters';
import { LANE_WIDTH, buildWalls, forestAt, type Rect, type WallDef } from '../config/map';
import { ASSIST_BY_ID, SOUL_BY_ID } from '../config/assists';
import type { Loadout, SkillDef, StatKey, Team } from '../config/types';
import { createBases, startGateOpening, updateGate, type Base } from './bases';
import type { DamageSource, HitOpts } from './combat';
import { dist2, makeRng, type Rng } from './geom';
import { MatchState } from './gauge';
import { castSkill, castWonder } from './effects';
import { SpatialGrid } from './grid';
import { updateSpawns, updateSquads } from './minions';
import { makeBolt, updateBolts, type Bolt } from './projectiles/bolt';
import {
  updateDrawProjectiles,
  updateLobs,
  updateStraightShots,
  type DrawProjectile,
  type LobShell,
  type StraightShot,
} from './projectiles/drawshot';
import { Hero, type Buff } from './units/hero';
import type { Minion, Mob, Squad } from './units/types';

export type GameEvent =
  | { type: 'gateOpen'; base: Base }
  | { type: 'baseDestroyed'; base: Base; by: Team }
  | { type: 'damage'; x: number; y: number; amount: number; team: Team; fx?: HitOpts['fx']; big?: boolean }
  | { type: 'ram'; x: number; y: number; team: Team }
  | { type: 'blast'; x: number; y: number; r: number; team: Team }
  | { type: 'sweep'; x: number; y: number; dx: number; dy: number; team: Team }
  | { type: 'heroKilled'; hero: Hero; by: DamageSource }
  | { type: 'chain'; hero: Hero; count: number; xp: number }
  | { type: 'heal'; x: number; y: number; amount: number; team: Team }
  | { type: 'skill'; hero: Hero; skill: SkillDef }
  | { type: 'wonder'; hero: Hero };

export interface CrossResult {
  crossed: boolean;
  sizeMult: number;
  powerAdd: number;
  speedMult: number;
}

export interface WorldOptions {
  seed?: number;
}

export class World {
  time = 0;
  rng: Rng;
  bases: Base[];
  walls: WallDef[];
  minions: Minion[] = [];
  squads: Squad[] = [];
  bolts: Bolt[] = [];
  heroes: Hero[] = [];
  drawShots: DrawProjectile[] = [];
  lobs: LobShell[] = [];
  straightShots: StraightShot[] = [];
  grid = new SpatialGrid<Mob>();
  events: GameEvent[] = [];
  match = new MatchState();
  spawnTimers: [{ castle: number }, { castle: number }] = [
    { castle: MINION.castleWave.firstAt },
    { castle: MINION.castleWave.firstAt },
  ];
  /** 壁の構成が変わったか（描画のキャッシュ更新用）。 */
  wallsDirty = true;
  private idSeq = 1;
  private activeWallCache: WallDef[] | null = null;

  constructor(opts: WorldOptions = {}) {
    this.rng = makeRng(opts.seed ?? 12345);
    this.walls = buildWalls();
    this.bases = createBases(() => this.nextId());
  }

  nextId() {
    return this.idSeq++;
  }

  emit(e: GameEvent) {
    this.events.push(e);
    if (this.events.length > 2000) this.events.splice(0, 1000);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 壁の中でも有効なもの（扉は対応する手前拠点が壊れると消える）。 */
  activeWalls(): WallDef[] {
    if (!this.activeWallCache) {
      this.activeWallCache = this.walls.filter((w) => !w.door || this.frontBase(w.door.team, w.door.lane)?.alive);
    }
    return this.activeWallCache;
  }

  frontBase(team: Team, lane: number) {
    return this.bases.find((b) => b.tier === 'front' && b.team === team && b.lane === lane);
  }
  deepBase(team: Team, lane: number) {
    return this.bases.find((b) => b.tier === 'deep' && b.team === team && b.lane === lane);
  }
  castle(team: Team) {
    return this.bases.find((b) => b.tier === 'castle' && b.team === team)!;
  }

  *mobs(): Iterable<Mob> {
    yield* this.minions;
    yield* this.heroes;
  }

  addHero(loadout: Loadout, team: Team, isPlayer: boolean, lane: number): Hero {
    const def = CASTER_BY_ID[loadout.casterId];
    const h = new Hero(this, this.nextId(), def, team, loadout, isPlayer, lane);
    this.heroes.push(h);
    return h;
  }

  // ---- 成長（M5/M6 で拡張） ----
  teamLevel(_team: Team): number {
    return 1;
  }
  /** アシスト（チームレベル到達で発動、4枠目は Lv6 以上）とソウルの補正合計。 */
  statMods(h: Hero, key: StatKey): number {
    const lv = this.teamLevel(h.team);
    let sum = 0;
    h.loadout.assistIds.forEach((id, i) => {
      const a = ASSIST_BY_ID[id];
      if (!a || !assistActive(a.requiredLevel, i, lv)) return;
      sum += a.mods[key] ?? 0;
    });
    const soul = SOUL_BY_ID[h.loadout.soulId];
    if (soul?.mods) sum += soul.mods[key] ?? 0;
    return sum;
  }
  castSkill(h: Hero, slot: number, x: number, y: number) {
    castSkill(this, h, slot, x, y);
  }
  castWonder(h: Hero, x: number, y: number) {
    castWonder(this, h, x, y);
  }
  slowMob(m: Mob, mult: number, dur: number) {
    m.slowMult = Math.min(m.slowT > 0 ? m.slowMult : 1, mult);
    m.slowT = Math.max(m.slowT, dur);
  }
  onChainBonus(h: Hero, count: number, xp: number) {
    this.emit({ type: 'chain', hero: h, count, xp });
  }
  addBuff(h: Hero, b: Buff) {
    const ex = h.buffs.find((x) => x.kind === b.kind);
    if (ex) {
      ex.value = b.value;
      ex.t = Math.max(ex.t, b.t);
    } else h.buffs.push({ ...b });
  }

  // ---- クロスドロー（M10 で実装） ----
  checkCross(_h: Hero, _pts: { x: number; y: number }[]): CrossResult {
    return { crossed: false, sizeMult: 1, powerAdd: 0, speedMult: 1 };
  }
  addTrail(_h: Hero, _pts: { x: number; y: number }[], _crossed: boolean) {}

  // ---- 門 ----
  /** team から見て通れない（敵の閉じた門）矩形。 */
  closedGateRects(team: Team): Rect[] {
    const out: Rect[] = [];
    for (const b of this.bases) {
      if (b.team === team || !b.gate || b.gate.state === 'open' || !b.alive) continue;
      out.push({ x: b.gate.x - LANE_WIDTH / 2, y: b.gate.y - 14, w: LANE_WIDTH, h: 28 });
    }
    return out;
  }
  /** 弾が敵の閉じた門に当たるか（門はダメージを通さない）。 */
  blockedByGate(x: number, y: number, team: Team): boolean {
    for (const b of this.bases) {
      if (b.team === team || !b.gate || b.gate.state === 'open' || !b.alive) continue;
      if (Math.abs(x - b.gate.x) < LANE_WIDTH / 2 && Math.abs(y - b.gate.y) < 16) return true;
    }
    return false;
  }

  // ---- 視界 ----
  /** 森の中のユニットは、同じ森の中の敵（観測側）が近くにいない限り見えない。 */
  isVisibleTo(m: Mob, team: Team): boolean {
    if (m.team === team || m.revealTimer > 0) return true;
    const f = forestAt(m.x, m.y);
    if (f < 0) return true;
    let seen = false;
    this.grid.query(m.x, m.y, 420, (o) => {
      if (!seen && o.team === team && forestAt(o.x, o.y) === f) seen = true;
    });
    return seen;
  }

  // ---- 戦闘フック（後続マイルストーンで拡張） ----
  mobInvulnerable(m: Mob): boolean {
    if (m.kind === 'hero') return (m as Hero).isInvulnerable();
    return false;
  }
  modifyIncomingDamage(m: Mob, amount: number, _src: DamageSource): number {
    if (m.kind === 'hero') {
      for (const b of (m as Hero).buffs) if (b.kind === 'guard') amount *= b.value;
    }
    return amount;
  }
  onMobDamaged(m: Mob, dealt: number, src: DamageSource, opts: HitOpts) {
    if (dealt > 0) this.emit({ type: 'damage', x: m.x, y: m.y - m.r, amount: dealt, team: src.team, fx: opts.fx });
  }
  onMobKilled(m: Mob, src: DamageSource, _opts: HitOpts) {
    if (m.kind === 'hero') {
      const h = m as Hero;
      h.die();
      this.match.onHeroKilled(h.team);
      const killer = this.heroes.find((x) => x.id === src.heroId);
      if (killer) killer.kills++;
      this.emit({ type: 'heroKilled', hero: h, by: src });
    }
  }
  applyDown(m: Mob) {
    const dur = m.kind === 'minion' ? MINION.downSec : HERO.downSec;
    m.downTimer = Math.max(m.downTimer, dur);
  }
  onBaseDamaged(b: Base, dealt: number, src: DamageSource) {
    this.match.onBaseDamaged(b, dealt);
    if (dealt > 0) this.emit({ type: 'damage', x: b.x, y: b.y - b.r, amount: dealt, team: src.team, big: true });
  }
  onMinionRammed(m: Minion, _b: Base) {
    this.emit({ type: 'ram', x: m.x, y: m.y, team: m.team });
  }

  spawnBolt(from: Mob, target: Mob, damage: number) {
    this.bolts.push(makeBolt(from, target, damage));
  }

  /** 拠点の破壊処理。 */
  destroyBase(b: Base, src?: DamageSource) {
    if (!b.alive || b.tier === 'castle') return;
    b.alive = false;
    b.hp = 0;
    b.destroyedAt = this.time;
    this.wallsDirty = true;
    this.activeWallCache = null;
    if (b.tier === 'front') {
      const deep = this.deepBase(b.team, b.lane);
      if (deep) startGateOpening(deep);
    }
    this.match.onBaseDestroyed(b);
    this.emit({ type: 'baseDestroyed', base: b, by: src?.team ?? ((1 - b.team) as Team) });
  }

  get ended() {
    return this.match.result !== null;
  }

  step(dt = MATCH.fixedDt) {
    if (this.ended) return;
    this.time += dt;
    this.match.tick(dt);
    this.grid.rebuild(this.mobs());
    updateSpawns(this, dt);
    for (const m of this.minions) {
      if (m.downTimer > 0) m.downTimer -= dt;
      if (m.hitFlash > 0) m.hitFlash -= dt;
      if (m.revealTimer > 0) m.revealTimer -= dt;
      if (m.slowT > 0) m.slowT -= dt;
    }
    updateSquads(this, dt);
    for (const h of this.heroes) h.update(dt);
    updateBolts(this, this.bolts, dt);
    updateDrawProjectiles(this, this.drawShots, dt);
    updateLobs(this, this.lobs, dt);
    updateStraightShots(this, this.straightShots, dt);
    this.bolts = this.bolts.filter((b) => b.alive);
    this.drawShots = this.drawShots.filter((p) => p.alive);
    this.lobs = this.lobs.filter((p) => p.alive);
    this.straightShots = this.straightShots.filter((p) => p.alive);
    this.minions = this.minions.filter((m) => m.alive);
    for (const b of this.bases) {
      if (b.hitFlash > 0) b.hitFlash -= dt;
      if (updateGate(b, dt)) {
        b.spawnTimer = 0;
        b.spawnCount = 0;
        this.emit({ type: 'gateOpen', base: b });
      }
    }
  }

  /** ユーティリティ：最も近い敵ユニット。 */
  nearestEnemy(x: number, y: number, team: Team, range: number, filter?: (m: Mob) => boolean): Mob | undefined {
    let best: Mob | undefined;
    let bd = range * range;
    this.grid.query(x, y, range, (m) => {
      if (m.team === team || !m.alive || !this.isVisibleTo(m, team)) return;
      if (filter && !filter(m)) return;
      const d = dist2(x, y, m.x, m.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    });
    return best;
  }
}

/** アシストが発動しているか。index 3（4枠目）は Lv6 以上が条件。 */
export function assistActive(requiredLevel: number, slotIndex: number, teamLevel: number): boolean {
  if (slotIndex >= 3 && teamLevel < XP.assistLv4Slot) return false;
  return teamLevel >= requiredLevel;
}
