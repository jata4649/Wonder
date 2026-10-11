// 画面右半分：タッチした瞬間に「筆を構える」→ なぞって離すと発動。
// - 短タップ：近くの敵にオート照準のストレートショット
// - 自キャストに指を戻して離す：キャンセル
// - 描線長を超えた瞬間に自動発動（以後は戻せない）
import { HERO } from '../../shared/config/balance';
import type { Camera } from '../render/camera';
import type { Vec } from '../../shared/sim/geom';
import { pathLength } from '../../shared/sim/projectiles/drawshot';
import { clampToCircle, type Hero } from '../../shared/sim/units/hero';
import type { World } from '../../shared/sim/world';

const TAP_MOVE_PX = 14;
const TAP_MAX_MS = 320;
/** 短くまっすぐ素早くフリックするとストレートショット（SPEC 4.1） */
const FLICK_MAX_MS = 180;
const FLICK_MAX_PX = 150;
const FLICK_STRAIGHTNESS = 0.9;

export class DrawGesture {
  active = false;
  pointerId = -1;
  startT = 0;
  sx0 = 0;
  sy0 = 0;
  moved = false;
  noMp = false;
  pts: Vec[] = [];
  length = 0;
  private screenLen = 0;
  private lastSx = 0;
  private lastSy = 0;
  /** 直近に発動/キャンセルした結果（演出用） */
  lastResult: { kind: 'fire' | 'cancel' | 'auto' | 'ss'; t: number } | null = null;

  constructor(
    private camera: Camera,
    private getHero: () => Hero | undefined,
    private world: () => World,
  ) {}

  begin(id: number, sx: number, sy: number, now: number) {
    const h = this.getHero();
    if (!h || !h.alive) return false;
    this.active = true;
    this.pointerId = id;
    this.startT = now;
    this.sx0 = sx;
    this.sy0 = sy;
    this.lastSx = sx;
    this.lastSy = sy;
    this.screenLen = 0;
    this.moved = false;
    this.noMp = h.mp < h.drawCost;
    const w = this.camera.screenToWorld(sx, sy);
    // 弾は曲線の始点から出る：始点は自キャストの判定内へ
    this.pts = [clampToCircle(w, h.x, h.y, HERO.drawStartRadius)];
    this.length = 0;
    h.drawStance = !this.noMp;
    return true;
  }

  move(sx: number, sy: number) {
    if (!this.active) return;
    const h = this.getHero();
    if (!h || !h.alive) return this.cancel();
    this.screenLen += Math.hypot(sx - this.lastSx, sy - this.lastSy);
    this.lastSx = sx;
    this.lastSy = sy;
    if (!this.moved && Math.hypot(sx - this.sx0, sy - this.sy0) > TAP_MOVE_PX) {
      this.moved = true;
      if (this.noMp) {
        h.say('MP不足');
        h.drawStance = false;
      }
    }
    if (!this.moved || this.noMp) return;
    const range = h.stat('drawRange');
    const p = clampToCircle(this.camera.screenToWorld(sx, sy), h.x, h.y, range);
    const last = this.pts[this.pts.length - 1];
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 3) return;
    this.pts.push(p);
    this.length += d;
    const def = h.def.draw;
    if (def.type === 'curve' && this.length >= def.drawLength) {
      // 描線長を超えた瞬間に自動発動
      this.fire('auto');
    }
  }

  end(sx: number, sy: number, now: number) {
    if (!this.active) return;
    const h = this.getHero();
    if (!h) return this.reset();
    if (!this.moved && now - this.startT < TAP_MAX_MS) {
      this.tapShot(h, sx, sy);
      return this.reset();
    }
    // 短く素早い直線のフリック → ストレートショット（MP不要）
    const chord = Math.hypot(sx - this.sx0, sy - this.sy0);
    if (
      this.moved &&
      now - this.startT < FLICK_MAX_MS &&
      chord < FLICK_MAX_PX &&
      chord / Math.max(1, this.screenLen) > FLICK_STRAIGHTNESS
    ) {
      const d = this.camera.screenDirToWorld(sx - this.sx0, sy - this.sy0);
      const L = Math.hypot(d.x, d.y) || 1;
      h.cmds.push({ t: 'ss', x: h.x + (d.x / L) * 300, y: h.y + (d.y / L) * 300 });
      this.lastResult = { kind: 'ss', t: now };
      return this.reset();
    }
    if (this.noMp || this.pts.length < 2) return this.reset();
    const wp = this.camera.screenToWorld(sx, sy);
    // 自キャストの上で離すとキャンセル
    if (Math.hypot(wp.x - h.x, wp.y - h.y) < HERO.cancelRadius + h.r * 0.5) {
      this.lastResult = { kind: 'cancel', t: now };
      return this.reset();
    }
    this.fire('fire');
  }

  /** 描画ジェスチャ外でのタップ（射程外のフィールドなど）。 */
  tapAt(sx: number, sy: number) {
    const h = this.getHero();
    if (h?.alive) this.tapShot(h, sx, sy);
  }

  private tapShot(h: Hero, sx: number, sy: number) {
    const w = this.world();
    const target = w.nearestEnemy(h.x, h.y, h.team, h.def.straightRange + 60, (m) => m.kind === 'hero') ??
      w.nearestEnemy(h.x, h.y, h.team, h.def.straightRange + 60);
    const p = target ? { x: target.x, y: target.y } : this.camera.screenToWorld(sx, sy);
    h.cmds.push({ t: 'ss', x: p.x, y: p.y });
    this.lastResult = { kind: 'ss', t: performance.now() };
  }

  private fire(kind: 'fire' | 'auto') {
    const h = this.getHero();
    if (h && this.pts.length >= 2 && pathLength(this.pts) > 8) h.cmds.push({ t: 'ds', pts: this.pts.slice(), durMs: Math.max(1, performance.now() - this.startT) });
    this.lastResult = { kind, t: performance.now() };
    this.reset();
  }

  /** 回避ボタンなどによるキャンセル。 */
  cancel() {
    if (this.active) this.lastResult = { kind: 'cancel', t: performance.now() };
    this.reset();
  }

  private reset() {
    const h = this.getHero();
    if (h) h.drawStance = false;
    this.active = false;
    this.pointerId = -1;
    this.pts = [];
    this.length = 0;
  }
}
