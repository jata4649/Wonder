// 画面左半分の触れた場所に動的生成される仮想スティック。
export class VirtualStick {
  active = false;
  pointerId = -1;
  ox = 0;
  oy = 0;
  x = 0;
  y = 0;
  readonly radius = 56;

  begin(id: number, sx: number, sy: number) {
    this.active = true;
    this.pointerId = id;
    this.ox = this.x = sx;
    this.oy = this.y = sy;
  }

  move(sx: number, sy: number) {
    const dx = sx - this.ox;
    const dy = sy - this.oy;
    const d = Math.hypot(dx, dy);
    // 指が遠く離れたら原点を引きずる（操作しやすさ）
    if (d > this.radius * 1.6) {
      const k = (d - this.radius * 1.6) / d;
      this.ox += dx * k;
      this.oy += dy * k;
    }
    this.x = sx;
    this.y = sy;
  }

  end() {
    this.active = false;
    this.pointerId = -1;
  }

  /** -1..1 の入力ベクトル。 */
  vector() {
    if (!this.active) return { x: 0, y: 0 };
    const dx = this.x - this.ox;
    const dy = this.y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d < 6) return { x: 0, y: 0 };
    const k = Math.min(1, d / this.radius) / d;
    return { x: dx * k, y: dy * k };
  }
}
