// キャスト（プレイヤー・AI共通）。入力は Command として受け取り、sim 側で検証して実行する。
import { CHAIN, HERO, MINION } from '../../config/balance';
import { CASTLE_POS, forwardSign } from '../../config/map';
import type { CasterDef, Loadout, SkillDef, StatKey, Team } from '../../config/types';
import { damageBase, damageMob, type DamageSource } from '../combat';
import { dist, dist2, pushOutOfRect, type Vec } from '../geom';
import {
  buildProfile,
  makeDrawProjectile,
  makeStraightShots,
  offsetPath,
  truncatePath,
  type DSOwner,
} from '../projectiles/drawshot';
import type { World } from '../world';
import type { Mob } from './types';

export type Command =
  | { t: 'ss'; x: number; y: number }
  | { t: 'ds'; pts: Vec[]; lagMs?: number; durMs?: number }
  | { t: 'evade'; dx: number; dy: number }
  | { t: 'skill'; slot: number; x: number; y: number }
  | { t: 'ws'; x: number; y: number };

export interface Buff {
  kind: 'haste' | 'guard' | 'empower' | 'slow' | 'pierceUp';
  value: number;
  t: number;
}

export type HeroState = 'normal' | 'leap' | 'charge' | 'evade' | 'dead';

export class Hero implements Mob, DSOwner {
  kind = 'hero' as const;
  x: number;
  y: number;
  r = HERO.radius;
  hp: number;
  maxHp: number;
  alive = true;
  downTimer = 0;
  pierceResist = 0;
  hitFlash = 0;
  revealTimer = 0;
  slowT = 0;
  slowMult = 1;

  mp: number;
  /** 装備スキル（3つ） */
  skills: SkillDef[];
  moveX = 0;
  moveY = 0;
  faceX = 0;
  faceY = -1;
  state: HeroState = 'normal';
  stateT = 0;
  leap?: { x0: number; y0: number; x1: number; y1: number; T: number };
  charge?: { dx: number; dy: number; left: number; hits: Map<number, number>; t: number };
  evadeDir = { x: 0, y: 0 };
  evadeDist: number = HERO.evade.distance;
  invulnTimer = 0;
  respawnTimer = 0;
  ssCd = 0;
  evadeCd = 0;
  gcd = 0;
  skillCd: number[] = [0, 0, 0];
  wsUsed = false;
  buffs: Buff[] = [];
  cmds: Command[] = [];
  /** 描画用：攻撃姿勢中か（相手にも見える） */
  drawStance = false;
  /** ドローチェイン */
  chain = { count: 0, alive: 0, last: 0 };
  /** 単独クロス用：自分の前回軌跡 */
  lastTrailId = -1;
  kills = 0;
  deaths = 0;
  /** 与ダメージ（対キャスト・対拠点）。レート更新・リザルト用 */
  dmgHeroes = 0;
  dmgBases = 0;
  /** オンライン：表示名・サーバーから受け取った高さ（跳躍） */
  netName?: string;
  netZ?: number;
  /** 直近の表示用メッセージ（MP不足など） */
  notice: { text: string; t: number } | null = null;
  lane: number;

  constructor(
    public world: World,
    public id: number,
    public def: CasterDef,
    public team: Team,
    public loadout: Loadout,
    public isPlayer: boolean,
    lane: number,
  ) {
    const sp = spawnPoint(team, id);
    this.x = sp.x;
    this.y = sp.y;
    this.lane = lane;
    this.maxHp = this.stat('maxHp');
    this.hp = this.maxHp;
    this.mp = this.stat('maxMp');
    this.faceY = forwardSign(team);
    this.skills = loadout.skillIds
      .map((id) => def.skills.find((s) => s.id === id))
      .filter((s): s is SkillDef => !!s)
      .slice(0, 3);
    if (this.skills.length === 0) this.skills = def.skills.slice(0, 3);
  }

  get level() {
    return this.world.teamLevel(this.team);
  }

  /** 能力値（レベル・アシスト・ソウル・バフ込み）。 */
  stat(key: StatKey): number {
    const d = this.def;
    const lv = this.level;
    const mods = this.world.statMods(this, key);
    switch (key) {
      case 'maxHp':
        return Math.round(d.maxHp * (1 + HERO.levelHpPerLv * (lv - 1)) + mods);
      case 'maxMp':
        return d.maxMp + mods;
      case 'speed': {
        let s = d.moveSpeed * (1 + mods);
        for (const b of this.buffs) if (b.kind === 'haste' || b.kind === 'slow') s *= b.value;
        return s;
      }
      case 'straightAtk':
        return 1 + HERO.levelAtkPerLv * (lv - 1) + mods;
      case 'drawAtk': {
        let m = 1 + HERO.levelAtkPerLv * (lv - 1) + mods;
        for (const b of this.buffs) if (b.kind === 'empower') m *= b.value;
        return m;
      }
      case 'piercePower': {
        let p = d.draw.piercePower + mods;
        for (const b of this.buffs) if (b.kind === 'pierceUp') p += b.value;
        return p;
      }
      case 'drawRange':
        return d.draw.range * (1 + mods);
      case 'xpRange':
        return d.draw.range * (1 + mods);
    }
  }

  get drawCost() {
    return this.def.draw.mpCost;
  }

  canAct() {
    return this.alive && this.state === 'normal' && this.downTimer <= 0;
  }

  say(text: string) {
    this.notice = { text, t: 1.2 };
  }

  // ---- DSOwner ----
  onDrawHit(_m: Mob) {
    this.chain.count++;
    this.chain.last = this.world.time;
  }
  onDrawEnd() {
    this.chain.alive = Math.max(0, this.chain.alive - 1);
    if (this.chain.alive === 0) this.closeChain();
  }
  private closeChain() {
    const n = this.chain.count;
    this.chain.count = 0;
    if (n >= CHAIN.bonusAt) {
      // 本作独自：5を超えた分だけボーナスが増える
      const bonus = MINION.small.xp * (CHAIN.bonusXp + CHAIN.extraPerHit * (n - CHAIN.bonusAt));
      this.world.onChainBonus(this, n, bonus);
    }
  }

  // ---- 更新 ----
  update(dt: number) {
    if (this.notice && (this.notice.t -= dt) <= 0) this.notice = null;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.revealTimer > 0) this.revealTimer -= dt;
    if (!this.alive) {
      this.cmds.length = 0;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    this.ssCd = Math.max(0, this.ssCd - dt);
    this.evadeCd = Math.max(0, this.evadeCd - dt);
    this.gcd = Math.max(0, this.gcd - dt);
    for (let i = 0; i < this.skillCd.length; i++) this.skillCd[i] = Math.max(0, this.skillCd[i] - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    for (const b of this.buffs) b.t -= dt;
    this.buffs = this.buffs.filter((b) => b.t > 0);
    const maxMp = this.stat('maxMp');
    const maxHp = this.stat('maxHp');
    if (maxHp !== this.maxHp) {
      this.hp += Math.max(0, maxHp - this.maxHp);
      this.maxHp = maxHp;
    }
    const nearCastle = dist2(this.x, this.y, CASTLE_POS[this.team].x, CASTLE_POS[this.team].y) < HERO.castleRegenRadius ** 2;
    this.mp = Math.min(maxMp, this.mp + this.def.mpRegen * (nearCastle ? HERO.mpRegenCastleMult : 1) * dt);
    if (nearCastle) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * HERO.castleRegenHpPerSec * dt);

    if (this.downTimer > 0) {
      this.downTimer -= dt;
      this.cmds.length = 0;
      return;
    }

    switch (this.state) {
      case 'leap':
        this.updateLeap(dt);
        break;
      case 'charge':
        this.updateCharge(dt);
        break;
      case 'evade':
        this.updateEvade(dt);
        break;
      default: {
        const len = Math.hypot(this.moveX, this.moveY);
        if (len > 0.05) {
          const k = Math.min(1, len);
          const sp = this.stat('speed') * k * dt;
          this.x += (this.moveX / len) * sp;
          this.y += (this.moveY / len) * sp;
          this.faceX = this.moveX / len;
          this.faceY = this.moveY / len;
        }
        this.collide();
        for (const c of this.cmds) this.exec(c);
        this.cmds.length = 0;
      }
    }
  }

  /** 壁・拠点・閉じた敵の門との衝突。 */
  collide() {
    const w = this.world;
    for (const wall of w.activeWalls()) pushOutOfRect(this, this.r, wall);
    for (const g of w.closedGateRects(this.team)) pushOutOfRect(this, this.r, g);
    for (const b of w.bases) {
      // 自軍の建物は通り抜けられる（敵の建物だけ遮る）
      if (!b.alive || b.team === this.team) continue;
      const d = dist(this.x, this.y, b.x, b.y);
      const min = b.r + this.r;
      if (d < min && d > 0.01) {
        this.x = b.x + ((this.x - b.x) / d) * min;
        this.y = b.y + ((this.y - b.y) / d) * min;
      }
    }
  }

  exec(c: Command) {
    if (!this.canAct()) return;
    switch (c.t) {
      case 'ss':
        return this.fireStraight(c.x, c.y);
      case 'ds':
        return this.fireDraw(c.pts, c.lagMs ?? 0);
      case 'evade':
        return this.evade(c.dx, c.dy);
      case 'skill':
        return this.world.castSkill(this, c.slot, c.x, c.y);
      case 'ws':
        return this.world.castWonder(this, c.x, c.y);
    }
  }

  fireStraight(tx: number, ty: number) {
    if (this.ssCd > 0) return;
    this.ssCd = HERO.ssCooldown;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const def = this.def.straight;
    const atk = this.stat('straightAtk');
    this.world.straightShots.push(...makeStraightShots(() => this.world.nextId(), this, def, this.def.straightRange, dx, dy, atk, this.def.accent));
    if (def.trait === 'sweep') {
      // 薙ぎ払い：前方の近距離扇形
      const d = Math.hypot(dx, dy) || 1;
      const fx = dx / d;
      const fy = dy / d;
      const src = this.src();
      this.world.grid.query(this.x, this.y, 110, (m) => {
        if (m.team === this.team) return;
        const ox = m.x - this.x;
        const oy = m.y - this.y;
        const od = Math.hypot(ox, oy) || 1;
        if ((ox * fx + oy * fy) / od > 0.5) {
          const mult = m.kind === 'hero' ? (def.heroMult ?? 1) : (def.minionMult ?? 1);
          damageMob(this.world, m, (def.traitPower ?? 10) * atk * mult, src, { fx: 'ss' });
        }
      });
      this.world.emit({ type: 'sweep', x: this.x, y: this.y, dx: fx, dy: fy, team: this.team });
    }
    this.faceX = dx;
    this.faceY = dy;
    this.revealTimer = 0.8;
  }

  src(): DamageSource {
    return { team: this.team, kind: 'hero', heroId: this.id };
  }

  /** 描いた軌跡を検証してドローショットを発動。 */
  fireDraw(raw: Vec[], lagMs = 0) {
    const d = this.def.draw;
    if (raw.length < 2) return;
    if (this.mp < d.mpCost) {
      this.say('MP不足');
      return;
    }
    const range = this.stat('drawRange');
    // 射程内にクランプ
    const pts = raw.map((p) => clampToCircle(p, this.x, this.y, range));
    // 始点は自キャストの判定内（＝弾は曲線の始点から出る）
    pts[0] = clampToCircle(pts[0], this.x, this.y, HERO.drawStartRadius);
    this.mp -= d.mpCost;
    this.revealTimer = 1.2;
    const end = pts[pts.length - 1];
    const color = this.def.accent;
    switch (d.type) {
      case 'curve': {
        const path = truncatePath(pts, d.drawLength);
        const cross = this.world.checkCross(this, path);
        const prof = buildProfile(path, d);
        const n = Math.max(1, d.multiShot);
        const powerEach = d.power * this.stat('drawAtk') * (1 + cross.powerAdd); // 複数弾は1発ごとの威力
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : (i - (n - 1) / 2) * 22;
          const p = off === 0 ? prof : buildProfile(offsetPath(prof.pts, off), d);
          this.world.drawShots.push(
            makeDrawProjectile(this.world, this, p, d, {
              power: powerEach,
              width: d.width * cross.sizeMult,
              piercePower: this.stat('piercePower'),
              speedMult: cross.speedMult,
              crossed: cross.crossed,
              color,
              rewindMs: lagMs,
            }),
          );
          this.chain.alive++;
        }
        this.world.addTrail(this, prof.pts, cross.crossed);
        break;
      }
      case 'lob': {
        this.world.lobs.push({
          id: this.world.nextId(),
          team: this.team,
          ownerId: this.id,
          owner: this,
          x0: this.x,
          y0: this.y,
          tx: end.x,
          ty: end.y,
          t: 0,
          T: d.lobTime ?? 0.85,
          radius: d.lobRadius ?? 100,
          power: d.power * this.stat('drawAtk'),
          coreMult: d.coreMult ?? 1,
          down: d.down,
          alive: true,
          color,
        });
        this.chain.alive++;
        break;
      }
      case 'leap': {
        const t = { x: end.x, y: end.y };
        // 着地点が壁の中なら押し出す
        for (const wall of this.world.activeWalls()) pushOutOfRect(t, this.r, wall);
        this.state = 'leap';
        this.stateT = 0;
        const L = dist(this.x, this.y, t.x, t.y);
        this.leap = { x0: this.x, y0: this.y, x1: t.x, y1: t.y, T: 0.35 + L / 1100 };
        this.chain.alive++;
        break;
      }
      case 'charge': {
        const dx = end.x - this.x;
        const dy = end.y - this.y;
        const L = Math.min(range, Math.hypot(dx, dy));
        if (L < 20) {
          this.mp += d.mpCost;
          return;
        }
        this.state = 'charge';
        this.stateT = 0;
        this.charge = { dx: dx / Math.hypot(dx, dy), dy: dy / Math.hypot(dx, dy), left: L, hits: new Map(), t: 0 };
        this.chain.alive++;
        break;
      }
    }
    this.faceX = end.x - this.x;
    this.faceY = end.y - this.y;
  }

  private updateLeap(dt: number) {
    const L = this.leap!;
    this.stateT += dt;
    const t = Math.min(1, this.stateT / L.T);
    this.x = L.x0 + (L.x1 - L.x0) * t;
    this.y = L.y0 + (L.y1 - L.y0) * t;
    if (t >= 1) {
      this.state = 'normal';
      const d = this.def.draw;
      const power = d.power * this.stat('drawAtk');
      const src = this.src();
      const R = d.aoeRadius ?? 120;
      this.world.grid.query(this.x, this.y, R, (m) => {
        if (m.team === this.team) return;
        let dmg = power;
        if (m.downTimer > 0) dmg *= MINION.downChaseMult;
        if (damageMob(this.world, m, dmg, src, { down: d.down, fx: 'ds' }) > 0) this.onDrawHit(m);
      });
      for (const b of this.world.bases) {
        if (b.alive && b.team !== this.team && dist2(this.x, this.y, b.x, b.y) < (b.r + R) ** 2) damageBase(this.world, b, power * (d.coreMult ?? 1), src);
      }
      this.world.emit({ type: 'blast', x: this.x, y: this.y, r: R, team: this.team });
      this.collide();
      this.leap = undefined;
      this.onDrawEnd();
    }
  }

  private updateCharge(dt: number) {
    const c = this.charge!;
    const d = this.def.draw;
    const speed = 980;
    const step = Math.min(c.left, speed * dt);
    c.t += dt;
    this.x += c.dx * step;
    this.y += c.dy * step;
    c.left -= step;
    const before = { x: this.x, y: this.y };
    this.collide();
    const blocked = Math.abs(before.x - this.x) + Math.abs(before.y - this.y) > 0.5;
    const R = d.aoeRadius ?? 60;
    const power = d.power * this.stat('drawAtk');
    const src = this.src();
    // 1回目の判定：接触時
    this.world.grid.query(this.x, this.y, R, (m) => {
      if (m.team === this.team || c.hits.has(m.id)) return;
      c.hits.set(m.id, 1);
      if (damageMob(this.world, m, power, src, { down: false, fx: 'ds' }) > 0) this.onDrawHit(m);
    });
    for (const b of this.world.bases) {
      if (b.alive && b.team !== this.team && !c.hits.has(-b.id) && dist2(this.x, this.y, b.x, b.y) < (b.r + R) ** 2) {
        c.hits.set(-b.id, 1);
        damageBase(this.world, b, power, src);
        c.left = 0;
      }
    }
    if (c.left <= 0 || blocked) {
      // 2回目の判定：突進の終わりに周囲を薙ぐ（減衰なし）
      const R2 = R * 1.8;
      if ((d.chargeHits ?? 2) >= 2) this.world.grid.query(this.x, this.y, R2 + 120, (m) => {
        if (m.team === this.team) return;
        const near = dist2(this.x, this.y, m.x, m.y) < (R2 + m.r) ** 2;
        const passed = c.hits.has(m.id) && dist2(this.x, this.y, m.x, m.y) < (R2 + 120) ** 2;
        if (near || passed) {
          if (damageMob(this.world, m, power, src, { down: d.down, fx: 'ds' }) > 0) this.onDrawHit(m);
        }
      });
      this.world.emit({ type: 'blast', x: this.x, y: this.y, r: R2, team: this.team });
      this.state = 'normal';
      this.charge = undefined;
      this.onDrawEnd();
    }
  }

  evade(dx: number, dy: number) {
    if (this.evadeCd > 0) return;
    let len = Math.hypot(dx, dy);
    if (len < 0.1) {
      dx = -this.faceX;
      dy = -this.faceY;
      len = Math.hypot(dx, dy) || 1;
    }
    this.evadeDir = { x: dx / len, y: dy / len };
    this.evadeDist = HERO.evade.distance;
    this.state = 'evade';
    this.stateT = 0;
    this.invulnTimer = HERO.evade.invuln;
    this.evadeCd = HERO.evade.cooldown;
  }

  /** スキルによる高速移動（回避と同じ挙動で無敵は短い）。 */
  dash(dx: number, dy: number, distance: number, invuln: number) {
    const len = Math.hypot(dx, dy);
    if (len < 0.1) {
      dx = this.faceX;
      dy = this.faceY;
    }
    const l2 = Math.hypot(dx, dy) || 1;
    this.evadeDir = { x: dx / l2, y: dy / l2 };
    this.evadeDist = distance;
    this.state = 'evade';
    this.stateT = 0;
    this.invulnTimer = Math.max(this.invulnTimer, invuln);
  }

  private updateEvade(dt: number) {
    this.stateT += dt;
    const sp = this.evadeDist / HERO.evade.duration;
    this.x += this.evadeDir.x * sp * dt;
    this.y += this.evadeDir.y * sp * dt;
    this.collide();
    if (this.stateT >= HERO.evade.duration) this.state = 'normal';
  }

  die() {
    this.alive = false;
    this.hp = 0;
    this.state = 'dead';
    this.deaths++;
    this.drawStance = false;
    this.buffs = [];
    this.respawnTimer = HERO.respawnBase + HERO.respawnPerLevel * this.level;
    this.leap = undefined;
    this.charge = undefined;
  }

  respawn() {
    const sp = spawnPoint(this.team, this.id);
    this.x = sp.x;
    this.y = sp.y;
    this.alive = true;
    this.state = 'normal';
    this.maxHp = this.stat('maxHp');
    this.hp = this.maxHp;
    this.mp = this.stat('maxMp');
    this.downTimer = 0;
    this.invulnTimer = 1.5;
  }

  isInvulnerable() {
    return this.invulnTimer > 0 || this.state === 'dead';
  }

  /** 跳躍中の高さ（描画用）。 */
  get z() {
    if (this.netZ !== undefined && !this.leap) return this.netZ;
    if (this.state !== 'leap' || !this.leap) return 0;
    const t = Math.min(1, this.stateT / this.leap.T);
    return Math.sin(t * Math.PI) * 140;
  }
}

function spawnPoint(team: Team, id: number): Vec {
  const c = CASTLE_POS[team];
  const off = ((id % 4) - 1.5) * 70;
  return { x: c.x + off, y: c.y + forwardSign(team) * 170 };
}

export function clampToCircle(p: Vec, cx: number, cy: number, r: number): Vec {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  if (d <= r) return { x: p.x, y: p.y };
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
}
