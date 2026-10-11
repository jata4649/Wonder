import { CAMERA } from '../config/balance';
import { WORLD_H, WORLD_W } from '../config/map';
import { orient } from '../input/orientation';

/**
 * カメラ。横画面（land）ではワールドを90°回転して描く（SPEC 1.3 (a)(e)(f)）。
 *   画面→ワールド: wx = (sy - C2)/scale, wy = (C1 - sx)/scale
 *   ワールド→画面: sx = -wy*scale + C1,  sy = wx*scale + C2
 *   C1 = W/2 + scale*cam.y, C2 = H/2 - scale*cam.x
 */
export class Camera {
  x = WORLD_W / 2; // 画面中央が指す世界座標
  y = WORLD_H - 600;
  scale = 1; // 画面px / 世界px
  viewW = 1;
  viewH = 1;
  shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  /** 手動パンの終了時刻（秒） */
  manualUntil = 0;

  get land() {
    return orient.land;
  }

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    if (this.land) {
      // 横画面：レーンを横断する方向（画面の高さ）に約1000、走る方向に約2000を映す
      this.scale = Math.min(h / CAMERA.landAcross, w / CAMERA.landAlong);
    } else {
      this.scale = Math.min(w, h) / CAMERA.viewWorldMin;
      if (h > w) this.scale = Math.max(this.scale, h / 1900);
    }
  }

  follow(tx: number, ty: number, dt: number, now: number) {
    if (now < this.manualUntil) return;
    const k = 1 - Math.exp(-CAMERA.followLerp * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  /** 画面上のドラッグ量でパン（指の動きどおりに盤面が動く）。 */
  pan(dxScreen: number, dyScreen: number, now: number) {
    const d = this.screenDeltaToWorld(dxScreen, dyScreen);
    this.x = Math.max(0, Math.min(WORLD_W, this.x - d.x));
    this.y = Math.max(0, Math.min(WORLD_H, this.y - d.y));
    this.manualUntil = now + CAMERA.manualReturnSec;
  }

  /** 画面上の方向ベクトル → ワールドの方向ベクトル（移動入力の写像 SPEC 1.3(b)）。 */
  screenDeltaToWorld(dx: number, dy: number) {
    return this.land ? { x: dy / this.scale, y: -dx / this.scale } : { x: dx / this.scale, y: dy / this.scale };
  }
  screenDirToWorld(dx: number, dy: number) {
    return this.land ? { x: dy, y: -dx } : { x: dx, y: dy };
  }

  /** 画面の「上」を指すワールド方向（跳躍の高さ・浮き上がる文字など）。 */
  get up() {
    return this.land ? { x: -1, y: 0 } : { x: 0, y: -1 };
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

  private c1() {
    return this.viewW / 2 + this.scale * this.y + this.shakeX;
  }
  private c2() {
    return this.viewH / 2 - this.scale * this.x + this.shakeY;
  }

  apply(ctx: CanvasRenderingContext2D, dpr: number) {
    const s = this.scale;
    if (this.land) {
      ctx.setTransform(0, dpr * s, -dpr * s, 0, dpr * this.c1(), dpr * this.c2());
    } else {
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.viewW / 2 - this.x * s + this.shakeX), dpr * (this.viewH / 2 - this.y * s + this.shakeY));
    }
  }

  screenToWorld(sx: number, sy: number) {
    if (this.land) return { x: (sy - (this.viewH / 2 - this.scale * this.x)) / this.scale, y: (this.viewW / 2 + this.scale * this.y - sx) / this.scale };
    return { x: (sx - this.viewW / 2) / this.scale + this.x, y: (sy - this.viewH / 2) / this.scale + this.y };
  }

  /** 揺れ込みの描画位置（正立テキスト等の描画用）。 */
  worldToScreen(wx: number, wy: number) {
    if (this.land) return { x: -wy * this.scale + this.c1(), y: wx * this.scale + this.c2() };
    return { x: (wx - this.x) * this.scale + this.viewW / 2 + this.shakeX, y: (wy - this.y) * this.scale + this.viewH / 2 + this.shakeY };
  }

  /** 世界座標での可視範囲（カリング用）。SPEC 1.3(f) */
  bounds(margin = 100) {
    const hx = (this.land ? this.viewH : this.viewW) / 2 / this.scale + margin;
    const hy = (this.land ? this.viewW : this.viewH) / 2 / this.scale + margin;
    return { x0: this.x - hx, y0: this.y - hy, x1: this.x + hx, y1: this.y + hy };
  }
}
