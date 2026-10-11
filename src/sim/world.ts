// シミュレーション本体。描画から独立しており、ヘッドレスでも動く。
import { MATCH, MINION } from '../config/balance';
import { buildWalls, forestAt, type WallDef } from '../config/map';
import type { Team } from '../config/types';
import { createBases, startGateOpening, updateGate, type Base } from './bases';
import type { DamageSource, HitOpts } from './combat';
import { dist2, makeRng, type Rng } from './geom';
import { SpatialGrid } from './grid';
import { updateSpawns, updateSquads } from './minions';
import { makeBolt, updateBolts, type Bolt } from './projectiles/bolt';
import type { Minion, Mob, Squad } from './units/types';

export type GameEvent =
  | { type: 'gateOpen'; base: Base }
  | { type: 'baseDestroyed'; base: Base; by: Team }
  | { type: 'damage'; x: number; y: number; amount: number; team: Team; fx?: HitOpts['fx']; big?: boolean }
  | { type: 'ram'; x: number; y: number; team: Team };

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
  grid = new SpatialGrid<Mob>();
  events: GameEvent[] = [];
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
  mobInvulnerable(_m: Mob): boolean {
    return false;
  }
  modifyIncomingDamage(_m: Mob, amount: number, _src: DamageSource): number {
    return amount;
  }
  onMobDamaged(m: Mob, dealt: number, src: DamageSource, opts: HitOpts) {
    if (dealt > 0) this.emit({ type: 'damage', x: m.x, y: m.y - m.r, amount: dealt, team: src.team, fx: opts.fx });
  }
  onMobKilled(_m: Mob, _src: DamageSource, _opts: HitOpts) {}
  applyDown(m: Mob) {
    const dur = m.kind === 'minion' ? MINION.downSec : 0.6;
    m.downTimer = Math.max(m.downTimer, dur);
  }
  onBaseDamaged(b: Base, dealt: number, src: DamageSource) {
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
    this.emit({ type: 'baseDestroyed', base: b, by: src?.team ?? ((1 - b.team) as Team) });
  }

  step(dt = MATCH.fixedDt) {
    this.time += dt;
    this.grid.rebuild(this.mobs());
    updateSpawns(this, dt);
    for (const m of this.minions) {
      if (m.downTimer > 0) m.downTimer -= dt;
      if (m.hitFlash > 0) m.hitFlash -= dt;
      if (m.revealTimer > 0) m.revealTimer -= dt;
    }
    updateSquads(this, dt);
    updateBolts(this, this.bolts, dt);
    this.bolts = this.bolts.filter((b) => b.alive);
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
