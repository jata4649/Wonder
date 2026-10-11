// 入力の振り分け：左=移動、右=攻撃（マルチタッチは pointerId で管理）。
// 同じ側に2本目の指が触れたら2本指カメラパンに切り替える。
import type { Camera } from '../render/camera';
import type { Hero } from '../sim/units/hero';
import type { World } from '../sim/world';
import { DrawGesture } from './drawGesture';
import { VirtualStick } from './virtualStick';

type Role = 'stick' | 'draw' | 'pan' | 'ui';

export class InputManager {
  stick = new VirtualStick();
  gesture: DrawGesture;
  private roles = new Map<number, Role>();
  private panPts = new Map<number, { x: number; y: number }>();
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

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const { clientX: x, clientY: y, pointerId: id } = e;
    if (this.uiHitTest(x, y)) {
      this.roles.set(id, 'ui');
      return;
    }
    const left = x < this.camera.viewW / 2;
    const sameSideBusy = left ? this.stick.active : this.gesture.active;
    if (sameSideBusy || this.panPts.size > 0) {
      // 2本指 → カメラ
      if (this.stick.active && left) {
        this.panPts.set(this.stick.pointerId, { x: this.stick.x, y: this.stick.y });
        this.roles.set(this.stick.pointerId, 'pan');
        this.stick.end();
      }
      if (this.gesture.active && !left) {
        this.panPts.set(this.gesture.pointerId, { x, y });
        this.roles.set(this.gesture.pointerId, 'pan');
        this.gesture.cancel();
      }
      this.panPts.set(id, { x, y });
      this.roles.set(id, 'pan');
      return;
    }
    if (left) {
      this.stick.begin(id, x, y);
      this.roles.set(id, 'stick');
    } else if (this.gesture.begin(id, x, y, this.now())) {
      this.roles.set(id, 'draw');
    }
  };

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
    else if (role === 'pan') this.panPts.delete(e.pointerId);
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
    const v = this.moveVector();
    h.cmds.push({ t: 'evade', dx: v.x, dy: v.y });
  }

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

  /** 毎フレーム：移動入力をキャストへ反映。 */
  apply() {
    const h = this.getHero();
    if (!h) return;
    const v = this.enabled ? this.moveVector() : { x: 0, y: 0 };
    h.moveX = v.x;
    h.moveY = v.y;
  }

  get panning() {
    return this.panPts.size > 0;
  }
}
