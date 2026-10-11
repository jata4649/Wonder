// シミュレーション本体。描画から独立しており、ヘッドレスでも動く。
import { MATCH } from '../config/balance';
import { buildWalls, type WallDef } from '../config/map';
import type { Team } from '../config/types';
import { createBases, startGateOpening, updateGate, type Base } from './bases';
import { makeRng, type Rng } from './geom';

export type GameEvent =
  | { type: 'gateOpen'; base: Base }
  | { type: 'baseDestroyed'; base: Base };

export interface WorldOptions {
  seed?: number;
}

export class World {
  time = 0;
  rng: Rng;
  bases: Base[];
  walls: WallDef[];
  events: GameEvent[] = [];
  private idSeq = 1;

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
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 壁の中でも有効なもの（扉は対応する手前拠点が壊れると消える）。 */
  activeWalls(): WallDef[] {
    return this.walls.filter((w) => !w.door || this.frontBase(w.door.team, w.door.lane)?.alive);
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

  /** 拠点の破壊処理（ゲージ等は M3 で追加）。 */
  destroyBase(b: Base) {
    if (!b.alive || b.tier === 'castle') return;
    b.alive = false;
    b.hp = 0;
    b.destroyedAt = this.time;
    this.wallsDirty = true;
    if (b.tier === 'front') {
      const deep = this.deepBase(b.team, b.lane);
      if (deep) startGateOpening(deep);
    }
    this.emit({ type: 'baseDestroyed', base: b });
  }

  /** 壁の構成が変わったか（描画のキャッシュ更新用）。 */
  wallsDirty = true;

  step(dt = MATCH.fixedDt) {
    this.time += dt;
    for (const b of this.bases) {
      if (b.hitFlash > 0) b.hitFlash -= dt;
      if (updateGate(b, dt)) this.emit({ type: 'gateOpen', base: b });
    }
  }
}
