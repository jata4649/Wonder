// キャストAI：レーン維持・兵士処理・対キャスト・拠点攻撃・撤退・スキル・巨人対応。
// 入力はプレイヤーと同じ Command を発行する（sim 側で検証される）。
import { AI_DIFFICULTY, HERO } from '../config/balance';
import { CASTLE_POS, LANE_X, forwardSign } from '../config/map';
import type { Difficulty, LaneId, SkillDef } from '../config/types';
import { isGateProtected, type Base } from '../sim/bases';
import { isInvulnerable } from '../sim/combat';
import { skillReady, wonderReady } from '../sim/effects';
import { dist, dist2, type Vec } from '../sim/geom';
import type { Giant } from '../sim/giants';
import type { Hero } from '../sim/units/hero';
import type { Minion, Mob } from '../sim/units/types';
import type { World } from '../sim/world';
import { nextWaypoint } from './nav';

type Mode = 'lane' | 'retreat' | 'giant' | 'gank';

export class HeroAI {
  mode: Mode = 'lane';
  lane: LaneId;
  roam = false;
  private thinkT = 0;
  private dsT = 1;
  private moveTarget: Vec;
  private prevPos = new Map<number, Vec>();
  private vel = new Map<number, Vec>();
  private dodged = new Set<number>();
  private giant?: Giant;
  private gankTarget?: Hero;
  private strafe = 0;
  readonly cfg: (typeof AI_DIFFICULTY)[Difficulty];

  constructor(
    public world: World,
    public hero: Hero,
    public difficulty: Difficulty,
    lane: LaneId,
    roam = false,
  ) {
    this.lane = lane;
    this.roam = roam;
    this.cfg = AI_DIFFICULTY[difficulty];
    this.moveTarget = { x: hero.x, y: hero.y };
    this.thinkT = world.rng.range(0, this.cfg.reaction);
  }

  update(dt: number) {
    const h = this.hero;
    if (!h.alive) {
      this.mode = 'lane';
      return;
    }
    this.trackVelocities(dt);
    this.dsT -= dt;
    this.thinkT -= dt;
    this.dodge();
    if (this.thinkT <= 0) {
      this.thinkT = this.cfg.reaction * this.world.rng.range(0.7, 1.3);
      this.think();
    }
    this.steer();
  }

  // ---------------------------------------------------------------------
  private think() {
    const w = this.world;
    const h = this.hero;
    const hpFrac = h.hp / h.maxHp;
    // 撤退（HP30%以下）
    if (this.mode === 'retreat') {
      if (hpFrac > 0.9) this.mode = 'lane';
    } else if (hpFrac < this.cfg.retreatHp) {
      this.mode = 'retreat';
    }
    // 巨人への対応
    this.giant = this.pickGiant();
    if (this.mode !== 'retreat') {
      if (this.giant) this.mode = 'giant';
      else if (this.mode === 'giant') this.mode = 'lane';
    }
    // 遊撃（アタッカー）：近くの弱った敵キャストを狙う
    if (this.mode === 'lane' && this.roam && hpFrac > 0.6) {
      const t = this.visibleEnemyHeroes(950).sort((a, b) => a.hp - b.hp)[0];
      if (t) {
        this.mode = 'gank';
        this.gankTarget = t;
      }
    } else if (this.mode === 'gank') {
      const t = this.gankTarget;
      if (!t || !t.alive || !w.isVisibleTo(t, h.team) || dist(t.x, t.y, h.x, h.y) > 1200 || hpFrac < 0.45) this.mode = 'lane';
    }

    this.moveTarget = this.desiredPosition();
    this.useSkills(hpFrac);
    this.attack();
  }

  private pickGiant(): Giant | undefined {
    const w = this.world;
    const h = this.hero;
    let best: Giant | undefined;
    let bd = Infinity;
    for (const g of w.giants) {
      if (g.team === h.team || !g.alive) continue;
      const d = dist(g.x, g.y, h.x, h.y);
      const relevant = g.lane === this.lane || d < 900 || g.def.destroysBaseOnContact;
      if (!relevant) continue;
      // 破壊型は近い味方2人が向かう
      if (g.def.destroysBaseOnContact && g.lane !== this.lane) {
        const closer = w.heroes.filter((o) => o.alive && o.team === h.team && o !== h && dist(g.x, g.y, o.x, o.y) < d).length;
        if (closer >= 2) continue;
      }
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  private desiredPosition(): Vec {
    const w = this.world;
    const h = this.hero;
    const fwd = forwardSign(h.team);
    const off = ((h.id % 3) - 1) * 55;
    switch (this.mode) {
      case 'retreat': {
        const c = CASTLE_POS[h.team];
        return { x: c.x + off, y: c.y + fwd * 200 };
      }
      case 'giant': {
        const g = this.giant!;
        const r = Math.min(h.stat('drawRange') * 0.75, 320);
        // 巨人の正面やや手前（自陣側）から攻撃
        return { x: g.x + off, y: g.y - fwd * r };
      }
      case 'gank': {
        const t = this.gankTarget!;
        const r = h.def.draw.type === 'curve' || h.def.draw.type === 'lob' ? h.stat('drawRange') * 0.7 : h.stat('drawRange') * 0.5;
        const d = dist(t.x, t.y, h.x, h.y) || 1;
        return { x: t.x + ((h.x - t.x) / d) * r, y: t.y + ((h.y - t.y) / d) * r };
      }
      default: {
        const front = this.frontline();
        const lx = LANE_X[this.lane] + off;
        const behind = h.def.role === 'support' ? 200 : h.def.role === 'attacker' ? 150 : 110;
        let y = front - fwd * behind;
        // 敵の閉じた門より先には行かない
        const deep = w.deepBase((1 - h.team) as 0 | 1, this.lane);
        if (deep?.gate && isGateProtected(deep)) {
          const lim = deep.gate.y - fwd * 90;
          if ((y - lim) * fwd > 0) y = lim;
        }
        // 戦闘中は左右に少し揺れる（狙われにくく）
        this.strafe += 0.9;
        const sx = Math.sin(this.strafe) * (this.difficulty === 'hard' ? 45 : 20);
        return { x: lx + sx, y };
      }
    }
  }

  /** レーンの最前線（味方兵士の先頭、なければ自軍の残っている拠点）。 */
  private frontline(): number {
    const w = this.world;
    const h = this.hero;
    const fwd = forwardSign(h.team);
    let best = -Infinity;
    let y = NaN;
    for (const sq of w.squads) {
      if (sq.team !== h.team || sq.lane !== this.lane) continue;
      const s = sq.ay * fwd;
      if (s > best) {
        best = s;
        y = sq.ay;
      }
    }
    const fb = w.frontBase(h.team, this.lane);
    const db = w.deepBase(h.team, this.lane);
    const anchor = fb?.alive ? fb.y : db?.alive ? db.y : CASTLE_POS[h.team].y + fwd * 300;
    if (Number.isNaN(y)) return anchor + fwd * 60;
    // 前線が自陣拠点より後ろなら拠点前で守る
    if ((y - anchor) * fwd < 0) return anchor + fwd * 60;
    return y;
  }

  // ---------------------------------------------------------------------
  private steer() {
    const h = this.hero;
    const wp = nextWaypoint(this.world, h, this.moveTarget);
    const dx = wp.x - h.x;
    const dy = wp.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 18) {
      h.moveX = 0;
      h.moveY = 0;
    } else {
      const k = d < 60 ? d / 60 : 1;
      h.moveX = (dx / d) * k;
      h.moveY = (dy / d) * k;
    }
  }

  private trackVelocities(dt: number) {
    for (const o of this.world.heroes) {
      const p = this.prevPos.get(o.id);
      if (p && dt > 0) this.vel.set(o.id, { x: (o.x - p.x) / dt, y: (o.y - p.y) / dt });
      this.prevPos.set(o.id, { x: o.x, y: o.y });
    }
  }

  private visibleEnemyHeroes(range: number): Hero[] {
    const h = this.hero;
    return this.world.heroes.filter(
      (o) => o.alive && o.team !== h.team && !o.isInvulnerable() && this.world.isVisibleTo(o, h.team) && dist2(o.x, o.y, h.x, h.y) < range * range,
    );
  }

  private enemyMinionsInRange(range: number): Minion[] {
    const h = this.hero;
    const out: Minion[] = [];
    this.world.grid.query(h.x, h.y, range, (m) => {
      if (m.kind === 'minion' && m.team !== h.team && !isInvulnerable(this.world, m) && this.world.isVisibleTo(m, h.team)) out.push(m as Minion);
    });
    return out;
  }

  private attackableBase(range: number): Base | undefined {
    const h = this.hero;
    return this.world.bases.find(
      (b) => b.alive && b.team !== h.team && !isGateProtected(b) && dist(b.x, b.y, h.x, h.y) < range + b.r * 0.5,
    );
  }

  private jitter(p: Vec): Vec {
    const e = this.cfg.aimError;
    return { x: p.x + this.world.rng.range(-e, e), y: p.y + this.world.rng.range(-e, e) };
  }

  /** 移動を見越した予測位置。 */
  private lead(t: Mob, speed: number): Vec {
    const v = this.vel.get(t.id) ?? { x: 0, y: 0 };
    const d = dist(t.x, t.y, this.hero.x, this.hero.y);
    const time = Math.min(1, d / Math.max(200, speed));
    return { x: t.x + v.x * time, y: t.y + v.y * time };
  }

  private attack() {
    const h = this.hero;
    if (!h.canAct()) return;
    const d = h.def.draw;
    const range = h.stat('drawRange');
    const heroes = this.visibleEnemyHeroes(range + 60);
    const minions = this.enemyMinionsInRange(range);
    const base = this.attackableBase(range);
    const giant = this.giant && dist(this.giant.x, this.giant.y, h.x, h.y) < range + this.giant.r ? this.giant : undefined;
    const canDs = h.mp >= h.drawCost + (this.mode === 'retreat' ? 25 : 0) && this.dsT <= 0;
    const rng = this.world.rng;

    if (canDs && rng.next() < this.cfg.dsRate) {
      let pts: Vec[] | null = null;
      const target = heroes.sort((a, b) => a.hp - b.hp)[0];
      if (target && (minions.length < 4 || rng.next() < 0.5)) {
        pts = this.pathTo([this.jitter(this.lead(target, d.baseSpeed || 600))]);
      } else if (giant) {
        pts = this.pathTo([this.jitter(giant)]);
      } else if (minions.length >= 3) {
        pts = this.clusterPath(minions);
      } else if (base) {
        pts = this.pathTo([{ x: base.x, y: base.y }]);
      } else if (minions.length > 0) {
        pts = this.clusterPath(minions);
      }
      if (pts) {
        h.cmds.push({ t: 'ds', pts });
        const pace = this.difficulty === 'hard' ? 0.7 : this.difficulty === 'normal' ? 1.2 : 2.2;
        this.dsT = pace * rng.range(0.8, 1.4);
        return;
      }
    }
    // ストレートショット
    const ssTarget =
      this.world.nearestEnemy(h.x, h.y, h.team, h.def.straightRange, (m) => m.kind === 'hero') ??
      this.world.nearestEnemy(h.x, h.y, h.team, h.def.straightRange);
    if (ssTarget) {
      const p = this.jitter(ssTarget);
      h.cmds.push({ t: 'ss', x: p.x, y: p.y });
    } else if (base && dist(base.x, base.y, h.x, h.y) < h.def.straightRange + base.r) {
      h.cmds.push({ t: 'ss', x: base.x, y: base.y });
    }
  }

  /** 目標点を通る描線（始点は自キャストの判定内）。 */
  private pathTo(targets: Vec[]): Vec[] {
    const h = this.hero;
    const d = h.def.draw;
    const first = targets[0];
    const dx = first.x - h.x;
    const dy = first.y - h.y;
    const L = Math.hypot(dx, dy) || 1;
    const start = { x: h.x + (dx / L) * HERO.drawStartRadius * 0.6, y: h.y + (dy / L) * HERO.drawStartRadius * 0.6 };
    if (d.type !== 'curve') return [start, first];
    const pts: Vec[] = [start, ...targets];
    // 最後の目標の先へ少し伸ばす
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    pts.push({ x: b.x + (ex / el) * 90, y: b.y + (ey / el) * 90 });
    return densify(pts, 14);
  }

  /** 兵士の塊を貫く描線。 */
  private clusterPath(ms: Minion[]): Vec[] {
    const h = this.hero;
    const d = h.def.draw;
    // 重心
    let cx = 0;
    let cy = 0;
    for (const m of ms) {
      cx += m.x;
      cy += m.y;
    }
    cx /= ms.length;
    cy /= ms.length;
    if (d.type !== 'curve') return this.pathTo([this.jitter({ x: cx, y: cy })]);
    // 貪欲に近い順につなぐ（大兵士は避ける）
    const pool = ms.filter((m) => !m.big || d.piercePower >= 1).slice(0, 12);
    const order: Vec[] = [];
    let cur: Vec = { x: h.x, y: h.y };
    let budget = d.drawLength * 0.9;
    while (pool.length && order.length < 7) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const dd = dist2(cur.x, cur.y, pool[i].x, pool[i].y);
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      const next = pool.splice(bi, 1)[0];
      budget -= Math.sqrt(bd);
      if (budget < 0) break;
      order.push(this.jitter({ x: next.x, y: next.y }));
      cur = next;
    }
    if (order.length === 0) order.push({ x: cx, y: cy });
    return this.pathTo(order);
  }

  // ---------------------------------------------------------------------
  private useSkills(hpFrac: number) {
    const h = this.hero;
    if (!h.canAct() || h.gcd > 0) return;
    const rng = this.world.rng;
    const enemiesNear = (r: number) => {
      let n = 0;
      let heroes = 0;
      this.world.grid.query(h.x, h.y, r, (m) => {
        if (m.team !== h.team && m.alive && this.world.isVisibleTo(m, h.team)) {
          n++;
          if (m.kind === 'hero') heroes++;
        }
      });
      return { n, heroes };
    };
    const target = this.visibleEnemyHeroes(520)[0] ?? this.giant ?? this.world.nearestEnemy(h.x, h.y, h.team, 480);
    const tp = target ? { x: target.x, y: target.y } : { x: h.x, y: h.y + forwardSign(h.team) * 300 };

    // ワンダースキル
    if (wonderReady(h) && rng.next() < this.cfg.skillRate) {
      if (this.shouldUse(h.def.wonderSkill, hpFrac, enemiesNear, true)) {
        h.cmds.push({ t: 'ws', x: tp.x, y: tp.y });
        return;
      }
    }
    for (let i = 0; i < h.skills.length; i++) {
      if (!skillReady(h, i).ok) continue;
      if (rng.next() > this.cfg.skillRate) continue;
      if (this.shouldUse(h.skills[i], hpFrac, enemiesNear, false)) {
        const s = h.skills[i];
        let p = tp;
        if ((s.effect === 'dash' || s.effect === 'blink') && this.mode === 'retreat') {
          const c = CASTLE_POS[h.team];
          p = { x: c.x, y: c.y };
        }
        h.cmds.push({ t: 'skill', slot: i, x: p.x, y: p.y });
        return;
      }
    }
  }

  private shouldUse(
    s: SkillDef,
    hpFrac: number,
    near: (r: number) => { n: number; heroes: number },
    isWs: boolean,
  ): boolean {
    const h = this.hero;
    const p = s.params;
    const inCombat = near(450).n > 0;
    switch (s.effect) {
      case 'nova':
      case 'slow': {
        const e = near(p.radius * 0.9);
        return e.heroes >= (isWs ? 2 : 1) || e.n >= (isWs ? 8 : 4) || (isWs && this.world.match.timeLeft < 45 && e.n > 0);
      }
      case 'stun': {
        const e = near(p.range);
        return e.heroes >= 1 || e.n >= (isWs ? 6 : 4);
      }
      case 'bolt':
        return near(p.range * 0.9).n >= 2 || this.visibleEnemyHeroes(p.range * 0.9).length > 0;
      case 'heal': {
        if (!p.radius) return hpFrac < 0.55;
        const hurt = this.world.heroes.filter(
          (o) => o.alive && o.team === h.team && o.hp / o.maxHp < 0.6 && dist(o.x, o.y, h.x, h.y) < Math.min(p.radius, 2000),
        ).length;
        return hurt >= (isWs ? 2 : 1);
      }
      case 'guard':
        return inCombat && (hpFrac < 0.7 || (isWs && near(500).heroes >= 2));
      case 'haste':
        return this.mode === 'retreat' || this.mode === 'gank' || (this.mode === 'giant' && !inCombat);
      case 'empower':
      case 'pierceUp':
        return inCombat && h.mp > 30;
      case 'mpBurst':
        return h.mp < 30;
      case 'dash':
      case 'blink':
        return this.mode === 'retreat' ? inCombat : this.mode === 'gank';
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------
  /** 投擲の着弾点・飛んでくるドローを避ける。 */
  private dodge() {
    const h = this.hero;
    if (!h.canAct() || h.evadeCd > 0) return;
    const rng = this.world.rng;
    for (const s of this.world.lobs) {
      if (s.team === h.team || this.dodged.has(s.id)) continue;
      if (dist2(s.tx, s.ty, h.x, h.y) > (s.radius + h.r) ** 2) continue;
      this.dodged.add(s.id);
      if (s.T - s.t > 0.15 && rng.next() < this.cfg.dodgeLob) {
        const dx = h.x - s.tx;
        const dy = h.y - s.ty;
        h.cmds.push({ t: 'evade', dx: dx || 1, dy });
        return;
      }
    }
    for (const p of this.world.drawShots) {
      if (p.team === h.team || this.dodged.has(p.id)) continue;
      if (dist2(p.x, p.y, h.x, h.y) > 170 * 170) continue;
      this.dodged.add(p.id);
      if (rng.next() < this.cfg.dodgeLob * 0.4) {
        const vx = p.history.length > 1 ? p.x - p.history[p.history.length - 2].x : 0;
        const vy = p.history.length > 1 ? p.y - p.history[p.history.length - 2].y : 1;
        h.cmds.push({ t: 'evade', dx: -vy, dy: vx });
        return;
      }
    }
    if (this.dodged.size > 300) this.dodged.clear();
  }
}

function densify(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}
