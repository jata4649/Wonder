import { CAMERA } from '../config/balance';
import { WORLD_H, WORLD_W } from '../config/map';

export class Camera {
  x = WORLD_W / 2; // 画面中央が指す世界座標
  y = WORLD_H - 600;
  scale = 1; // 画面px / 世界px
  viewW = 1;
  viewH = 1;
  shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  /** 手動パン中か／最後に手動操作した時刻 */
  manualUntil = 0;

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    this.scale = Math.min(w, h) / CAMERA.viewWorldMin;
    // 縦長画面では上下も見えすぎないように
    if (h > w) this.scale = Math.max(this.scale, h / 1900);
  }

  follow(tx: number, ty: number, dt: number, now: number) {
    if (now < this.manualUntil) return;
    const k = 1 - Math.exp(-CAMERA.followLerp * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  pan(dxScreen: number, dyScreen: number, now: number) {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
    this.x = Math.max(0, Math.min(WORLD_W, this.x));
    this.y = Math.max(0, Math.min(WORLD_H, this.y));
    this.manualUntil = now + CAMERA.manualReturnSec;
  }

  addShake(amount: number) {
    this.shake = Math.min(18, this.shake + amount);
  }

  update(dt: number) {
    if (this.shake > 0.1) {
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.exp(-10 * dt);
    } else {
      this.shake = 0;
      this.shakeX = this.shakeY = 0;
    }
  }

  apply(ctx: CanvasRenderingContext2D, dpr: number) {
    ctx.setTransform(
      dpr * this.scale,
      0,
      0,
      dpr * this.scale,
      dpr * (this.viewW / 2 - this.x * this.scale + this.shakeX),
      dpr * (this.viewH / 2 - this.y * this.scale + this.shakeY),
    );
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.viewW / 2) / this.scale + this.x, y: (sy - this.viewH / 2) / this.scale + this.y };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.scale + this.viewW / 2, y: (wy - this.y) * this.scale + this.viewH / 2 };
  }

  /** 世界座標での可視範囲（カリング用）。 */
  bounds(margin = 100) {
    const hw = this.viewW / 2 / this.scale + margin;
    const hh = this.viewH / 2 / this.scale + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
