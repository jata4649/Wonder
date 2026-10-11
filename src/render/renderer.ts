// Canvas2D レンダラ。World を読むだけで、World を書き換えない。
import { renderBackground } from './background';
import { Camera } from './camera';
import { WORLD_H, WORLD_W } from '../config/map';
import { teamColor, teamTint } from '../config/settings';
import type { Base } from '../sim/bases';
import type { World } from '../sim/world';

export class Renderer {
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  dpr = 1;
  private bg?: HTMLCanvasElement;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(w, h);
  }

  invalidateBackground() {
    this.bg = undefined;
  }

  render(world: World) {
    const { ctx, camera } = this;
    if (!this.bg) {
      this.bg = renderBackground(world.walls);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    camera.apply(ctx, this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0, this.bg.width, this.bg.height, 0, 0, WORLD_W, WORLD_H);

    this.drawDoors(world);
    for (const b of world.bases) this.drawBase(b);
  }

  private drawDoors(world: World) {
    const { ctx } = this;
    for (const w of world.walls) {
      if (!w.door) continue;
      const fb = world.frontBase(w.door.team, w.door.lane);
      const closed = !!fb?.alive;
      if (closed) {
        ctx.fillStyle = '#0f1d12';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = teamTint(w.door.team, 0.55);
        for (let y = w.y + 10; y < w.y + w.h; y += 22) {
          ctx.beginPath();
          ctx.arc(w.x + w.w / 2, y, 13, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(140,120,80,0.6)';
        ctx.fillRect(w.x, w.y + 6, w.w, w.h - 12);
      }
    }
  }

  private drawBase(b: Base) {
    const { ctx } = this;
    const col = teamColor(b.team);
    // 門
    if (b.gate) {
      const g = b.gate;
      const half = 135;
      if (g.state !== 'open') {
        ctx.fillStyle = g.state === 'closed' ? '#2a2d36' : '#3d4150';
        ctx.fillRect(g.x - half, g.y - 14, half * 2, 28);
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.strokeRect(g.x - half, g.y - 14, half * 2, 28);
        // 格子
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        for (let x = g.x - half + 18; x < g.x + half; x += 22) {
          ctx.beginPath();
          ctx.moveTo(x, g.y - 12);
          ctx.lineTo(x, g.y + 12);
          ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = g.kind === 'yukyu' ? '悠久門' : '刹那門';
        const txt = g.state === 'opening' ? `${label} ${Math.ceil(g.timer)}` : `${label} 🔒`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(g.x - 80, g.y - 50, 160, 32);
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, g.x, g.y - 34);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(g.x - half, g.y - 6, 26, 12);
        ctx.fillRect(g.x + half - 26, g.y - 6, 26, 12);
      }
    }

    if (!b.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 4;
      ctx.stroke();
      return;
    }
    const flash = b.hitFlash > 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + b.r * 0.5, b.r * 1.05, b.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (b.tier === 'castle') {
      // 城：塔の形
      const r = b.r;
      ctx.fillStyle = flash ? '#fff' : col;
      ctx.beginPath();
      ctx.roundRect(b.x - r, b.y - r * 0.7, r * 2, r * 1.4, 16);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = -2; i <= 2; i++) ctx.fillRect(b.x + i * r * 0.4 - 12, b.y - r * 0.9, 24, 30);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 0.7}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('城', b.x, b.y + 4);
      return;
    }
    const sides = b.def.kind === 'small' ? 4 : b.def.kind === 'normal' ? 6 : b.def.kind === 'large' ? 8 : 10;
    ctx.fillStyle = flash ? '#fff' : col;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = b.x + Math.cos(a) * b.r;
      const py = b.y + Math.sin(a) * b.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 5;
    ctx.stroke();
    // HPリング
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#7CFC8A';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.62, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * b.hp) / b.maxHp);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(b.r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = { small: '小', normal: '拠', large: '大', huge: '特', castle: '城' }[b.def.kind];
    ctx.fillText(label, b.x, b.y + 2);
    if (b.gate && b.gate.state !== 'open') {
      // 無敵（門が閉じている）表示
      ctx.strokeStyle = 'rgba(200,220,255,0.7)';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
