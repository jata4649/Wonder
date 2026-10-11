// 入力の振り分け：左=移動、右=攻撃（マルチタッチは pointerId で管理）。
// 同じ側に2本目の指が触れたら2本指カメラパンに切り替える。
import type { Camera } from '../render/camera';
import type { Hero } from '../../shared/sim/units/hero';
import type { World } from '../../shared/sim/world';
import { DrawGesture } from './drawGesture';
import { VirtualStick } from './virtualStick';

type Role = 'stick' | 'draw' | 'pan' | 'ui';
export const STICK_ZONE = 0.46;

export class InputManager {
  stick = new VirtualStick();
  gesture: DrawGesture;
  private roles = new Map<number, Role>();
  private panPts = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private keys = new Set<string>();
  /** UI（ミニマップなど）がタップを横取りする */
  uiHitTest: (sx: number, sy: number) => boolean = () => false;
  enabled = true;

  constructor(
    el: HTMLElement,
    private camera: Camera,
    private getHero: () => Hero | undefined,
    getWorld: () => World,
  ) {
    this.gesture = new DrawGesture(camera, getHero, getWorld);
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') this.evade();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private now() {
    return performance.now();
  }

  /**
   * ジェスチャ優先順位（SPEC 1.5(b)）
   *  1. ドロー描画：右ゾーンで、自キャストのドロー射程内に触れた指（描き始めたら以後は描画に専念）
   *  2. 移動スティック：左ゾーン
   *  3. UI：ボタン類は DOM 側、ミニマップは uiHitTest
   *  4. カメラパン：2本目以降の指（既存の描画・スティックは奪わない）、
   *     または右ゾーンでもフィールド背景（射程外）の1本指スワイプ
   */
  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const { clientX: x, clientY: y, pointerId: id } = e;
    if (this.uiHitTest(x, y)) {
      this.roles.set(id, 'ui');
      return;
    }
    const left = x < this.camera.viewW * STICK_ZONE;
    if (left && !this.stick.active) {
      this.stick.begin(id, x, y);
      this.roles.set(id, 'stick');
      return;
    }
    if (!left && !this.gesture.active && this.panPts.size === 0 && this.inDrawZone(x, y)) {
      if (this.gesture.begin(id, x, y, this.now())) {
        this.roles.set(id, 'draw');
        return;
      }
    }
    // それ以外はカメラパン（描画中・スティック操作中の指は奪わない）
    this.panPts.set(id, { x, y, x0: x, y0: y, t0: this.now() });
    this.roles.set(id, 'pan');
  };

  /** ドローを始められる位置か：自キャストのドロー射程（＋余裕）の内側。外側はフィールド背景＝パン。 */
  private inDrawZone(sx: number, sy: number) {
    const h = this.getHero();
    if (!h || !h.alive) return false;
    const w = this.camera.screenToWorld(sx, sy);
    const r = h.stat('drawRange') + 40;
    return (w.x - h.x) ** 2 + (w.y - h.y) ** 2 <= r * r;
  }

  private onMove = (e: PointerEvent) => {
    const role = this.roles.get(e.pointerId);
    if (!role) return;
    const { clientX: x, clientY: y } = e;
    if (role === 'stick') this.stick.move(x, y);
    else if (role === 'draw') this.gesture.move(x, y);
    else if (role === 'pan') {
      const p = this.panPts.get(e.pointerId);
      if (p) {
        const n = Math.max(1, this.panPts.size);
        this.camera.pan((x - p.x) / n, (y - p.y) / n, this.now() / 1000);
        p.x = x;
        p.y = y;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const role = this.roles.get(e.pointerId);
    this.roles.delete(e.pointerId);
    if (role === 'stick') this.stick.end();
    else if (role === 'draw') this.gesture.end(e.clientX, e.clientY, this.now());
    else if (role === 'pan') {
      const p = this.panPts.get(e.pointerId);
      this.panPts.delete(e.pointerId);
      // 射程外を1本指で「タップ」しただけなら、従来どおりオート照準のストレートショット
      if (p && this.panPts.size === 0 && !this.gesture.active && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 14 && this.now() - p.t0 < 320 && e.clientX >= this.camera.viewW * STICK_ZONE) {
        this.gesture.tapAt(e.clientX, e.clientY);
      }
    }
    // 指を離してもオフセットは保持（自動では戻らない）
  };

  private onCancel = (e: PointerEvent) => {
    const role = this.roles.get(e.pointerId);
    this.roles.delete(e.pointerId);
    if (role === 'stick') this.stick.end();
    else if (role === 'draw') this.gesture.cancel();
    else if (role === 'pan') this.panPts.delete(e.pointerId);
  };

  /** 回避（ドロー中ならキャンセルドロー）。 */
  evade() {
    const h = this.getHero();
    if (!h) return;
    this.gesture.cancel();
    const v = this.worldMove();
    h.cmds.push({ t: 'evade', dx: v.x, dy: v.y });
  }

  /** 画面座標系の移動入力（スティック or WASD）。 */
  moveVector() {
    const v = this.stick.vector();
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;
    if (kx || ky) {
      const d = Math.hypot(kx, ky);
      return { x: kx / d, y: ky / d };
    }
    return v;
  }

  /** 画面上のスティック方向 → ワールドの移動方向（横画面では90°回転。SPEC 1.3(b)）。 */
  worldMove() {
    const v = this.moveVector();
    return this.camera.screenDirToWorld(v.x, v.y);
  }

  /** 毎フレーム：移動入力をキャストへ反映。 */
  apply() {
    const h = this.getHero();
    if (!h) return;
    const v = this.enabled ? this.worldMove() : { x: 0, y: 0 };
    h.moveX = v.x;
    h.moveY = v.y;
  }

  get panning() {
    return this.panPts.size > 0;
  }
}
