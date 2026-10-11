// ドローショット（軌道弾/投擲弾）とストレートショット。
// 軌道弾：描いた軌跡に沿って飛ぶ。鋭角で減速・直線で加速。ヒット毎に減衰。大兵士/巨人は貫通力で判定。
import { DRAW_PHYS, MINION } from '../../config/balance';
import type { DrawShotDef, StraightDef, Team } from '../../config/types';
import { damageBase, damageMob, isInvulnerable, type DamageSource } from '../combat';
import { circleRect, dist2, type Vec } from '../geom';
import type { Mob } from '../units/types';
import type { World } from '../world';

export interface PathProfile {
  pts: Vec[]; // 等間隔に再サンプルした点
  cum: number[]; // 累積弧長
  speed: number[]; // 各点での弾速
  length: number;
  duration: number;
}

/** 手書きの点列を等間隔に再サンプル。 */
export function resample(raw: Vec[], step = DRAW_PHYS.resampleStep): Vec[] {
  if (raw.length === 0) return [];
  const out: Vec[] = [{ x: raw[0].x, y: raw[0].y }];
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    let ax = raw[i - 1].x;
    let ay = raw[i - 1].y;
    const bx = raw[i].x;
    const by = raw[i].y;
    let seg = Math.hypot(bx - ax, by - ay);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      ax = ax + (bx - ax) * t;
      ay = ay + (by - ay) * t;
      out.push({ x: ax, y: ay });
      seg = Math.hypot(bx - ax, by - ay);
      carry = 0;
    }
    carry += seg;
  }
  const lastRaw = raw[raw.length - 1];
  const lastOut = out[out.length - 1];
  if (Math.hypot(lastRaw.x - lastOut.x, lastRaw.y - lastOut.y) > step * 0.3) out.push({ x: lastRaw.x, y: lastRaw.y });
  return out;
}

export function pathLength(pts: Vec[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/** 長さ maxLen で切り詰める。 */
export function truncatePath(pts: Vec[], maxLen: number): Vec[] {
  const out: Vec[] = [pts[0]];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (L + d >= maxLen) {
      const t = (maxLen - L) / d;
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
      return out;
    }
    L += d;
    out.push(pts[i]);
  }
  return out;
}

/**
 * 弾速プロファイル。
 * - 「鋭角」= 1ステップあたりの曲がり角が閾値以上 → 90°曲がるごとに speedDownSharp 倍
 * - 直線・緩カーブ → 100px 進むごとに speedUpStraight 倍
 * キャストごとに係数が違う（テツカギは変化が激しく、ジグザグで停滞する）。
 */
export function buildProfile(raw: Vec[], def: Pick<DrawShotDef, 'baseSpeed' | 'speedUpStraight' | 'speedDownSharp'>): PathProfile {
  const pts = resample(smooth(raw));
  const n = pts.length;
  const cum = new Array<number>(n).fill(0);
  const speed = new Array<number>(n).fill(def.baseSpeed);
  const vMin = def.baseSpeed * DRAW_PHYS.minSpeedFrac;
  const vMax = def.baseSpeed * DRAW_PHYS.maxSpeedFrac;
  let v = def.baseSpeed;
  let prevAng = NaN;
  let duration = 0;
  for (let i = 1; i < n; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const d = Math.hypot(dx, dy);
    cum[i] = cum[i - 1] + d;
    const ang = Math.atan2(dy, dx);
    if (!Number.isNaN(prevAng)) {
      let turn = Math.abs(ang - prevAng);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      if (turn > DRAW_PHYS.sharpPerStep) {
        v *= Math.pow(def.speedDownSharp, turn / (Math.PI / 2));
      } else {
        v *= Math.pow(def.speedUpStraight, d / 100);
      }
      v = Math.max(vMin, Math.min(vMax, v));
    }
    prevAng = ang;
    speed[i] = v;
    duration += d / Math.max(1, (speed[i] + speed[i - 1]) / 2);
  }
  if (n > 1) speed[0] = speed[1];
  return { pts, cum, speed, length: cum[n - 1] ?? 0, duration };
}

/** 手ぶれを少し均す（3点移動平均、端点は保持）。 */
function smooth(raw: Vec[]): Vec[] {
  if (raw.length < 3) return raw;
  const out: Vec[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    out.push({ x: (raw[i - 1].x + raw[i].x + raw[i + 1].x) / 3, y: (raw[i - 1].y + raw[i].y + raw[i + 1].y) / 3 });
  }
  out.push(raw[raw.length - 1]);
  return out;
}

/** 平行移動した軌跡（複数弾用）。 */
export function offsetPath(pts: Vec[], off: number): Vec[] {
  if (off === 0 || pts.length < 2) return pts;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dy / d) * off, y: p.y + (dx / d) * off };
  });
}

// ---------------------------------------------------------------------------

export interface DSOwner {
  id: number;
  team: Team;
  /** チェイン（連続ヒット）を記録する */
  onDrawHit(target: Mob): void;
  /** 自分のドロー弾が1つ消えた（全部消えたらチェイン確定） */
  onDrawEnd(): void;
}

export interface DrawProjectile {
  id: number;
  owner: DSOwner;
  team: Team;
  prof: PathProfile;
  s: number; // 現在の弧長位置
  idx: number;
  x: number;
  y: number;
  width: number;
  power: number;
  decay: number[];
  useDecay: boolean;
  piercePower: number;
  maxHits: number;
  down: boolean;
  hits: number;
  hitIds: Set<number>;
  alive: boolean;
  age: number;
  color: string;
  crossed: boolean;
  history: Vec[]; // 描画用の残像
  coreMult: number;
  /** ラグ補償：キャストへの当たり判定をこの秒数だけ過去の位置で行う（0=補償なし） */
  rewind: number;
}

export function makeDrawProjectile(
  world: World,
  owner: DSOwner,
  prof: PathProfile,
  def: DrawShotDef,
  mods: { power: number; width: number; piercePower: number; speedMult: number; crossed: boolean; color: string; rewindMs?: number },
): DrawProjectile {
  if (mods.speedMult !== 1) prof = { ...prof, speed: prof.speed.map((v) => v * mods.speedMult), duration: prof.duration / mods.speedMult };
  return {
    id: world.nextId(),
    owner,
    team: owner.team,
    prof,
    s: 0,
    idx: 0,
    x: prof.pts[0].x,
    y: prof.pts[0].y,
    width: mods.width,
    power: mods.power,
    decay: def.decay,
    useDecay: def.pierceDecay,
    piercePower: mods.piercePower,
    maxHits: def.maxHits,
    down: def.down,
    hits: 0,
    hitIds: new Set(),
    alive: true,
    age: 0,
    color: mods.color,
    crossed: mods.crossed,
    history: [],
    coreMult: def.coreMult ?? 1,
    rewind: lagCompSec(mods.rewindMs ?? 0),
  };
}

/**
 * ラグ補償（SPEC 8.4）：過去 LAG_COMP_MS（150ms）までの位置で判定する。補償量は 150ms で頭打ち。
 * 遅延が大きすぎる（操作不能レベル）相手はサーバー側で 0 を渡し、素の位置で判定する。
 */
export const LAG_COMP_MS = 150;
export function lagCompSec(ms: number) {
  return ms > 0 ? Math.min(ms, LAG_COMP_MS) / 1000 : 0;
}

/** 減衰係数（ヒット数 n=0 が1発目）。 */
export function decayFactor(decay: number[], n: number) {
  return decay[Math.min(n, decay.length - 1)];
}

export function updateDrawProjectiles(world: World, list: DrawProjectile[], dt: number) {
  for (const p of list) {
    if (!p.alive) continue;
    p.age += dt;
    const { prof } = p;
    if (p.age > DRAW_PHYS.maxLifetime || prof.pts.length < 2) {
      endProjectile(p);
      continue;
    }
    // 弧長に沿って進める（点ごとの速度で）
    let remain = dt;
    const steps: Vec[] = [];
    while (remain > 0 && p.idx < prof.pts.length - 1) {
      const v = prof.speed[p.idx + 1];
      const segEnd = prof.cum[p.idx + 1];
      const need = (segEnd - p.s) / v;
      if (need <= remain) {
        remain -= need;
        p.s = segEnd;
        p.idx++;
        steps.push(prof.pts[p.idx]);
      } else {
        p.s += v * remain;
        remain = 0;
        const a = prof.pts[p.idx];
        const b = prof.pts[p.idx + 1];
        const t = (p.s - prof.cum[p.idx]) / Math.max(1e-6, segEnd - prof.cum[p.idx]);
        steps.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    for (const q of steps) {
      p.x = q.x;
      p.y = q.y;
      collide(world, p);
      if (!p.alive) break;
    }
    p.history.push({ x: p.x, y: p.y });
    if (p.history.length > 10) p.history.shift();
    if (p.alive && p.idx >= prof.pts.length - 1) endProjectile(p);
  }
}

function endProjectile(p: DrawProjectile) {
  if (!p.alive) return;
  p.alive = false;
  p.owner.onDrawEnd();
}

function collide(world: World, p: DrawProjectile) {
  const r = p.width / 2;
  // 壁（森の縁・岩・崖）に当たると消える
  for (const w of world.activeWalls()) {
    if (circleRect(p.x, p.y, r * 0.5, w)) {
      endProjectile(p);
      return;
    }
  }
  if (world.blockedByGate(p.x, p.y, p.team)) {
    endProjectile(p);
    return;
  }
  // 拠点・城（ぶつかると止まる）
  for (const b of world.bases) {
    if (!b.alive || b.team === p.team) continue;
    if (dist2(p.x, p.y, b.x, b.y) < (b.r + r) ** 2) {
      damageBase(world, b, p.power * decayFactor(p.decay, p.useDecay ? p.hits : 0) * p.coreMult, ownerSrc(p));
      endProjectile(p);
      return;
    }
  }
  const cands: Mob[] = [];
  world.grid.query(p.x, p.y, r, (m) => {
    // ラグ補償中はキャストだけ過去の位置で判定する（兵士・巨人・拠点などは補償しない）
    if (p.rewind > 0 && m.kind === 'hero') return;
    if (m.team !== p.team && !p.hitIds.has(m.id) && !isInvulnerable(world, m)) cands.push(m);
  });
  if (p.rewind > 0) {
    for (const h of world.heroes) {
      if (h.team === p.team || p.hitIds.has(h.id) || isInvulnerable(world, h)) continue;
      const past = world.pastPosition(h.id, p.rewind) ?? h;
      if (dist2(past.x, past.y, p.x, p.y) < (r + h.r) ** 2) cands.push(h);
    }
  }
  if (cands.length > 1) cands.sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y));
  for (const m of cands) {
    p.hitIds.add(m.id);
    let dmg = p.power * (p.useDecay ? decayFactor(p.decay, p.hits) : 1);
    if (m.downTimer > 0) dmg *= MINION.downChaseMult; // ダウン追撃は大きく減る
    damageMob(world, m, dmg, ownerSrc(p), { down: p.down, fx: 'ds' });
    p.hits++;
    p.owner.onDrawHit(m);
    // 貫通判定：大兵士(耐性1)・巨人(耐性5)は貫通力が足りないと止まる
    if (m.pierceResist > 0) {
      if (p.piercePower >= m.pierceResist) {
        p.piercePower -= m.pierceResist;
      } else {
        endProjectile(p);
        return;
      }
    }
    if (p.maxHits > 0 && p.hits >= p.maxHits) {
      endProjectile(p);
      return;
    }
  }
}

function ownerSrc(p: DrawProjectile): DamageSource {
  return { team: p.team, kind: 'hero', heroId: p.owner.id };
}

// ---------------------------------------------------------------------------
// 投擲弾：着弾点を指定し、放物線で円形範囲を落とす（減衰なし・壁越し可・着弾点が見える）

export interface LobShell {
  id: number;
  team: Team;
  ownerId: number;
  owner: DSOwner;
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  t: number;
  T: number;
  radius: number;
  power: number;
  coreMult: number;
  down: boolean;
  alive: boolean;
  color: string;
}

export function updateLobs(world: World, list: LobShell[], dt: number) {
  for (const s of list) {
    if (!s.alive) continue;
    s.t += dt;
    if (s.t < s.T) continue;
    s.alive = false;
    const src: DamageSource = { team: s.team, kind: 'hero', heroId: s.ownerId };
    world.grid.query(s.tx, s.ty, s.radius, (m) => {
      if (m.team === s.team) return;
      let dmg = s.power;
      if (m.downTimer > 0) dmg *= MINION.downChaseMult;
      if (damageMob(world, m, dmg, src, { down: s.down, fx: 'lob' }) > 0) s.owner.onDrawHit(m);
    });
    for (const b of world.bases) {
      if (!b.alive || b.team === s.team) continue;
      if (dist2(s.tx, s.ty, b.x, b.y) < (b.r + s.radius) ** 2) damageBase(world, b, s.power * s.coreMult, src);
    }
    world.emit({ type: 'blast', x: s.tx, y: s.ty, r: s.radius, team: s.team });
    s.owner.onDrawEnd();
  }
}

// ---------------------------------------------------------------------------
// ストレートショット：直線の高速弾。基本は貫通しない。特性（薙ぎ払い・爆風・3点射）あり。

export interface StraightShot {
  id: number;
  team: Team;
  /** 発射位置（通信用） */
  x0: number;
  y0: number;
  age?: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  range: number;
  travelled: number;
  power: number;
  pierce: boolean;
  blast: number; // 爆風威力（0=なし）
  minionMult: number;
  heroMult: number;
  hitIds: Set<number>;
  alive: boolean;
  radius: number;
  color: string;
}

export function makeStraightShots(
  nextId: () => number,
  owner: { id: number; team: Team; x: number; y: number },
  def: StraightDef,
  range: number,
  dirX: number,
  dirY: number,
  atkMult: number,
  color: string,
): StraightShot[] {
  const d = Math.hypot(dirX, dirY) || 1;
  const base = Math.atan2(dirY / d, dirX / d);
  const angles = def.trait === 'triple' ? [base, base - 0.2, base + 0.2] : [base];
  return angles.map((a, i) => ({
    id: nextId(),
    team: owner.team,
    ownerId: owner.id,
    x: owner.x + Math.cos(a) * 20,
    y: owner.y + Math.sin(a) * 20,
    x0: owner.x + Math.cos(a) * 20,
    y0: owner.y + Math.sin(a) * 20,
    vx: Math.cos(a) * def.speed,
    vy: Math.sin(a) * def.speed,
    range,
    travelled: 0,
    power: (i === 0 ? def.power : (def.traitPower ?? def.power * 0.4)) * atkMult,
    pierce: def.pierce,
    blast: def.trait === 'blast' ? (def.traitPower ?? 0) * atkMult : 0,
    minionMult: def.minionMult ?? 1,
    heroMult: def.heroMult ?? 1,
    hitIds: new Set<number>(),
    alive: true,
    radius: 9,
    color,
  }));
}

export function updateStraightShots(world: World, list: StraightShot[], dt: number) {
  for (const s of list) {
    if (!s.alive) continue;
    const sub = 3;
    for (let k = 0; k < sub && s.alive; k++) {
      s.x += (s.vx * dt) / sub;
      s.y += (s.vy * dt) / sub;
      s.travelled += (Math.hypot(s.vx, s.vy) * dt) / sub;
      if (s.travelled >= s.range) {
        s.alive = false;
        break;
      }
      for (const w of world.activeWalls()) {
        if (circleRect(s.x, s.y, 3, w)) {
          s.alive = false;
          break;
        }
      }
      if (!s.alive) break;
      if (world.blockedByGate(s.x, s.y, s.team)) {
        s.alive = false;
        break;
      }
      const src: DamageSource = { team: s.team, kind: 'hero', heroId: s.ownerId };
      for (const b of world.bases) {
        if (!b.alive || b.team === s.team) continue;
        if (dist2(s.x, s.y, b.x, b.y) < (b.r + s.radius) ** 2) {
          damageBase(world, b, s.power, src);
          s.alive = false;
          break;
        }
      }
      if (!s.alive) break;
      let hit: Mob | undefined;
      world.grid.query(s.x, s.y, s.radius, (m) => {
        if (!hit && m.team !== s.team && !s.hitIds.has(m.id) && !isInvulnerable(world, m)) hit = m;
      });
      if (hit) {
        s.hitIds.add(hit.id);
        const mult = hit.kind === 'hero' ? s.heroMult : s.minionMult;
        damageMob(world, hit, s.power * mult, src, { fx: 'ss' });
        if (s.blast > 0) {
          world.grid.query(s.x, s.y, 70, (m) => {
            if (m !== hit && m.team !== s.team) damageMob(world, m, s.blast * (m.kind === 'hero' ? s.heroMult : s.minionMult), src, { fx: 'ss' });
          });
          world.emit({ type: 'blast', x: s.x, y: s.y, r: 70, team: s.team });
        }
        if (!s.pierce) s.alive = false;
      }
    }
  }
}
