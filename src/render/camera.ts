import { CAMERA } from '../config/balance';
import { PLAY_X0, PLAY_X1, WORLD_H, WORLD_W } from '../config/map';
import { orient } from '../input/orientation';

/**
 * カメラ。世界は回転しない（SPEC 1.1：縦長盤面のまま）。
 * - 横画面：フィールドの幅＝画面の幅になる倍率。x は中央に固定し、y 方向（上下）だけ追従・パンする。
 * - 縦画面：従来どおり自キャストを中心に追従（x・y とも）。
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

  /** 横画面で x を固定する位置（フィールド中央）。 */
  static readonly FIELD_CX = (PLAY_X0 + PLAY_X1) / 2;
  static readonly FIELD_W = PLAY_X1 - PLAY_X0 + CAMERA.landSideMargin * 2;

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    if (this.land) {
      // 3レーンとも常に見える：フィールド幅＝画面幅
      this.scale = w / Camera.FIELD_W;
      this.x = Camera.FIELD_CX;
    } else {
      this.scale = Math.min(w, h) / CAMERA.viewWorldMin;
      if (h > w) this.scale = Math.max(this.scale, h / 1900);
    }
  }

  follow(tx: number, ty: number, dt: number, now: number) {
    if (now < this.manualUntil) return;
    const k = 1 - Math.exp(-CAMERA.followLerp * dt);
    if (this.land) this.x = Camera.FIELD_CX;
    else this.x += (tx - this.x) * k;
    this.y += (this.followY(ty) - this.y) * k;
  }

  /** 横画面では自キャストをやや下寄りに置き、進行方向（上）を広く見せる。 */
  private followY(ty: number) {
    if (!this.land) return ty;
    return ty - (this.viewH / this.scale) * CAMERA.landLookAhead;
  }

  /** 画面上のドラッグ量でパン（指の動きどおりに盤面が動く）。横画面は縦送りのみ。 */
  pan(dxScreen: number, dyScreen: number, now: number) {
    if (!this.land) this.x = Math.max(0, Math.min(WORLD_W, this.x - dxScreen / this.scale));
    this.y = Math.max(0, Math.min(WORLD_H, this.y - dyScreen / this.scale));
    this.manualUntil = now + CAMERA.manualReturnSec;
  }

  /** 画面上の方向 → ワールドの方向（回転しないので同じ）。 */
  screenDirToWorld(dx: number, dy: number) {
    return { x: dx, y: dy };
  }

  /** 画面の「上」を指すワールド方向。 */
  get up() {
    return { x: 0, y: -1 };
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
    const s = this.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.viewW / 2 - this.x * s + this.shakeX), dpr * (this.viewH / 2 - this.y * s + this.shakeY));
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.viewW / 2) / this.scale + this.x, y: (sy - this.viewH / 2) / this.scale + this.y };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.scale + this.viewW / 2 + this.shakeX, y: (wy - this.y) * this.scale + this.viewH / 2 + this.shakeY };
  }

  /** 世界座標での可視範囲（カリング用）。 */
  bounds(margin = 100) {
    const hx = this.viewW / 2 / this.scale + margin;
    const hy = this.viewH / 2 / this.scale + margin;
    return { x0: this.x - hx, y0: this.y - hy, x1: this.x + hx, y1: this.y + hy };
  }
}
