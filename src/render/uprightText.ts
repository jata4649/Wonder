// 正立テキスト＆バーのキュー（SPEC 1.3(c)）。
// 回転したワールド描画中は文字やバーを直接描かずに積み、最後にスクリーン空間で消化する。
// 縦画面でも同じ経路を通るので、向きによって見た目が変わらない。
import type { Camera } from './camera';

interface TextItem {
  kind: 'text';
  wx: number;
  wy: number;
  text: string;
  size: number; // ワールド単位のフォントサイズ
  weight: string;
  color: string;
  dy: number; // 画面の上方向へのずらし（ワールド単位）
  stroke?: string;
  bg?: string;
  alpha: number;
}
interface BarItem {
  kind: 'bar';
  wx: number;
  wy: number;
  w: number; // ワールド単位
  h: number;
  ratio: number;
  color: string;
  bg: string;
  dy: number;
}
interface ImageItem {
  kind: 'image';
  wx: number;
  wy: number;
  img: CanvasImageSource;
  w: number;
  h: number;
  dy: number;
  alpha: number;
}
type Item = TextItem | BarItem | ImageItem;

export class UprightQueue {
  private items: Item[] = [];

  text(
    wx: number,
    wy: number,
    text: string,
    o: { size: number; color?: string; weight?: string; dy?: number; stroke?: string; bg?: string; alpha?: number },
  ) {
    this.items.push({
      kind: 'text',
      wx,
      wy,
      text,
      size: o.size,
      weight: o.weight ?? 'bold',
      color: o.color ?? '#fff',
      dy: o.dy ?? 0,
      stroke: o.stroke,
      bg: o.bg,
      alpha: o.alpha ?? 1,
    });
  }

  bar(wx: number, wy: number, w: number, h: number, ratio: number, color: string, dy: number, bg = 'rgba(0,0,0,0.65)') {
    this.items.push({ kind: 'bar', wx, wy, w, h, ratio: Math.max(0, Math.min(1, ratio)), color, bg, dy });
  }

  /** 画像を正立で描く（足元＝下端中央を wx,wy に合わせる）。 */
  image(wx: number, wy: number, img: CanvasImageSource, w: number, h: number, dy = 0, alpha = 1) {
    this.items.push({ kind: 'image', wx, wy, img, w, h, dy, alpha });
  }

  clear() {
    this.items.length = 0;
  }

  get length() {
    return this.items.length;
  }

  /** スクリーン空間（ctx は dpr スケールのみ）で消化する。 */
  flush(ctx: CanvasRenderingContext2D, cam: Camera) {
    const s = cam.scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of this.items) {
      const p = cam.worldToScreen(it.wx, it.wy);
      const y = p.y - it.dy * s;
      if (it.kind === 'text') {
        const px = Math.max(8, it.size * s);
        ctx.globalAlpha = it.alpha;
        ctx.font = `${it.weight} ${px}px system-ui, sans-serif`;
        if (it.bg) {
          const w = ctx.measureText(it.text).width + px * 0.6;
          ctx.fillStyle = it.bg;
          ctx.fillRect(p.x - w / 2, y - px * 0.65, w, px * 1.3);
        }
        if (it.stroke) {
          ctx.lineWidth = Math.max(2, px * 0.18);
          ctx.strokeStyle = it.stroke;
          ctx.strokeText(it.text, p.x, y);
        }
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, p.x, y);
      } else if (it.kind === 'bar') {
        const w = Math.max(10, it.w * s);
        const h = Math.max(2, it.h * s);
        ctx.globalAlpha = 1;
        ctx.fillStyle = it.bg;
        ctx.fillRect(p.x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = it.color;
        ctx.fillRect(p.x - w / 2, y - h / 2, w * it.ratio, h);
      } else {
        const w = it.w * s;
        const h = it.h * s;
        ctx.globalAlpha = it.alpha;
        ctx.drawImage(it.img, p.x - w / 2, y - h, w, h);
      }
    }
    ctx.globalAlpha = 1;
    this.items.length = 0;
  }
}
