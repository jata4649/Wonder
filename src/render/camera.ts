import { CAM, CAMERA } from '../config/balance';
import { PLAY_X0, PLAY_X1, WORLD_H, WORLD_W } from '../config/map';
import { orient } from '../input/orientation';

/**
 * 縦送りカメラ（SPEC 1.1 / 1.5）。世界は回転しない。
 *   cam.x = 横画面：フィールド中央に固定（フィールド幅＝画面幅）／縦画面：自キャストの x
 *   cam.y = 自キャストの足元 y + offsetY   ← 動かせるのは y だけ
 * - スワイプで offsetY を動かす（横成分は捨てる）。上スワイプ＝奥（敵陣）を見る。
 * - offsetY は「画面高×panClamp」「自キャストが画面端から minOnScreen 内側に残る範囲」「ワールド端」でクランプ。
 * - 指を離してもオフセットは保持（autoReturnMs=0）。リセットで resetMs かけて 0 に戻す。
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
  /** 自キャスト足元からのオフセット（y のみ・世界px）。 */
  offsetY = 0;
  /** 注視点（自キャストの足元） */
  private focusX = WORLD_W / 2;
  private focusY = WORLD_H - 600;
  private reset?: { from: number; t: number };
  private lastPanAt = 0;

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
    } else {
      this.scale = Math.min(w, h) / CAMERA.viewWorldMin;
      if (h > w) this.scale = Math.max(this.scale, h / 1900);
    }
    this.offsetY = this.clampOffset(this.offsetY);
  }

  /** 注視点を即座に合わせる（試合開始時など）。 */
  snap(fx: number, fy: number) {
    this.focusX = fx;
    this.focusY = fy;
    this.offsetY = 0;
    this.reset = undefined;
    this.x = this.targetX();
    this.y = this.targetY();
  }

  private targetX() {
    return this.land ? Camera.FIELD_CX : this.focusX;
  }
  private targetY() {
    return this.focusY + this.offsetY;
  }

  /** オフセットの許容範囲（世界px）。 */
  maxOffset() {
    const byClamp = (this.viewH * CAM.panClamp) / this.scale;
    const bySelf = (this.viewH * (0.5 - CAM.minOnScreen)) / this.scale; // 自キャストを画面内に残す
    return Math.max(0, Math.min(byClamp, bySelf));
  }

  private clampOffset(off: number) {
    const m = this.maxOffset();
    off = Math.max(-m, Math.min(m, off));
    // ワールド端も超えない（注視点 + オフセットがワールド内）
    off = Math.max(-this.focusY, Math.min(WORLD_H - this.focusY, off));
    return off;
  }

  /** 毎フレーム：自キャストの足元へ追従（y はオフセット付き）。 */
  follow(fx: number, fy: number, dt: number, nowSec = performance.now() / 1000) {
    this.focusX = fx;
    this.focusY = fy;
    if (this.reset) {
      this.reset.t += dt * 1000;
      const k = Math.min(1, this.reset.t / CAM.resetMs);
      const e = 1 - (1 - k) * (1 - k); // easeOutQuad
      this.offsetY = this.reset.from * (1 - e);
      if (k >= 1) {
        this.offsetY = 0;
        this.reset = undefined;
      }
      // リセット中は即座に足元へ
      this.x = this.targetX();
      this.y = this.targetY();
      return;
    }
    if (CAM.autoReturnMs > 0 && this.offsetY !== 0 && nowSec * 1000 - this.lastPanAt > CAM.autoReturnMs) this.resetToHero();
    this.offsetY = this.clampOffset(this.offsetY);
    const k = 1 - Math.pow(1 - CAM.followLerp, dt * 60);
    this.x += (this.targetX() - this.x) * k;
    this.y += (this.targetY() - this.y) * k;
    // どれだけ遅れても自キャストは画面内に残す
    const lim = (this.viewH * (0.5 - CAM.minOnScreen)) / this.scale;
    if (fy - this.y > lim) this.y = fy - lim;
    if (this.y - fy > lim) this.y = fy + lim;
    if (!this.land) {
      const limX = (this.viewW * (0.5 - CAM.minOnScreen)) / this.scale;
      if (fx - this.x > limX) this.x = fx - limX;
      if (this.x - fx > limX) this.x = fx + limX;
    }
  }

  /**
   * スワイプでパン。横成分は完全に捨て、y オフセットだけ動かす。
   * 上スワイプ＝奥（敵陣）を見る／下スワイプ＝手前（自陣）を見る（SPEC 1.5(a)）。
   */
  pan(_dxScreen: number, dyScreen: number, nowSec = performance.now() / 1000) {
    if (this.reset) this.reset = undefined;
    this.offsetY = this.clampOffset(this.offsetY + dyScreen / this.scale);
    this.y = this.targetY(); // パンは即時に反映
    this.lastPanAt = nowSec * 1000;
  }

  /** カメラリセット：自キャストの足元を画面中央へ（resetMs でイージング）。 */
  resetToHero() {
    if (this.offsetY === 0 && !this.reset) {
      this.y = this.targetY();
      this.x = this.targetX();
      return;
    }
    this.reset = { from: this.offsetY, t: 0 };
  }

  /** オフセットを保持しているか（リセットボタンの点灯用）。 */
  get panned() {
    return Math.abs(this.offsetY) > 1 && !this.reset;
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
